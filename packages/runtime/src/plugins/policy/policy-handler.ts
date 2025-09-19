import { invariant, zip } from '@zenstackhq/common-helpers';
import {
    AliasNode,
    BinaryOperationNode,
    ColumnNode,
    DeleteQueryNode,
    expressionBuilder,
    ExpressionWrapper,
    FromNode,
    FunctionNode,
    IdentifierNode,
    InsertQueryNode,
    JoinNode,
    OperationNodeTransformer,
    OperatorNode,
    ParensNode,
    PrimitiveValueListNode,
    RawNode,
    ReturningNode,
    SelectionNode,
    SelectQueryNode,
    TableNode,
    UpdateQueryNode,
    ValueListNode,
    ValueNode,
    ValuesNode,
    WhereNode,
    type OperationNode,
    type QueryResult,
    type RootOperationNode,
    type SelectQueryBuilder,
} from 'kysely';
import { match } from 'ts-pattern';
import type { ClientContract } from '../../client';
import type { CRUD } from '../../client/contract';
import { getCrudDialect } from '../../client/crud/dialects';
import type { BaseCrudDialect } from '../../client/crud/dialects/base-dialect';
import { InternalError, QueryError } from '../../client/errors';
import type { ProceedKyselyQueryFunction } from '../../client/plugin';
import { getManyToManyRelation, requireField, requireIdFields, requireModel } from '../../client/query-utils';
import { ExpressionUtils, type BuiltinType, type Expression, type GetModels, type SchemaDef } from '../../schema';
import { ColumnCollector } from './column-collector';
import { RejectedByPolicyError } from './errors';
import { ExpressionTransformer } from './expression-transformer';
import type { Policy, PolicyOperation } from './types';
import { buildIsFalse, conjunction, disjunction, falseNode, getTableName } from './utils';

export type CrudQueryNode = SelectQueryNode | InsertQueryNode | UpdateQueryNode | DeleteQueryNode;

export type MutationQueryNode = InsertQueryNode | UpdateQueryNode | DeleteQueryNode;

export class PolicyHandler<Schema extends SchemaDef> extends OperationNodeTransformer {
    private readonly dialect: BaseCrudDialect<Schema>;

    constructor(private readonly client: ClientContract<Schema>) {
        super();
        this.dialect = getCrudDialect(this.client.$schema, this.client.$options);
    }

    get kysely() {
        return this.client.$qb;
    }

    async handle(
        node: RootOperationNode,
        proceed: ProceedKyselyQueryFunction /*, transaction: OnKyselyQueryTransaction*/,
    ) {
        if (!this.isCrudQueryNode(node)) {
            // non-CRUD queries are not allowed
            throw new RejectedByPolicyError(undefined, 'non-CRUD queries are not allowed');
        }

        if (!this.isMutationQueryNode(node)) {
            // transform and proceed read without transaction
            return proceed(this.transformNode(node));
        }

        let mutationRequiresTransaction = false;
        const { mutationModel } = this.getMutationModel(node);

        const isManyToManyJoinTable = this.isManyToManyJoinTable(mutationModel);

        if (InsertQueryNode.is(node) && !isManyToManyJoinTable) {
            // reject create if unconditional deny
            const constCondition = this.tryGetConstantPolicy(mutationModel, 'create');
            if (constCondition === false) {
                throw new RejectedByPolicyError(mutationModel);
            } else if (constCondition === undefined) {
                mutationRequiresTransaction = true;
            }
        }

        if (!mutationRequiresTransaction && !node.returning) {
            // transform and proceed mutation without transaction
            return proceed(this.transformNode(node));
        }

        if (InsertQueryNode.is(node)) {
            await this.enforcePreCreatePolicy(node, mutationModel, isManyToManyJoinTable, proceed);
        }
        const transformedNode = this.transformNode(node);
        const result = await proceed(transformedNode);

        if (!this.onlyReturningId(node)) {
            const readBackResult = await this.processReadBack(node, result, proceed);
            if (readBackResult.rows.length !== result.rows.length) {
                throw new RejectedByPolicyError(mutationModel, 'result is not allowed to be read back');
            }
            return readBackResult;
        } else {
            // reading id fields bypasses policy
            return result;
        }

        // TODO: run in transaction
        // let readBackError = false;

        // transform and post-process in a transaction
        // const result = await transaction(async (txProceed) => {
        //     if (InsertQueryNode.is(node)) {
        //         await this.enforcePreCreatePolicy(node, txProceed);
        //     }
        //     const transformedNode = this.transformNode(node);
        //     const result = await txProceed(transformedNode);

        //     if (!this.onlyReturningId(node)) {
        //         const readBackResult = await this.processReadBack(node, result, txProceed);
        //         if (readBackResult.rows.length !== result.rows.length) {
        //             readBackError = true;
        //         }
        //         return readBackResult;
        //     } else {
        //         return result;
        //     }
        // });

        // if (readBackError) {
        //     throw new RejectedByPolicyError(mutationModel, 'result is not allowed to be read back');
        // }

        // return result;
    }

    // #region overrides

    protected override transformSelectQuery(node: SelectQueryNode) {
        let whereNode = this.transformNode(node.where);

        // get combined policy filter for all froms, and merge into where clause
        const policyFilter = this.createPolicyFilterForFrom(node.from);
        if (policyFilter) {
            whereNode = WhereNode.create(
                whereNode?.where ? conjunction(this.dialect, [whereNode.where, policyFilter]) : policyFilter,
            );
        }

        const baseResult = super.transformSelectQuery({
            ...node,
            where: undefined,
        });

        return {
            ...baseResult,
            where: whereNode,
        };
    }

    protected override transformJoin(node: JoinNode) {
        const table = this.extractTableName(node.table);
        if (!table) {
            // unable to extract table name, can be a subquery, which will be handled when nested transformation happens
            return super.transformJoin(node);
        }

        // build a nested query with policy filter applied
        const filter = this.buildPolicyFilter(table.model, table.alias, 'read');
        const nestedSelect: SelectQueryNode = {
            kind: 'SelectQueryNode',
            from: FromNode.create([node.table]),
            selections: [SelectionNode.createSelectAll()],
            where: WhereNode.create(filter),
        };
        return {
            ...node,
            table: AliasNode.create(ParensNode.create(nestedSelect), IdentifierNode.create(table.alias ?? table.model)),
        };
    }

    protected override transformInsertQuery(node: InsertQueryNode) {
        // pre-insert check is done in `handle()`

        let onConflict = node.onConflict;

        if (onConflict?.updates) {
            // for "on conflict do update", we need to apply policy filter to the "where" clause
            const { mutationModel, alias } = this.getMutationModel(node);
            const filter = this.buildPolicyFilter(mutationModel, alias, 'update');
            if (onConflict.updateWhere) {
                onConflict = {
                    ...onConflict,
                    updateWhere: WhereNode.create(conjunction(this.dialect, [onConflict.updateWhere.where, filter])),
                };
            } else {
                onConflict = {
                    ...onConflict,
                    updateWhere: WhereNode.create(filter),
                };
            }
        }

        // merge updated onConflict
        const processedNode = onConflict ? { ...node, onConflict } : node;

        const result = super.transformInsertQuery(processedNode);

        if (!node.returning) {
            return result;
        }

        if (this.onlyReturningId(node)) {
            return result;
        } else {
            // only return ID fields, that's enough for reading back the inserted row
            const { mutationModel } = this.getMutationModel(node);
            const idFields = requireIdFields(this.client.$schema, mutationModel);
            return {
                ...result,
                returning: ReturningNode.create(
                    idFields.map((field) => SelectionNode.create(ColumnNode.create(field))),
                ),
            };
        }
    }

    protected override transformUpdateQuery(node: UpdateQueryNode) {
        const result = super.transformUpdateQuery(node);
        const { mutationModel, alias } = this.getMutationModel(node);
        let filter = this.buildPolicyFilter(mutationModel, alias, 'update');

        if (node.from) {
            // for update with from (join), we need to merge join tables' policy filters to the "where" clause
            const joinFilter = this.createPolicyFilterForFrom(node.from);
            if (joinFilter) {
                filter = conjunction(this.dialect, [filter, joinFilter]);
            }
        }

        return {
            ...result,
            where: WhereNode.create(result.where ? conjunction(this.dialect, [result.where.where, filter]) : filter),
        };
    }

    protected override transformDeleteQuery(node: DeleteQueryNode) {
        const result = super.transformDeleteQuery(node);
        const { mutationModel, alias } = this.getMutationModel(node);
        let filter = this.buildPolicyFilter(mutationModel, alias, 'delete');

        if (node.using) {
            // for delete with using (join), we need to merge join tables' policy filters to the "where" clause
            const joinFilter = this.createPolicyFilterForTables(node.using.tables);
            if (joinFilter) {
                filter = conjunction(this.dialect, [filter, joinFilter]);
            }
        }

        return {
            ...result,
            where: WhereNode.create(result.where ? conjunction(this.dialect, [result.where.where, filter]) : filter),
        };
    }

    // #endregion

    // #region helpers

    private onlyReturningId(node: MutationQueryNode) {
        if (!node.returning) {
            return true;
        }
        const { mutationModel } = this.getMutationModel(node);
        const idFields = requireIdFields(this.client.$schema, mutationModel);
        const collector = new ColumnCollector();
        const selectedColumns = collector.collect(node.returning);
        return selectedColumns.every((c) => idFields.includes(c));
    }

    private async enforcePreCreatePolicy(
        node: InsertQueryNode,
        mutationModel: GetModels<Schema>,
        isManyToManyJoinTable: boolean,
        proceed: ProceedKyselyQueryFunction,
    ) {
        const fields = node.columns?.map((c) => c.column.name) ?? [];
        const valueRows = node.values
            ? this.unwrapCreateValueRows(node.values, mutationModel, fields, isManyToManyJoinTable)
            : [[]];
        for (const values of valueRows) {
            await this.enforcePreCreatePolicyForOne(
                mutationModel,
                fields,
                values.map((v) => v.node),
                proceed,
            );
        }
    }

    private async enforcePreCreatePolicyForOne(
        model: GetModels<Schema>,
        fields: string[],
        values: OperationNode[],
        proceed: ProceedKyselyQueryFunction,
    ) {
        const allFields = Object.keys(requireModel(this.client.$schema, model).fields);
        const allValues: OperationNode[] = [];

        for (const fieldName of allFields) {
            const index = fields.indexOf(fieldName);
            if (index >= 0) {
                allValues.push(values[index]!);
            } else {
                // set non-provided fields to null
                allValues.push(ValueNode.createImmediate(null));
            }
        }

        // create a `SELECT column1 as field1, column2 as field2, ... FROM (VALUES (...))` table for policy evaluation
        const constTable: SelectQueryNode = {
            kind: 'SelectQueryNode',
            from: FromNode.create([
                AliasNode.create(
                    ParensNode.create(ValuesNode.create([ValueListNode.create(allValues)])),
                    IdentifierNode.create('$t'),
                ),
            ]),
            selections: allFields.map((field, index) =>
                SelectionNode.create(
                    AliasNode.create(ColumnNode.create(`column${index + 1}`), IdentifierNode.create(field)),
                ),
            ),
        };

        const filter = this.buildPolicyFilter(model, undefined, 'create');

        const preCreateCheck: SelectQueryNode = {
            kind: 'SelectQueryNode',
            from: FromNode.create([AliasNode.create(constTable, IdentifierNode.create(model))]),
            selections: [
                SelectionNode.create(
                    AliasNode.create(
                        BinaryOperationNode.create(
                            FunctionNode.create('COUNT', [ValueNode.createImmediate(1)]),
                            OperatorNode.create('>'),
                            ValueNode.createImmediate(0),
                        ),
                        IdentifierNode.create('$condition'),
                    ),
                ),
            ],
            where: WhereNode.create(filter),
        };

        const result = await proceed(preCreateCheck);
        if (!result.rows[0]?.$condition) {
            throw new RejectedByPolicyError(model);
        }
    }

    private unwrapCreateValueRows(
        node: OperationNode,
        model: GetModels<Schema>,
        fields: string[],
        isManyToManyJoinTable: boolean,
    ) {
        if (ValuesNode.is(node)) {
            return node.values.map((v) => this.unwrapCreateValueRow(v.values, model, fields, isManyToManyJoinTable));
        } else if (PrimitiveValueListNode.is(node)) {
            return [this.unwrapCreateValueRow(node.values, model, fields, isManyToManyJoinTable)];
        } else {
            throw new InternalError(`Unexpected node kind: ${node.kind} for unwrapping create values`);
        }
    }

    private unwrapCreateValueRow(
        data: readonly unknown[],
        model: GetModels<Schema>,
        fields: string[],
        isImplicitManyToManyJoinTable: boolean,
    ) {
        invariant(data.length === fields.length, 'data length must match fields length');
        const result: { node: OperationNode; raw: unknown }[] = [];
        for (let i = 0; i < data.length; i++) {
            const item = data[i]!;
            if (typeof item === 'object' && item && 'kind' in item) {
                const fieldDef = requireField(this.client.$schema, model, fields[i]!);
                invariant(item.kind === 'ValueNode', 'expecting a ValueNode');
                result.push({
                    node: ValueNode.create(
                        this.dialect.transformPrimitive(
                            (item as ValueNode).value,
                            fieldDef.type as BuiltinType,
                            !!fieldDef.array,
                        ),
                    ),
                    raw: (item as ValueNode).value,
                });
            } else {
                let value: unknown = item;

                // many-to-many join table is not a model so we don't have field definitions,
                // but there's no need to transform values anyway because they're the fields
                // are all foreign keys
                if (!isImplicitManyToManyJoinTable) {
                    const fieldDef = requireField(this.client.$schema, model, fields[i]!);
                    value = this.dialect.transformPrimitive(item, fieldDef.type as BuiltinType, !!fieldDef.array);
                }
                if (Array.isArray(value)) {
                    result.push({
                        node: RawNode.createWithSql(this.dialect.buildArrayLiteralSQL(value)),
                        raw: value,
                    });
                } else {
                    result.push({ node: ValueNode.create(value), raw: value });
                }
            }
        }
        return result;
    }

    private tryGetConstantPolicy(model: GetModels<Schema>, operation: PolicyOperation) {
        const policies = this.getModelPolicies(model, operation);
        if (!policies.some((p) => p.kind === 'allow')) {
            // no allow -> unconditional deny
            return false;
        } else if (
            // unconditional deny
            policies.some((p) => p.kind === 'deny' && this.isTrueExpr(p.condition))
        ) {
            return false;
        } else if (
            // unconditional allow
            !policies.some((p) => p.kind === 'deny') &&
            policies.some((p) => p.kind === 'allow' && this.isTrueExpr(p.condition))
        ) {
            return true;
        } else {
            return undefined;
        }
    }

    private isTrueExpr(expr: Expression) {
        return ExpressionUtils.isLiteral(expr) && expr.value === true;
    }

    private async processReadBack(node: CrudQueryNode, result: QueryResult<any>, proceed: ProceedKyselyQueryFunction) {
        if (result.rows.length === 0) {
            return result;
        }

        if (!this.isMutationQueryNode(node) || !node.returning) {
            return result;
        }

        // do a select (with policy) in place of returning
        const { mutationModel } = this.getMutationModel(node);
        const idConditions = this.buildIdConditions(mutationModel, result.rows);
        const policyFilter = this.buildPolicyFilter(mutationModel, undefined, 'read');

        const select: SelectQueryNode = {
            kind: 'SelectQueryNode',
            from: FromNode.create([TableNode.create(mutationModel)]),
            where: WhereNode.create(conjunction(this.dialect, [idConditions, policyFilter])),
            selections: node.returning.selections,
        };
        const selectResult = await proceed(select);
        return selectResult;
    }

    private buildIdConditions(table: string, rows: any[]): OperationNode {
        const idFields = requireIdFields(this.client.$schema, table);
        return disjunction(
            this.dialect,
            rows.map((row) =>
                conjunction(
                    this.dialect,
                    idFields.map((field) =>
                        BinaryOperationNode.create(
                            ColumnNode.create(field),
                            OperatorNode.create('='),
                            ValueNode.create(row[field]),
                        ),
                    ),
                ),
            ),
        );
    }

    private getMutationModel(node: InsertQueryNode | UpdateQueryNode | DeleteQueryNode) {
        const r = match(node)
            .when(InsertQueryNode.is, (node) => ({
                mutationModel: getTableName(node.into) as GetModels<Schema>,
                alias: undefined,
            }))
            .when(UpdateQueryNode.is, (node) => {
                if (!node.table) {
                    throw new QueryError('Update query must have a table');
                }
                const r = this.extractTableName(node.table);
                return r ? { mutationModel: r.model, alias: r.alias } : undefined;
            })
            .when(DeleteQueryNode.is, (node) => {
                if (node.from.froms.length !== 1) {
                    throw new QueryError('Only one from table is supported for delete');
                }
                const r = this.extractTableName(node.from.froms[0]!);
                return r ? { mutationModel: r.model, alias: r.alias } : undefined;
            })
            .exhaustive();
        if (!r) {
            throw new InternalError(`Unable to get table name for query node: ${node}`);
        }
        return r;
    }

    private isCrudQueryNode(node: RootOperationNode): node is CrudQueryNode {
        return (
            SelectQueryNode.is(node) || InsertQueryNode.is(node) || UpdateQueryNode.is(node) || DeleteQueryNode.is(node)
        );
    }

    private isMutationQueryNode(node: RootOperationNode): node is MutationQueryNode {
        return InsertQueryNode.is(node) || UpdateQueryNode.is(node) || DeleteQueryNode.is(node);
    }

    buildPolicyFilter(model: GetModels<Schema>, alias: string | undefined, operation: CRUD) {
        // first check if it's a many-to-many join table, and if so, handle specially
        const m2mFilter = this.getModelPolicyFilterForManyToManyJoinTable(model, alias, operation);
        if (m2mFilter) {
            return m2mFilter;
        }

        const policies = this.getModelPolicies(model, operation);
        if (policies.length === 0) {
            return falseNode(this.dialect);
        }

        const allows = policies
            .filter((policy) => policy.kind === 'allow')
            .map((policy) => this.compilePolicyCondition(model, alias, operation, policy));

        const denies = policies
            .filter((policy) => policy.kind === 'deny')
            .map((policy) => this.compilePolicyCondition(model, alias, operation, policy));

        let combinedPolicy: OperationNode;

        if (allows.length === 0) {
            // constant false
            combinedPolicy = falseNode(this.dialect);
        } else {
            // or(...allows)
            combinedPolicy = disjunction(this.dialect, allows);

            // and(...!denies)
            if (denies.length !== 0) {
                const combinedDenies = conjunction(
                    this.dialect,
                    denies.map((d) => buildIsFalse(d, this.dialect)),
                );
                // or(...allows) && and(...!denies)
                combinedPolicy = conjunction(this.dialect, [combinedPolicy, combinedDenies]);
            }
        }
        return combinedPolicy;
    }

    private extractTableName(node: OperationNode): { model: GetModels<Schema>; alias?: string } | undefined {
        if (TableNode.is(node)) {
            return { model: node.table.identifier.name as GetModels<Schema> };
        }
        if (AliasNode.is(node)) {
            const inner = this.extractTableName(node.node);
            if (!inner) {
                return undefined;
            }
            return {
                model: inner.model,
                alias: IdentifierNode.is(node.alias) ? node.alias.name : undefined,
            };
        } else {
            // this can happen for subqueries, which will be handled when nested
            // transformation happens
            return undefined;
        }
    }

    private createPolicyFilterForFrom(node: FromNode | undefined) {
        if (!node) {
            return undefined;
        }
        return this.createPolicyFilterForTables(node.froms);
    }

    private createPolicyFilterForTables(tables: readonly OperationNode[]) {
        return tables.reduce<OperationNode | undefined>((acc, table) => {
            const extractResult = this.extractTableName(table);
            if (extractResult) {
                const { model, alias } = extractResult;
                const filter = this.buildPolicyFilter(model, alias, 'read');
                return acc ? conjunction(this.dialect, [acc, filter]) : filter;
            }
            return acc;
        }, undefined);
    }

    private compilePolicyCondition(
        model: GetModels<Schema>,
        alias: string | undefined,
        operation: CRUD,
        policy: Policy,
    ) {
        return new ExpressionTransformer(this.client).transform(policy.condition, {
            model,
            alias,
            operation,
            auth: this.client.$auth,
        });
    }

    private getModelPolicies(model: string, operation: PolicyOperation) {
        const modelDef = requireModel(this.client.$schema, model);
        const result: Policy[] = [];

        const extractOperations = (expr: Expression) => {
            invariant(ExpressionUtils.isLiteral(expr), 'expecting a literal');
            invariant(typeof expr.value === 'string', 'expecting a string literal');
            return expr.value
                .split(',')
                .filter((v) => !!v)
                .map((v) => v.trim()) as PolicyOperation[];
        };

        if (modelDef.attributes) {
            result.push(
                ...modelDef.attributes
                    .filter((attr) => attr.name === '@@allow' || attr.name === '@@deny')
                    .map(
                        (attr) =>
                            ({
                                kind: attr.name === '@@allow' ? 'allow' : 'deny',
                                operations: extractOperations(attr.args![0]!.value),
                                condition: attr.args![1]!.value,
                            }) as const,
                    )
                    .filter((policy) => policy.operations.includes('all') || policy.operations.includes(operation)),
            );
        }
        return result;
    }

    private isManyToManyJoinTable(tableName: string) {
        return Object.values(this.client.$schema.models).some((modelDef) => {
            return Object.values(modelDef.fields).some((field) => {
                const m2m = getManyToManyRelation(this.client.$schema, modelDef.name, field.name);
                return m2m?.joinTable === tableName;
            });
        });
    }

    private getModelPolicyFilterForManyToManyJoinTable(
        tableName: string,
        alias: string | undefined,
        operation: PolicyOperation,
    ): OperationNode | undefined {
        // find the m2m relation for this join table
        for (const model of Object.values(this.client.$schema.models)) {
            for (const field of Object.values(model.fields)) {
                const m2m = getManyToManyRelation(this.client.$schema, model.name, field.name);
                if (m2m?.joinTable !== tableName) {
                    continue;
                }

                // determine A/B side
                const sortedRecords = [
                    {
                        model: model.name,
                        field: field.name,
                    },
                    {
                        model: m2m.otherModel,
                        field: m2m.otherField,
                    },
                ].sort((a, b) =>
                    // the implicit m2m join table's "A", "B" fk fields' order is determined
                    // by model name's sort order, and when identical (for self-relations),
                    // field name's sort order
                    a.model !== b.model ? a.model.localeCompare(b.model) : a.field.localeCompare(b.field),
                );

                // join table's permission:
                //   - read: requires both sides to be readable
                //   - mutation: requires both sides to be updatable

                const queries: SelectQueryBuilder<any, any, any>[] = [];
                const eb = expressionBuilder<any, any>();

                for (const [fk, entry] of zip(['A', 'B'], sortedRecords)) {
                    const idFields = requireIdFields(this.client.$schema, entry.model);
                    invariant(
                        idFields.length === 1,
                        'only single-field id is supported for implicit many-to-many join table',
                    );

                    const policyFilter = this.buildPolicyFilter(
                        entry.model as GetModels<Schema>,
                        undefined,
                        operation === 'read' ? 'read' : 'update',
                    );
                    const query = eb
                        .selectFrom(entry.model)
                        .whereRef(`${entry.model}.${idFields[0]}`, '=', `${alias ?? tableName}.${fk}`)
                        .select(new ExpressionWrapper(policyFilter).as(`$condition${fk}`));
                    queries.push(query);
                }

                return eb.and(queries).toOperationNode();
            }
        }

        return undefined;
    }

    // #endregion
}
