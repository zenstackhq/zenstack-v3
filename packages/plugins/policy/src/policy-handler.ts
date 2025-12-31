import { invariant } from '@zenstackhq/common-helpers';
import type { BaseCrudDialect, ClientContract, ProceedKyselyQueryFunction } from '@zenstackhq/orm';
import { getCrudDialect, QueryUtils, RejectedByPolicyReason, SchemaUtils, type CRUD_EXT } from '@zenstackhq/orm';
import {
    ExpressionUtils,
    type BuiltinType,
    type Expression,
    type MemberExpression,
    type SchemaDef,
} from '@zenstackhq/orm/schema';
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
    ReferenceNode,
    ReturningNode,
    SelectAllNode,
    SelectionNode,
    SelectQueryNode,
    sql,
    TableNode,
    UpdateQueryNode,
    ValueListNode,
    ValueNode,
    ValuesNode,
    WhereNode,
    type OperationNode,
    type QueryResult,
    type RootOperationNode,
} from 'kysely';
import { match } from 'ts-pattern';
import { ColumnCollector } from './column-collector';
import { ExpressionTransformer } from './expression-transformer';
import type { Policy, PolicyOperation } from './types';
import {
    buildIsFalse,
    conjunction,
    createRejectedByPolicyError,
    createUnsupportedError,
    disjunction,
    falseNode,
    getColumnName,
    getTableName,
    isBeforeInvocation,
    trueNode,
} from './utils';

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

    async handle(node: RootOperationNode, proceed: ProceedKyselyQueryFunction) {
        if (!this.isCrudQueryNode(node)) {
            // non-CRUD queries are not allowed
            throw createRejectedByPolicyError(
                undefined,
                RejectedByPolicyReason.OTHER,
                'non-CRUD queries are not allowed',
            );
        }

        if (!this.isMutationQueryNode(node)) {
            // transform and proceed with read directly
            return proceed(this.transformNode(node));
        }

        const { mutationModel } = this.getMutationModel(node);

        this.tryRejectNonexistentModel(mutationModel);

        // --- Pre mutation work ---

        if (InsertQueryNode.is(node)) {
            // pre-create policy evaluation happens before execution of the query
            const isManyToManyJoinTable = this.isManyToManyJoinTable(mutationModel);
            let needCheckPreCreate = true;

            // many-to-many join table is not a model so can't have policies on it
            if (!isManyToManyJoinTable) {
                // check constant policies
                const constCondition = this.tryGetConstantPolicy(mutationModel, 'create');
                if (constCondition === true) {
                    needCheckPreCreate = false;
                } else if (constCondition === false) {
                    throw createRejectedByPolicyError(mutationModel, RejectedByPolicyReason.NO_ACCESS);
                }
            }

            if (needCheckPreCreate) {
                await this.enforcePreCreatePolicy(node, mutationModel, isManyToManyJoinTable, proceed);
            }
        }

        const hasPostUpdatePolicies = UpdateQueryNode.is(node) && this.hasPostUpdatePolicies(mutationModel);

        let beforeUpdateInfo: Awaited<ReturnType<typeof this.loadBeforeUpdateEntities>> | undefined;
        if (hasPostUpdatePolicies) {
            beforeUpdateInfo = await this.loadBeforeUpdateEntities(mutationModel, node.where, proceed);
        }

        // proceed with query

        const result = await proceed(this.transformNode(node));

        // --- Post mutation work ---

        if (hasPostUpdatePolicies && result.rows.length > 0) {
            // verify if before-update rows and post-update rows still id-match
            if (beforeUpdateInfo) {
                invariant(beforeUpdateInfo.rows.length === result.rows.length);
                const idFields = QueryUtils.requireIdFields(this.client.$schema, mutationModel);
                for (const postRow of result.rows) {
                    const beforeRow = beforeUpdateInfo.rows.find((r) => idFields.every((f) => r[f] === postRow[f]));
                    if (!beforeRow) {
                        throw createRejectedByPolicyError(
                            mutationModel,
                            RejectedByPolicyReason.OTHER,
                            'Before-update and after-update rows do not match by id. If you have post-update policies on a model, updating id fields is not supported.',
                        );
                    }
                }
            }

            // entities updated filter
            const idConditions = this.buildIdConditions(mutationModel, result.rows);

            // post-update policy filter
            const postUpdateFilter = this.buildPolicyFilter(mutationModel, undefined, 'post-update');

            // read the post-update row with filter applied

            const eb = expressionBuilder<any, any>();

            // create a `SELECT column1 as field1, column2 as field2, ... FROM (VALUES (...))` table for before-update rows
            const beforeUpdateTable: SelectQueryNode | undefined = beforeUpdateInfo
                ? {
                      kind: 'SelectQueryNode',
                      from: FromNode.create([
                          ParensNode.create(
                              ValuesNode.create(
                                  beforeUpdateInfo!.rows.map((r) =>
                                      PrimitiveValueListNode.create(beforeUpdateInfo!.fields.map((f) => r[f])),
                                  ),
                              ),
                          ),
                      ]),
                      selections: beforeUpdateInfo.fields.map((name, index) => {
                          const def = QueryUtils.requireField(this.client.$schema, mutationModel, name);
                          const castedColumnRef =
                              sql`CAST(${eb.ref(`column${index + 1}`)} as ${sql.raw(this.dialect.getFieldSqlType(def))})`.as(
                                  name,
                              );
                          return SelectionNode.create(castedColumnRef.toOperationNode());
                      }),
                  }
                : undefined;

            const postUpdateQuery = eb
                .selectFrom(mutationModel)
                .select(() => [eb(eb.fn('COUNT', [eb.lit(1)]), '=', result.rows.length).as('$condition')])
                .where(() => new ExpressionWrapper(conjunction(this.dialect, [idConditions, postUpdateFilter])))
                .$if(!!beforeUpdateInfo, (qb) =>
                    qb.leftJoin(
                        () => new ExpressionWrapper(beforeUpdateTable!).as('$before'),
                        (join) => {
                            const idFields = QueryUtils.requireIdFields(this.client.$schema, mutationModel);
                            return idFields.reduce(
                                (acc, f) => acc.onRef(`${mutationModel}.${f}`, '=', `$before.${f}`),
                                join,
                            );
                        },
                    ),
                );

            const postUpdateResult = await proceed(postUpdateQuery.toOperationNode());
            if (!postUpdateResult.rows[0]?.$condition) {
                throw createRejectedByPolicyError(
                    mutationModel,
                    RejectedByPolicyReason.NO_ACCESS,
                    'some or all updated rows failed to pass post-update policy check',
                );
            }
        }

        // --- Read back ---

        if (!node.returning || this.onlyReturningId(node)) {
            // no need to check read back
            return this.postProcessMutationResult(result, node);
        } else {
            const readBackResult = await this.processReadBack(node, result, proceed);
            if (readBackResult.rows.length !== result.rows.length) {
                throw createRejectedByPolicyError(
                    mutationModel,
                    RejectedByPolicyReason.CANNOT_READ_BACK,
                    'result is not allowed to be read back',
                );
            }
            return readBackResult;
        }
    }

    // correction to kysely mutation result may be needed because we might have added
    // returning clause to the query and caused changes to the result shape
    private postProcessMutationResult(result: QueryResult<any>, node: MutationQueryNode) {
        if (node.returning) {
            return result;
        } else {
            return {
                ...result,
                rows: [],
                numAffectedRows: result.numAffectedRows ?? BigInt(result.rows.length),
            };
        }
    }

    hasPostUpdatePolicies(model: string) {
        const policies = this.getModelPolicies(model, 'post-update');
        return policies.length > 0;
    }

    private async loadBeforeUpdateEntities(
        model: string,
        where: WhereNode | undefined,
        proceed: ProceedKyselyQueryFunction,
    ) {
        const beforeUpdateAccessFields = this.getFieldsAccessForBeforeUpdatePolicies(model);
        if (!beforeUpdateAccessFields || beforeUpdateAccessFields.length === 0) {
            return undefined;
        }

        // combine update's where with policy filter
        const policyFilter = this.buildPolicyFilter(model, model, 'update');
        const combinedFilter = where ? conjunction(this.dialect, [where.where, policyFilter]) : policyFilter;

        const query: SelectQueryNode = {
            kind: 'SelectQueryNode',
            from: FromNode.create([TableNode.create(model)]),
            where: WhereNode.create(combinedFilter),
            selections: [...beforeUpdateAccessFields.map((f) => SelectionNode.create(ColumnNode.create(f)))],
        };
        const result = await proceed(query);
        return { fields: beforeUpdateAccessFields, rows: result.rows };
    }

    private getFieldsAccessForBeforeUpdatePolicies(model: string) {
        const policies = this.getModelPolicies(model, 'post-update');
        if (policies.length === 0) {
            return undefined;
        }

        const fields = new Set<string>();
        const fieldCollector = new (class extends SchemaUtils.ExpressionVisitor {
            protected override visitMember(e: MemberExpression): void {
                if (isBeforeInvocation(e.receiver)) {
                    invariant(e.members.length === 1, 'before() can only be followed by a scalar field access');
                    fields.add(e.members[0]!);
                }
                super.visitMember(e);
            }
        })();

        for (const policy of policies) {
            fieldCollector.visit(policy.condition);
        }

        if (fields.size === 0) {
            return undefined;
        }

        // make sure id fields are included
        QueryUtils.requireIdFields(this.client.$schema, model).forEach((f) => fields.add(f));

        return Array.from(fields).sort();
    }

    // #region overrides

    protected override transformSelectQuery(node: SelectQueryNode) {
        if (!node.from) {
            return super.transformSelectQuery(node);
        }

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

        let selections = baseResult.selections;
        const model = getTableName(node.from);
        if (model && selections?.some((selection) => this.involvesFieldLevelPolicy(model, selection))) {
            const updatedSelections: SelectionNode[] = [];
            for (const selection of selections) {
                updatedSelections.push(this.injectSelectionWithFieldLevelPolicy(model, selection));
            }
            selections = updatedSelections;
        }

        return {
            ...baseResult,
            selections,
            where: whereNode,
        };
    }

    private involvesFieldLevelPolicy(model: string, selection: SelectionNode): boolean {
        const modelDef = QueryUtils.requireModel(this.client.$schema, model);

        const hasFieldLevelPolicy = (fieldName: string) => {
            const fieldDef = modelDef.fields[fieldName];
            if (!fieldDef) {
                return false;
            }
            return !!fieldDef.attributes?.some((attr) => ['@allow', '@deny'].includes(attr.name));
        };

        if (SelectAllNode.is(selection.selection)) {
            const fields = Object.keys(modelDef.fields);
            return fields.some(hasFieldLevelPolicy);
        } else {
            const column = getColumnName(selection.selection);
            return column ? hasFieldLevelPolicy(column) : false;
        }
    }

    private injectSelectionWithFieldLevelPolicy(model: string, selection: SelectionNode): SelectionNode {
        throw new Error('Method not implemented.');
    }

    protected override transformJoin(node: JoinNode) {
        const table = this.extractTableName(node.table);
        if (!table) {
            // unable to extract table name, can be a subquery, which will be handled when nested transformation happens
            return super.transformJoin(node);
        }

        this.tryRejectNonexistentModel(table.model);

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

        // if any field is to be returned, we select ID fields here which will be used
        // for reading back post-insert
        let returning = result.returning;
        if (returning) {
            const { mutationModel } = this.getMutationModel(node);
            const idFields = QueryUtils.requireIdFields(this.client.$schema, mutationModel);
            returning = ReturningNode.create(idFields.map((f) => SelectionNode.create(ColumnNode.create(f))));
        }

        return {
            ...result,
            returning,
        };
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

        let returning = result.returning;

        // regarding returning:
        // 1. if fields are to be returned, we only select id fields here which will be used for reading back
        //    post-update
        // 2. if there are post-update policies, we need to make sure id fields are selected for joining with
        //    before-update rows

        if (returning || this.hasPostUpdatePolicies(mutationModel)) {
            const idFields = QueryUtils.requireIdFields(this.client.$schema, mutationModel);
            returning = ReturningNode.create(idFields.map((f) => SelectionNode.create(ColumnNode.create(f))));
        }

        return {
            ...result,
            where: WhereNode.create(result.where ? conjunction(this.dialect, [result.where.where, filter]) : filter),
            returning,
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
        const idFields = QueryUtils.requireIdFields(this.client.$schema, mutationModel);

        if (node.returning.selections.some((s) => SelectAllNode.is(s.selection))) {
            const modelDef = QueryUtils.requireModel(this.client.$schema, mutationModel);
            if (Object.keys(modelDef.fields).some((f) => !idFields.includes(f))) {
                // there are fields other than ID fields
                return false;
            } else {
                // select all but model only has ID fields
                return true;
            }
        }

        // analyze selected columns
        const collector = new ColumnCollector();
        const selectedColumns = collector.collect(node.returning);
        return selectedColumns.every((c) => idFields.includes(c));
    }

    private async enforcePreCreatePolicy(
        node: InsertQueryNode,
        mutationModel: string,
        isManyToManyJoinTable: boolean,
        proceed: ProceedKyselyQueryFunction,
    ) {
        const fields = node.columns?.map((c) => c.column.name) ?? [];
        const valueRows = node.values
            ? this.unwrapCreateValueRows(node.values, mutationModel, fields, isManyToManyJoinTable)
            : [[]];
        for (const values of valueRows) {
            if (isManyToManyJoinTable) {
                await this.enforcePreCreatePolicyForManyToManyJoinTable(
                    mutationModel,
                    fields,
                    values.map((v) => v.node),
                    proceed,
                );
            } else {
                await this.enforcePreCreatePolicyForOne(
                    mutationModel,
                    fields,
                    values.map((v) => v.node),
                    proceed,
                );
            }
        }
    }

    private async enforcePreCreatePolicyForManyToManyJoinTable(
        tableName: string,
        fields: string[],
        values: OperationNode[],
        proceed: ProceedKyselyQueryFunction,
    ) {
        const m2m = this.resolveManyToManyJoinTable(tableName);
        invariant(m2m);

        // m2m create requires both sides to be updatable
        invariant(fields.includes('A') && fields.includes('B'), 'many-to-many join table must have A and B fk fields');

        const aIndex = fields.indexOf('A');
        const aNode = values[aIndex]!;
        const bIndex = fields.indexOf('B');
        const bNode = values[bIndex]!;
        invariant(ValueNode.is(aNode) && ValueNode.is(bNode), 'A and B values must be ValueNode');

        const aValue = aNode.value;
        const bValue = bNode.value;
        invariant(aValue !== null && aValue !== undefined, 'A value cannot be null or undefined');
        invariant(bValue !== null && bValue !== undefined, 'B value cannot be null or undefined');

        const eb = expressionBuilder<any, any>();

        const filterA = this.buildPolicyFilter(m2m.firstModel, undefined, 'update');
        const queryA = eb
            .selectFrom(m2m.firstModel)
            .where(eb(eb.ref(`${m2m.firstModel}.${m2m.firstIdField}`), '=', aValue))
            .select(() => new ExpressionWrapper(filterA).as('$t'));

        const filterB = this.buildPolicyFilter(m2m.secondModel, undefined, 'update');
        const queryB = eb
            .selectFrom(m2m.secondModel)
            .where(eb(eb.ref(`${m2m.secondModel}.${m2m.secondIdField}`), '=', bValue))
            .select(() => new ExpressionWrapper(filterB).as('$t'));

        // select both conditions in one query
        const queryNode: SelectQueryNode = {
            kind: 'SelectQueryNode',
            selections: [
                SelectionNode.create(AliasNode.create(queryA.toOperationNode(), IdentifierNode.create('$conditionA'))),
                SelectionNode.create(AliasNode.create(queryB.toOperationNode(), IdentifierNode.create('$conditionB'))),
            ],
        };

        const result = await proceed(queryNode);
        if (!result.rows[0]?.$conditionA) {
            throw createRejectedByPolicyError(
                m2m.firstModel,
                RejectedByPolicyReason.CANNOT_READ_BACK,
                `many-to-many relation participant model "${m2m.firstModel}" not updatable`,
            );
        }
        if (!result.rows[0]?.$conditionB) {
            throw createRejectedByPolicyError(
                m2m.secondModel,
                RejectedByPolicyReason.NO_ACCESS,
                `many-to-many relation participant model "${m2m.secondModel}" not updatable`,
            );
        }
    }

    private async enforcePreCreatePolicyForOne(
        model: string,
        fields: string[],
        values: OperationNode[],
        proceed: ProceedKyselyQueryFunction,
    ) {
        const allFields = Object.entries(QueryUtils.requireModel(this.client.$schema, model).fields).filter(
            ([, def]) => !def.relation,
        );
        const allValues: OperationNode[] = [];

        for (const [name, _def] of allFields) {
            const index = fields.indexOf(name);
            if (index >= 0) {
                allValues.push(values[index]!);
            } else {
                // set non-provided fields to null
                allValues.push(ValueNode.createImmediate(null));
            }
        }

        // create a `SELECT column1 as field1, column2 as field2, ... FROM (VALUES (...))` table for policy evaluation
        const eb = expressionBuilder<any, any>();

        const constTable: SelectQueryNode = {
            kind: 'SelectQueryNode',
            from: FromNode.create([
                AliasNode.create(
                    ParensNode.create(ValuesNode.create([ValueListNode.create(allValues)])),
                    IdentifierNode.create('$t'),
                ),
            ]),
            selections: allFields.map(([name, def], index) => {
                const castedColumnRef =
                    sql`CAST(${eb.ref(`column${index + 1}`)} as ${sql.raw(this.dialect.getFieldSqlType(def))})`.as(
                        name,
                    );
                return SelectionNode.create(castedColumnRef.toOperationNode());
            }),
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
            throw createRejectedByPolicyError(model, RejectedByPolicyReason.NO_ACCESS);
        }
    }

    private unwrapCreateValueRows(
        node: OperationNode,
        model: string,
        fields: string[],
        isManyToManyJoinTable: boolean,
    ) {
        if (ValuesNode.is(node)) {
            return node.values.map((v) => this.unwrapCreateValueRow(v.values, model, fields, isManyToManyJoinTable));
        } else if (PrimitiveValueListNode.is(node)) {
            return [this.unwrapCreateValueRow(node.values, model, fields, isManyToManyJoinTable)];
        } else {
            invariant(false, `Unexpected node kind: ${node.kind} for unwrapping create values`);
        }
    }

    private unwrapCreateValueRow(
        data: readonly unknown[],
        model: string,
        fields: string[],
        isImplicitManyToManyJoinTable: boolean,
    ) {
        invariant(data.length === fields.length, 'data length must match fields length');
        const result: { node: OperationNode; raw: unknown }[] = [];
        for (let i = 0; i < data.length; i++) {
            const item = data[i]!;
            if (typeof item === 'object' && item && 'kind' in item) {
                const fieldDef = QueryUtils.requireField(this.client.$schema, model, fields[i]!);
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
                    const fieldDef = QueryUtils.requireField(this.client.$schema, model, fields[i]!);
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

    private tryGetConstantPolicy(model: string, operation: PolicyOperation) {
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
        const idFields = QueryUtils.requireIdFields(this.client.$schema, table);
        return disjunction(
            this.dialect,
            rows.map((row) =>
                conjunction(
                    this.dialect,
                    idFields.map((field) =>
                        BinaryOperationNode.create(
                            ReferenceNode.create(ColumnNode.create(field), TableNode.create(table)),
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
                mutationModel: getTableName(node.into)!,
                alias: undefined,
            }))
            .when(UpdateQueryNode.is, (node) => {
                if (!node.table) {
                    invariant(false, 'Update query must have a table');
                }
                const r = this.extractTableName(node.table);
                return r ? { mutationModel: r.model, alias: r.alias } : undefined;
            })
            .when(DeleteQueryNode.is, (node) => {
                if (node.from.froms.length !== 1) {
                    throw createUnsupportedError('Only one from table is supported for delete');
                }
                const r = this.extractTableName(node.from.froms[0]!);
                return r ? { mutationModel: r.model, alias: r.alias } : undefined;
            })
            .exhaustive();
        if (!r) {
            invariant(false, `Unable to get table name for query node: ${node}`);
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

    buildPolicyFilter(model: string, alias: string | undefined, operation: CRUD_EXT): OperationNode {
        // first check if it's a many-to-many join table, and if so, handle specially
        const m2mFilter = this.getModelPolicyFilterForManyToManyJoinTable(model, alias, operation);
        if (m2mFilter) {
            return m2mFilter;
        }

        const policies = this.getModelPolicies(model, operation);

        const allows = policies
            .filter((policy) => policy.kind === 'allow')
            .map((policy) => this.compilePolicyCondition(model, alias, operation, policy));

        const denies = policies
            .filter((policy) => policy.kind === 'deny')
            .map((policy) => this.compilePolicyCondition(model, alias, operation, policy));

        // 'post-update' is by default allowed, other operations are by default denied
        let combinedPolicy: OperationNode;

        if (allows.length === 0) {
            // no allow rules
            if (operation === 'post-update') {
                // post-update is allowed if no allow rules are defined
                combinedPolicy = trueNode(this.dialect);
            } else {
                // other operations are denied by default
                combinedPolicy = falseNode(this.dialect);
            }
        } else {
            // or(...allows)
            combinedPolicy = disjunction(this.dialect, allows);
        }

        // and(...!denies)
        if (denies.length !== 0) {
            const combinedDenies = conjunction(
                this.dialect,
                denies.map((d) => buildIsFalse(d, this.dialect)),
            );
            // or(...allows) && and(...!denies)
            combinedPolicy = conjunction(this.dialect, [combinedPolicy, combinedDenies]);
        }

        return combinedPolicy;
    }

    private extractTableName(node: OperationNode): { model: string; alias?: string } | undefined {
        if (TableNode.is(node)) {
            return { model: node.table.identifier.name };
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
                this.tryRejectNonexistentModel(model);
                const filter = this.buildPolicyFilter(model, alias, 'read');
                return acc ? conjunction(this.dialect, [acc, filter]) : filter;
            }
            return acc;
        }, undefined);
    }

    private compilePolicyCondition(model: string, alias: string | undefined, operation: CRUD_EXT, policy: Policy) {
        return new ExpressionTransformer(this.client).transform(policy.condition, {
            modelOrType: model,
            thisType: model, // type name for `this`, never changed during the entire transformation
            thisAlias: alias, // alias for `this`, never changed during the entire transformation
            alias,
            operation,
        });
    }

    private getModelPolicies(model: string, operation: PolicyOperation) {
        const modelDef = QueryUtils.requireModel(this.client.$schema, model);
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
                    .filter(
                        (policy) =>
                            (operation !== 'post-update' && policy.operations.includes('all')) ||
                            policy.operations.includes(operation),
                    ),
            );
        }
        return result;
    }

    private resolveManyToManyJoinTable(tableName: string) {
        for (const model of Object.values(this.client.$schema.models)) {
            for (const field of Object.values(model.fields)) {
                const m2m = QueryUtils.getManyToManyRelation(this.client.$schema, model.name, field.name);
                if (m2m?.joinTable === tableName) {
                    const sortedRecord = [
                        {
                            model: model.name,
                            field: field.name,
                        },
                        {
                            model: m2m.otherModel,
                            field: m2m.otherField,
                        },
                    ].sort(this.manyToManySorter);

                    const firstIdFields = QueryUtils.requireIdFields(this.client.$schema, sortedRecord[0]!.model);
                    const secondIdFields = QueryUtils.requireIdFields(this.client.$schema, sortedRecord[1]!.model);
                    invariant(
                        firstIdFields.length === 1 && secondIdFields.length === 1,
                        'only single-field id is supported for implicit many-to-many join table',
                    );

                    return {
                        firstModel: sortedRecord[0]!.model,
                        firstField: sortedRecord[0]!.field,
                        firstIdField: firstIdFields[0]!,
                        secondModel: sortedRecord[1]!.model,
                        secondField: sortedRecord[1]!.field,
                        secondIdField: secondIdFields[0]!,
                    };
                }
            }
        }
        return undefined;
    }

    private manyToManySorter(a: { model: string; field: string }, b: { model: string; field: string }): number {
        // the implicit m2m join table's "A", "B" fk fields' order is determined
        // by model name's sort order, and when identical (for self-relations),
        // field name's sort order
        return a.model !== b.model ? a.model.localeCompare(b.model) : a.field.localeCompare(b.field);
    }

    private isManyToManyJoinTable(tableName: string) {
        return !!this.resolveManyToManyJoinTable(tableName);
    }

    private getModelPolicyFilterForManyToManyJoinTable(
        tableName: string,
        alias: string | undefined,
        operation: PolicyOperation,
    ): OperationNode | undefined {
        const m2m = this.resolveManyToManyJoinTable(tableName);
        if (!m2m) {
            return undefined;
        }

        // join table's permission:
        //   - read: requires both sides to be readable
        //   - mutation: requires both sides to be updatable

        const checkForOperation = operation === 'read' ? 'read' : 'update';
        const eb = expressionBuilder<any, any>();
        const joinTable = alias ?? tableName;

        const aQuery = eb
            .selectFrom(m2m.firstModel)
            .whereRef(`${m2m.firstModel}.${m2m.firstIdField}`, '=', `${joinTable}.A`)
            .select(() =>
                new ExpressionWrapper(this.buildPolicyFilter(m2m.firstModel, undefined, checkForOperation)).as(
                    '$conditionA',
                ),
            );

        const bQuery = eb
            .selectFrom(m2m.secondModel)
            .whereRef(`${m2m.secondModel}.${m2m.secondIdField}`, '=', `${joinTable}.B`)
            .select(() =>
                new ExpressionWrapper(this.buildPolicyFilter(m2m.secondModel, undefined, checkForOperation)).as(
                    '$conditionB',
                ),
            );

        return eb.and([aQuery, bQuery]).toOperationNode();
    }

    private tryRejectNonexistentModel(model: string) {
        if (!QueryUtils.hasModel(this.client.$schema, model) && !this.isManyToManyJoinTable(model)) {
            throw createRejectedByPolicyError(model, RejectedByPolicyReason.NO_ACCESS);
        }
    }

    // #endregion
}
