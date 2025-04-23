import {
    AndNode,
    CompiledQuery,
    DefaultQueryExecutor,
    DeleteQueryNode,
    InsertQueryNode,
    Kysely,
    ReturningNode,
    SelectionNode,
    SingleConnectionProvider,
    UpdateQueryNode,
    WhereNode,
    type ConnectionProvider,
    type DialectAdapter,
    type KyselyPlugin,
    type OperationNode,
    type QueryCompiler,
    type QueryResult,
    type RootOperationNode,
    type SelectQueryNode,
    type TableNode,
} from 'kysely';
import { nanoid } from 'nanoid';
import { match } from 'ts-pattern';
import type { PromiseType } from 'utility-types';
import type { GetModels, SchemaDef } from '../../schema';
import type { ClientImpl } from '../client-impl';
import type { ClientContract } from '../contract';
import { InternalError } from '../errors';
import type {
    MutationInterceptionFilterResult,
    OnKyselyQueryTransactionCallback,
} from '../plugin';
import { QueryNameMapper } from './name-mapper';
import type { ZenStackDriver } from './zenstack-driver';

type QueryId = { queryId: string };

export class ZenStackQueryExecutor<
    Schema extends SchemaDef
> extends DefaultQueryExecutor {
    private readonly nameMapper: QueryNameMapper;

    constructor(
        private readonly client: ClientImpl<Schema>,
        private readonly driver: ZenStackDriver,
        private readonly compiler: QueryCompiler,
        adapter: DialectAdapter,
        private readonly connectionProvider: ConnectionProvider,
        plugins: KyselyPlugin[] = []
    ) {
        super(compiler, adapter, connectionProvider, plugins);
        this.nameMapper = new QueryNameMapper(client.$schema);
    }

    private get kysely() {
        return this.client.$qb;
    }

    private get options() {
        return this.client.$options;
    }

    override async executeQuery(
        compiledQuery: CompiledQuery,
        queryId: QueryId
    ) {
        let queryNode = compiledQuery.query;
        let mutationInterceptionInfo: PromiseType<
            ReturnType<typeof this.callMutationInterceptionFilters>
        >;
        if (this.isMutationNode(queryNode) && this.hasMutationHooks) {
            mutationInterceptionInfo =
                await this.callMutationInterceptionFilters(queryNode);
        }

        const task = async () => {
            // call before mutation hooks
            await this.callBeforeMutationHooks(
                queryNode,
                mutationInterceptionInfo
            );

            // TODO: make sure insert and delete return rows
            let oldQueryNode = queryNode;
            if (
                (InsertQueryNode.is(queryNode) ||
                    DeleteQueryNode.is(queryNode)) &&
                mutationInterceptionInfo?.loadAfterMutationEntity
            ) {
                // need to make sure the query node has "returnAll"
                // for insert and delete queries
                queryNode = {
                    ...queryNode,
                    returning: ReturningNode.create([
                        SelectionNode.createSelectAll(),
                    ]),
                };
            }

            // proceed with the query with kysely interceptors
            const result = await this.proceedQueryWithKyselyInterceptors(
                queryNode,
                queryId
            );

            // call after mutation hooks
            await this.callAfterQueryInterceptionFilters(
                result,
                queryNode,
                mutationInterceptionInfo
            );

            // trim the result to the original query node
            if (oldQueryNode !== queryNode) {
            }

            return result;
        };

        return this.executeWithTransaction(
            task,
            !!mutationInterceptionInfo?.useTransactionForMutation
        );
    }

    private proceedQueryWithKyselyInterceptors(
        queryNode: RootOperationNode,
        queryId: QueryId
    ) {
        let proceed = (q: RootOperationNode) => this.proceedQuery(q, queryId);

        const makeTx =
            (p: typeof proceed) =>
            (callback: OnKyselyQueryTransactionCallback) => {
                return this.executeWithTransaction(() => callback(p));
            };

        const hooks =
            this.options.plugins
                ?.filter((plugin) => typeof plugin.onKyselyQuery === 'function')
                .map((plugin) => plugin.onKyselyQuery!.bind(plugin)) ?? [];

        for (const hook of hooks) {
            const _proceed = proceed;
            proceed = (query: RootOperationNode) => {
                return hook!({
                    client: this.client as ClientContract<Schema>,
                    schema: this.client.$schema,
                    kysely: this.kysely,
                    query,
                    proceed: _proceed,
                    transaction: makeTx(_proceed),
                });
            };
        }

        return proceed(queryNode);
    }

    private async proceedQuery(query: RootOperationNode, queryId: QueryId) {
        // run built-in transformers
        console.log('Name mapping', this.compileQuery(query).sql);
        const finalQuery = this.nameMapper.transformNode(query);
        // const finalQuery = query;

        const compiled = this.compileQuery(finalQuery);
        try {
            return await (this.driver.txConnection
                ? super
                      .withConnectionProvider(
                          new SingleConnectionProvider(this.driver.txConnection)
                      )
                      .executeQuery<any>(compiled, queryId)
                : super.executeQuery<any>(compiled, queryId));
        } catch (err) {
            console.error(
                `Failed to execute query: ${
                    this.compileQuery(finalQuery).sql
                }\nOriginal query:\n${this.compileQuery(query).sql}`
            );
            throw err;
        }
    }

    private isMutationNode(queryNode: RootOperationNode) {
        return (
            InsertQueryNode.is(queryNode) ||
            UpdateQueryNode.is(queryNode) ||
            DeleteQueryNode.is(queryNode)
        );
    }

    override withPlugin(plugin: KyselyPlugin) {
        return new ZenStackQueryExecutor(
            this.client,
            this.driver,
            this.compiler,
            this.adapter,
            this.connectionProvider,
            [...this.plugins, plugin]
        );
    }

    override withPlugins(plugins: ReadonlyArray<KyselyPlugin>) {
        return new ZenStackQueryExecutor(
            this.client,
            this.driver,
            this.compiler,
            this.adapter,
            this.connectionProvider,
            [...this.plugins, ...plugins]
        );
    }

    override withPluginAtFront(plugin: KyselyPlugin) {
        return new ZenStackQueryExecutor(
            this.client,
            this.driver,
            this.compiler,
            this.adapter,
            this.connectionProvider,
            [plugin, ...this.plugins]
        );
    }
    override withoutPlugins() {
        return new ZenStackQueryExecutor(
            this.client,
            this.driver,
            this.compiler,
            this.adapter,
            this.connectionProvider,
            []
        );
    }

    override withConnectionProvider(connectionProvider: ConnectionProvider) {
        return new ZenStackQueryExecutor(
            this.client,
            this.driver,
            this.compiler,
            this.adapter,
            connectionProvider
        );
    }

    private async executeWithTransaction<T>(
        callback: () => Promise<T>,
        useTransaction = true
    ) {
        if (!useTransaction || this.driver.txConnection) {
            return callback();
        } else {
            return this.provideConnection(async (connection) => {
                try {
                    await this.driver.beginTransaction(connection, {});
                    const result = await callback();
                    await this.driver.commitTransaction(connection);
                    return result;
                } catch (error) {
                    await this.driver.rollbackTransaction(connection);
                    throw error;
                }
            });
        }
    }

    private get hasMutationHooks() {
        return this.client.$options.plugins?.some(
            (plugin) =>
                plugin.beforeEntityMutation || plugin.afterEntityMutation
        );
    }

    private getMutationModel(queryNode: OperationNode): GetModels<Schema> {
        return match(queryNode)
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
            }) as GetModels<Schema>;
    }

    private async callMutationInterceptionFilters(
        queryNode: UpdateQueryNode | InsertQueryNode | DeleteQueryNode
    ) {
        const plugins = this.client.$options.plugins;
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
                    this.kysely,
                    mutationModel,
                    where
                );
            }

            return {
                ...result,
                mutationModel,
                action,
                where,
                beforeMutationEntities,
            };
        } else {
            return undefined;
        }
    }

    private callBeforeMutationHooks(
        queryNode: OperationNode,
        mutationInterceptionInfo: PromiseType<
            ReturnType<typeof this.callMutationInterceptionFilters>
        >
    ) {
        if (!mutationInterceptionInfo?.intercept) {
            return;
        }

        if (this.options.plugins) {
            for (const plugin of this.options.plugins) {
                if (plugin.beforeEntityMutation) {
                    plugin.beforeEntityMutation({
                        // context: this.queryContext,
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
        queryResult: QueryResult<unknown>,
        queryNode: OperationNode,
        mutationInterceptionInfo: PromiseType<
            ReturnType<typeof this.callMutationInterceptionFilters>
        >
    ) {
        if (!mutationInterceptionInfo?.intercept) {
            return;
        }

        if (this.options.plugins) {
            const mutationModel = this.getMutationModel(queryNode);
            for (const plugin of this.options.plugins) {
                if (plugin.afterEntityMutation) {
                    let afterMutationEntities:
                        | Record<string, unknown>[]
                        | undefined = undefined;
                    if (mutationInterceptionInfo.loadAfterMutationEntity) {
                        if (UpdateQueryNode.is(queryNode)) {
                            afterMutationEntities = await this.loadEntities(
                                this.kysely,
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
                        // context: this.queryContext,
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

    private async loadEntities(
        kysely: Kysely<any>,
        model: GetModels<Schema>,
        where: WhereNode | undefined
    ): Promise<Record<string, unknown>[]> {
        const selectQuery = kysely.selectFrom(model).selectAll();
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
}
