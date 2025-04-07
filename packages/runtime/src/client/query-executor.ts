import {
    AndNode,
    DeleteQueryNode,
    InsertQueryNode,
    SelectQueryNode,
    TableNode,
    UpdateQueryNode,
    WhereNode,
    type DeleteQueryBuilder,
    type InsertQueryBuilder,
    type Kysely,
    type OperationNode,
    type QueryResult,
    type SelectQueryBuilder,
    type UpdateQueryBuilder,
} from 'kysely';
import { nanoid } from 'nanoid';
import { match } from 'ts-pattern';
import type { PromiseType } from 'utility-types';
import type { ClientContract } from '.';
import type { GetModels, SchemaDef } from '../schema';
import type { CrudOperation } from './crud/operations/base';
import { InternalError } from './errors';
import type { MutationInterceptionFilterResult } from './plugin';
import { requireModel } from './query-utils';

export type QueryContext<Schema extends SchemaDef> = {
    /**
     * The ZenStack client that's invoking the plugin.
     */
    client: ClientContract<Schema>;

    /**
     * The model that is being queried.
     */
    model: GetModels<Schema>;

    /**
     * The query operation that is being performed.
     */
    operation: CrudOperation;

    /**
     * The query arguments.
     */
    queryArgs: unknown;
};

type ExecutableQueries =
    | SelectQueryBuilder<any, any, any>
    | UpdateQueryBuilder<any, any, any, any>
    | InsertQueryBuilder<any, any, any>
    | DeleteQueryBuilder<any, any, any>;

export class QueryExecutor<Schema extends SchemaDef> {
    constructor(protected readonly queryContext: QueryContext<Schema>) {}

    private get clientInterceptsMutation() {
        return this.queryContext.client.$options.plugins?.some(
            (plugin) =>
                plugin.beforeEntityMutation || plugin.afterEntityMutation
        );
    }

    async execute(kysely: Kysely<any>, query: ExecutableQueries) {
        const node = query.toOperationNode();
        let mutationInterceptionInfo: PromiseType<
            ReturnType<typeof this.callMutationInterceptionFilters>
        >;
        if (
            (InsertQueryNode.is(node) ||
                UpdateQueryNode.is(node) ||
                DeleteQueryNode.is(node)) &&
            this.clientInterceptsMutation
        ) {
            mutationInterceptionInfo =
                await this.callMutationInterceptionFilters(kysely, node);
        }

        const task = async (tx: Kysely<any>) => {
            await this.callBeforeQueryInterceptionFilters(
                node,
                mutationInterceptionInfo
            );

            if (
                InsertQueryNode.is(node) &&
                mutationInterceptionInfo?.loadAfterMutationEntity
            ) {
                // ensure insert returns the inserted row
                query = (
                    query as InsertQueryBuilder<any, any, any>
                ).returningAll();
            }

            const result = await tx.executeQuery(query.compile());

            await this.callAfterQueryInterceptionFilters(
                tx,
                result,
                node,
                mutationInterceptionInfo
            );

            return result;
        };

        return this.executeWithTransaction(
            kysely,
            task,
            !!mutationInterceptionInfo?.useTransactionForMutation
        );
    }

    private executeWithTransaction(
        kysely: Kysely<any>,
        callback: (tx: Kysely<any>) => Promise<QueryResult<unknown>>,
        useTransaction: boolean
    ) {
        if (useTransaction) {
            return kysely.transaction().execute(async (tx) => callback(tx));
        } else {
            return callback(kysely);
        }
    }

    private callBeforeQueryInterceptionFilters(
        queryNode: OperationNode,
        mutationInterceptionInfo: PromiseType<
            ReturnType<typeof this.callMutationInterceptionFilters>
        >
    ) {
        if (!mutationInterceptionInfo?.intercept) {
            return;
        }

        const plugins = this.queryContext.client.$options.plugins;
        if (plugins) {
            for (const plugin of plugins) {
                if (plugin.beforeEntityMutation) {
                    plugin.beforeEntityMutation({
                        context: this.queryContext,
                        model: this.getMutationModel(queryNode),
                        action: mutationInterceptionInfo.action,
                        queryNode,
                        entities:
                            mutationInterceptionInfo.beforeMutationEntities,
                    });
                }
            }
        }
    }

    private async callAfterQueryInterceptionFilters(
        kysely: Kysely<any>,
        queryResult: QueryResult<unknown>,
        queryNode: OperationNode,
        mutationInterceptionInfo: PromiseType<
            ReturnType<typeof this.callMutationInterceptionFilters>
        >
    ) {
        if (!mutationInterceptionInfo?.intercept) {
            return;
        }

        const plugins = this.queryContext.client.$options.plugins;
        if (plugins) {
            const mutationModel = this.getMutationModel(queryNode);
            for (const plugin of plugins) {
                if (plugin.afterEntityMutation) {
                    let afterMutationEntities:
                        | Record<string, unknown>[]
                        | undefined = undefined;
                    if (mutationInterceptionInfo.loadAfterMutationEntity) {
                        if (UpdateQueryNode.is(queryNode)) {
                            afterMutationEntities = await this.loadEntities(
                                kysely,
                                mutationModel,
                                mutationInterceptionInfo.where
                            );
                        } else {
                            afterMutationEntities = queryResult.rows as Record<
                                string,
                                unknown
                            >[];
                        }
                    }

                    plugin.afterEntityMutation({
                        context: this.queryContext,
                        model: this.getMutationModel(queryNode),
                        action: mutationInterceptionInfo.action,
                        queryNode,
                        beforeMutationEntities:
                            mutationInterceptionInfo.beforeMutationEntities,
                        afterMutationEntities,
                    });
                }
            }
        }
    }

    private getMutationModel(queryNode: OperationNode): GetModels<Schema> {
        const table = match(queryNode)
            .when(
                InsertQueryNode.is,
                (node) => node.into!.table.identifier.name
            )
            .when(
                UpdateQueryNode.is,
                (node) => (node.table as TableNode).table.identifier.name
            )
            .when(DeleteQueryNode.is, (node) => {
                if (node.from.froms.length !== 1) {
                    throw new InternalError(
                        `Delete query must have exactly one from table`
                    );
                }
                return (node.from.froms[0] as TableNode).table.identifier.name;
            })
            .otherwise((node) => {
                throw new InternalError(`Invalid query node: ${node}`);
            });
        return this.mapTableToModel(table);
    }

    private mapTableToModel(table: string): GetModels<Schema> {
        for (const [name, def] of Object.entries(
            this.queryContext.client.$schema.models
        )) {
            if (def.dbTable === table) {
                return name as GetModels<Schema>;
            }
        }
        throw new InternalError(`Table ${table} not found in schema models`);
    }

    private async callMutationInterceptionFilters(
        kysely: Kysely<any>,
        queryNode: UpdateQueryNode | InsertQueryNode | DeleteQueryNode
    ) {
        const plugins = this.queryContext.client.$options.plugins;
        if (plugins) {
            const mutationModel = this.getMutationModel(queryNode);
            const result: MutationInterceptionFilterResult = {
                intercept: false,
            };

            const { action, where } = match(queryNode)
                .when(InsertQueryNode.is, () => ({
                    action: 'create' as const,
                    where: undefined,
                }))
                .when(UpdateQueryNode.is, (node) => ({
                    action: 'update' as const,
                    where: node.where,
                }))
                .when(DeleteQueryNode.is, (node) => ({
                    action: 'delete' as const,
                    where: node.where,
                }))
                .exhaustive();

            for (const plugin of plugins) {
                if (!plugin.mutationInterceptionFilter) {
                    result.intercept = true;
                } else {
                    const filterResult =
                        await plugin.mutationInterceptionFilter({
                            context: this.queryContext,
                            model: mutationModel,
                            action,
                            queryNode,
                        });
                    result.intercept ||= filterResult.intercept;
                    result.useTransactionForMutation ||=
                        filterResult.useTransactionForMutation;
                    result.loadBeforeMutationEntity ||=
                        filterResult.loadBeforeMutationEntity;
                    result.loadAfterMutationEntity ||=
                        filterResult.loadAfterMutationEntity;
                }
            }

            let beforeMutationEntities: Record<string, unknown>[] | undefined;
            if (
                result.loadBeforeMutationEntity &&
                (UpdateQueryNode.is(queryNode) || DeleteQueryNode.is(queryNode))
            ) {
                beforeMutationEntities = await this.loadEntities(
                    kysely,
                    mutationModel,
                    where
                );
            }

            return { ...result, action, where, beforeMutationEntities };
        } else {
            return undefined;
        }
    }

    private async loadEntities(
        kysely: Kysely<any>,
        model: GetModels<Schema>,
        where: WhereNode | undefined
    ): Promise<Record<string, unknown>[]> {
        const modelDef = requireModel(this.queryContext.client.$schema, model);
        const selectQuery = kysely.selectFrom(modelDef.dbTable).selectAll();
        let selectQueryNode = selectQuery.toOperationNode() as SelectQueryNode;
        selectQueryNode = {
            ...selectQueryNode,
            where: this.andNodes(selectQueryNode.where, where),
        };
        const compiled = kysely
            .getExecutor()
            .compileQuery(selectQueryNode, { queryId: `zenstack-${nanoid()}` });
        const result = await kysely.executeQuery(compiled);
        return result.rows as Record<string, unknown>[];
    }

    private andNodes(
        condition1: WhereNode | undefined,
        condition2: WhereNode | undefined
    ) {
        if (condition1 && condition2) {
            return WhereNode.create(AndNode.create(condition1, condition2));
        } else if (condition1) {
            return WhereNode.create(condition1);
        } else {
            return condition2;
        }
    }

    async executeGetRows(kysely: Kysely<any>, query: ExecutableQueries) {
        return (await this.execute(kysely, query)).rows;
    }

    async executeTakeFirst(kysely: Kysely<any>, query: ExecutableQueries) {
        const result = await this.execute(kysely, query);
        return result.rows[0];
    }

    async executeTakeFirstOrThrow(
        kysely: Kysely<any>,
        query: ExecutableQueries
    ) {
        const result = await this.execute(kysely, query);
        if (result.rows.length === 0) {
            throw new InternalError(
                `Query returned no results: ${query.compile().sql}`
            );
        }
        return result.rows[0];
    }
}
