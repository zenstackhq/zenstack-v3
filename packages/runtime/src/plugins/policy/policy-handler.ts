import {
    AliasNode,
    BinaryOperationNode,
    ColumnNode,
    DeleteQueryNode,
    FromNode,
    IdentifierNode,
    InsertQueryNode,
    OperationNodeTransformer,
    OperatorNode,
    PrimitiveValueListNode,
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
} from 'kysely';
import invariant from 'tiny-invariant';
import { match } from 'ts-pattern';
import type { ClientContract } from '../../client';
import { getCrudDialect } from '../../client/crud/dialects';
import type { BaseCrudDialect } from '../../client/crud/dialects/base';
import { InternalError } from '../../client/errors';
import type {
    OnKyselyQueryTransaction,
    ProceedKyselyQueryFunction,
} from '../../client/plugin';
import { getIdFields, requireModel } from '../../client/query-utils';
import { Expression, type GetModels, type SchemaDef } from '../../schema';
import { ColumnCollector } from './column-collector';
import { RejectedByPolicyError } from './errors';
import { ExpressionTransformer } from './expression-transformer';
import type { Policy, PolicyOperation } from './types';
import {
    buildIsFalse,
    conjunction,
    disjunction,
    falseNode,
    getTableName,
} from './utils';

export type CrudQueryNode =
    | SelectQueryNode
    | InsertQueryNode
    | UpdateQueryNode
    | DeleteQueryNode;

export type MutationQueryNode =
    | InsertQueryNode
    | UpdateQueryNode
    | DeleteQueryNode;

export class PolicyHandler<
    Schema extends SchemaDef
> extends OperationNodeTransformer {
    private readonly dialect: BaseCrudDialect<Schema>;

    constructor(private readonly client: ClientContract<Schema>) {
        super();
        this.dialect = getCrudDialect(
            this.client.$schema,
            this.client.$options
        );
    }

    get kysely() {
        return this.client.$qb;
    }

    async handle(
        node: RootOperationNode,
        proceed: ProceedKyselyQueryFunction,
        transaction: OnKyselyQueryTransaction
    ) {
        if (!this.isCrudQueryNode(node)) {
            // non CRUD queries are not allowed
            throw new RejectedByPolicyError('non CRUD queries are not allowed');
        }

        if (!this.isMutationQueryNode(node)) {
            // transform and proceed read without transaction
            return proceed(this.transformNode(node));
        }

        let mutationRequiresTransaction = false;
        const mutationModel = this.getMutationModel(node);

        if (InsertQueryNode.is(node)) {
            // reject create if unconditional deny
            const constCondition = this.tryGetConstantPolicy(
                mutationModel,
                'create'
            );
            if (constCondition === false) {
                throw new RejectedByPolicyError();
            } else if (constCondition === undefined) {
                mutationRequiresTransaction = true;
            }
        }

        if (!mutationRequiresTransaction && !node.returning) {
            // transform and proceed mutation without transaction
            return proceed(this.transformNode(node));
        }

        let readBackError = false;

        // transform and post-process in a transaction
        const result = await transaction(async (txProceed) => {
            if (InsertQueryNode.is(node)) {
                await this.enforcePreCreatePolicy(node, txProceed);
            }
            const transformedNode = this.transformNode(node);
            const result = await txProceed(transformedNode);

            if (!InsertQueryNode.is(node) || !this.onlyReturningId(node)) {
                const readBackResult = await this.processReadBack(
                    node,
                    result,
                    txProceed
                );
                if (readBackResult.rows.length !== result.rows.length) {
                    readBackError = true;
                }
                return readBackResult;
            } else {
                return result;
            }
        });

        if (readBackError) {
            throw new RejectedByPolicyError(
                'result is not allowed to be read back'
            );
        }

        return result;
    }

    private onlyReturningId(node: InsertQueryNode) {
        if (!node.returning) {
            return true;
        }
        const idFields = getIdFields(
            this.client.$schema,
            this.getMutationModel(node)
        );
        const collector = new ColumnCollector();
        const selectedColumns = collector.collect(node.returning);
        return selectedColumns.every((c) => idFields.includes(c));
    }

    private async enforcePreCreatePolicy(
        node: InsertQueryNode,
        proceed: ProceedKyselyQueryFunction
    ) {
        if (!node.columns || !node.values) {
            return;
        }

        const thisEntity: Record<string, OperationNode> = {};
        const values = this.unwrapCreateValues(node.values);
        for (let i = 0; i < node.columns?.length; i++) {
            thisEntity[node.columns![i]!.column.name] = values[i]!;
        }

        const model = this.getMutationModel(node);
        const filter = this.buildPolicyFilter(
            model,
            undefined,
            'create',
            thisEntity
        );
        const preCreateCheck: SelectQueryNode = {
            kind: 'SelectQueryNode',
            selections: [
                SelectionNode.create(
                    AliasNode.create(
                        filter,
                        IdentifierNode.create('$condition')
                    )
                ),
            ],
        };
        const result = await proceed(preCreateCheck);
        if (!(result.rows[0] as any)?.$condition) {
            throw new RejectedByPolicyError();
        }
    }

    private unwrapCreateValues(node: OperationNode): readonly OperationNode[] {
        if (ValuesNode.is(node)) {
            if (node.values.length === 1 && this.isValueList(node.values[0]!)) {
                return this.unwrapCreateValues(node.values[0]!);
            } else {
                return node.values;
            }
        } else if (PrimitiveValueListNode.is(node)) {
            return node.values.map((v) => ValueNode.create(v));
        } else {
            throw new InternalError(
                `Unexpected node kind: ${node.kind} for unwrapping create values`
            );
        }
    }

    private isValueList(node: OperationNode) {
        return ValueListNode.is(node) || PrimitiveValueListNode.is(node);
    }

    private tryGetConstantPolicy(
        model: GetModels<Schema>,
        operation: PolicyOperation
    ) {
        const policies = this.getModelPolicies(model, operation);
        if (!policies.some((p) => p.kind === 'allow')) {
            // no allow -> unconditional deny
            return false;
        } else if (
            // unconditional deny
            policies.some(
                (p) => p.kind === 'deny' && this.isTrueExpr(p.condition)
            )
        ) {
            return false;
        } else if (
            // unconditional allow
            !policies.some((p) => p.kind === 'deny') &&
            policies.some(
                (p) => p.kind === 'allow' && this.isTrueExpr(p.condition)
            )
        ) {
            return true;
        } else {
            return undefined;
        }
    }

    private isTrueExpr(expr: Expression) {
        return Expression.isLiteral(expr) && expr.value === true;
    }

    private async processReadBack(
        node: CrudQueryNode,
        result: QueryResult<any>,
        proceed: ProceedKyselyQueryFunction
    ) {
        if (result.rows.length === 0) {
            return result;
        }

        if (!this.isMutationQueryNode(node) || !node.returning) {
            return result;
        }

        // do a select (with policy) in place of returning
        const table = this.getMutationModel(node);
        if (!table) {
            throw new InternalError(
                `Unable to get table name for query node: ${node}`
            );
        }

        const idConditions = this.buildIdConditions(table, result.rows);
        const policyFilter = this.buildPolicyFilter(table, undefined, 'read');

        const select: SelectQueryNode = {
            kind: 'SelectQueryNode',
            from: FromNode.create([TableNode.create(table)]),
            where: WhereNode.create(
                conjunction(this.dialect, [idConditions, policyFilter])
            ),
            selections: node.returning.selections,
        };
        const selectResult = await proceed(select);
        return selectResult;
    }

    private buildIdConditions(table: string, rows: any[]): OperationNode {
        const idFields = getIdFields(this.client.$schema, table);
        return disjunction(
            this.dialect,
            rows.map((row) =>
                conjunction(
                    this.dialect,
                    idFields.map((field) =>
                        BinaryOperationNode.create(
                            ColumnNode.create(field),
                            OperatorNode.create('='),
                            ValueNode.create(row[field])
                        )
                    )
                )
            )
        );
    }

    private getMutationModel(
        node: InsertQueryNode | UpdateQueryNode | DeleteQueryNode
    ) {
        const r = match(node)
            .when(
                InsertQueryNode.is,
                (node) => getTableName(node.into) as GetModels<Schema>
            )
            .when(
                UpdateQueryNode.is,
                (node) => getTableName(node.table) as GetModels<Schema>
            )
            .when(DeleteQueryNode.is, (node) => {
                if (node.from.froms.length !== 1) {
                    throw new InternalError(
                        'Only one from table is supported for delete'
                    );
                }
                return getTableName(node.from.froms[0]) as GetModels<Schema>;
            })
            .exhaustive();
        if (!r) {
            throw new InternalError(
                `Unable to get table name for query node: ${node}`
            );
        }
        return r;
    }

    private isCrudQueryNode(node: RootOperationNode): node is CrudQueryNode {
        return (
            SelectQueryNode.is(node) ||
            InsertQueryNode.is(node) ||
            UpdateQueryNode.is(node) ||
            DeleteQueryNode.is(node)
        );
    }

    private isMutationQueryNode(
        node: RootOperationNode
    ): node is MutationQueryNode {
        return (
            InsertQueryNode.is(node) ||
            UpdateQueryNode.is(node) ||
            DeleteQueryNode.is(node)
        );
    }

    private buildPolicyFilter(
        model: GetModels<Schema>,
        alias: string | undefined,
        operation: PolicyOperation,
        thisEntity?: Record<string, OperationNode>
    ) {
        const policies = this.getModelPolicies(model, operation);
        if (policies.length === 0) {
            return falseNode(this.dialect);
        }

        const allows = policies
            .filter((policy) => policy.kind === 'allow')
            .map((policy) =>
                this.transformPolicyCondition(model, alias, policy, thisEntity)
            );

        const denies = policies
            .filter((policy) => policy.kind === 'deny')
            .map((policy) =>
                this.transformPolicyCondition(model, alias, policy, thisEntity)
            );

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
                    denies.map((d) => buildIsFalse(d, this.dialect))
                );
                // or(...allows) && and(...!denies)
                combinedPolicy = conjunction(this.dialect, [
                    combinedPolicy,
                    combinedDenies,
                ]);
            }
        }
        return combinedPolicy;
    }

    protected override transformSelectQuery(node: SelectQueryNode) {
        let whereNode = node.where;

        node.from?.froms.forEach((from) => {
            const extractResult = this.extractTableName(from);
            if (extractResult) {
                const { model, alias } = extractResult;
                const filter = this.buildPolicyFilter(model, alias, 'read');
                whereNode = WhereNode.create(
                    whereNode?.where
                        ? conjunction(this.dialect, [whereNode.where, filter])
                        : filter
                );
            }
        });

        const baseResult = super.transformSelectQuery({
            ...node,
            where: undefined,
        });

        return {
            ...baseResult,
            where: whereNode,
        };
    }

    protected override transformInsertQuery(node: InsertQueryNode) {
        const result = super.transformInsertQuery(node);
        if (!node.returning) {
            return result;
        }
        if (this.onlyReturningId(node)) {
            return result;
        } else {
            // only return ID fields, that's enough for reading back the inserted row
            const idFields = getIdFields(
                this.client.$schema,
                this.getMutationModel(node)
            );
            return {
                ...result,
                returning: ReturningNode.create(
                    idFields.map((field) =>
                        SelectionNode.create(ColumnNode.create(field))
                    )
                ),
            };
        }
    }

    protected override transformUpdateQuery(node: UpdateQueryNode) {
        const result = super.transformUpdateQuery(node);
        const mutationModel = this.getMutationModel(node);
        const filter = this.buildPolicyFilter(
            mutationModel,
            undefined,
            'update'
        );
        return {
            ...result,
            where: WhereNode.create(
                result.where
                    ? conjunction(this.dialect, [result.where.where, filter])
                    : filter
            ),
        };
    }

    protected override transformDeleteQuery(node: DeleteQueryNode) {
        const result = super.transformDeleteQuery(node);
        const mutationModel = this.getMutationModel(node);
        const filter = this.buildPolicyFilter(
            mutationModel,
            undefined,
            'delete'
        );
        return {
            ...result,
            where: WhereNode.create(
                result.where
                    ? conjunction(this.dialect, [result.where.where, filter])
                    : filter
            ),
        };
    }

    private extractTableName(
        from: OperationNode
    ): { model: GetModels<Schema>; alias?: string } | undefined {
        if (TableNode.is(from)) {
            return { model: from.table.identifier.name as GetModels<Schema> };
        }
        if (AliasNode.is(from)) {
            const inner = this.extractTableName(from.node);
            if (!inner) {
                return undefined;
            }
            return {
                model: inner.model,
                alias: IdentifierNode.is(from.alias)
                    ? from.alias.name
                    : undefined,
            };
        } else {
            // this can happen for subqueries, which will be handled when nested
            // transformation happens
            return undefined;
        }
    }

    private transformPolicyCondition(
        model: GetModels<Schema>,
        alias: string | undefined,
        policy: Policy,
        thisEntity?: Record<string, OperationNode>
    ) {
        return new ExpressionTransformer(
            this.client.$schema,
            this.client.$options,
            this.client.$auth
        ).transform(policy.condition, { model, alias, thisEntity });
    }

    private getModelPolicies(modelName: string, operation: PolicyOperation) {
        const modelDef = requireModel(this.client.$schema, modelName);
        const result: Policy[] = [];

        const extractOperations = (expr: Expression) => {
            invariant(Expression.isLiteral(expr), 'expecting a literal');
            invariant(
                typeof expr.value === 'string',
                'expecting a string literal'
            );
            return expr.value
                .split(',')
                .filter((v) => !!v)
                .map((v) => v.trim()) as PolicyOperation[];
        };

        if (modelDef.attributes) {
            result.push(
                ...modelDef.attributes
                    .filter(
                        (attr) =>
                            attr.name === '@@allow' || attr.name === '@@deny'
                    )
                    .map(
                        (attr) =>
                            ({
                                kind:
                                    attr.name === '@@allow' ? 'allow' : 'deny',
                                operations: extractOperations(
                                    attr.args![0]!.value
                                ),
                                condition: attr.args![1]!.value,
                            } as const)
                    )
                    .filter(
                        (policy) =>
                            policy.operations.includes('all') ||
                            policy.operations.includes(operation)
                    )
            );
        }
        return result;
    }
}
