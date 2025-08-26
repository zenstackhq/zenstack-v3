import { invariant } from '@zenstackhq/common-helpers';
import {
    AndNode,
    CompiledQuery,
    DefaultQueryExecutor,
    DeleteQueryNode,
    InsertQueryNode,
    ReturningNode,
    SelectionNode,
    SelectQueryNode,
    SingleConnectionProvider,
    TableNode,
    UpdateQueryNode,
    WhereNode,
    type ConnectionProvider,
    type DatabaseConnection,
    type DialectAdapter,
    type KyselyPlugin,
    type OperationNode,
    type QueryCompiler,
    type QueryResult,
    type RootOperationNode,
} from 'kysely';
import { match } from 'ts-pattern';
import type { GetModels, SchemaDef } from '../../schema';
import { type ClientImpl } from '../client-impl';
import type { ClientContract } from '../contract';
import { InternalError, QueryError } from '../errors';
import type {
    AfterEntityMutationCallback,
    MutationInterceptionFilterResult,
    OnKyselyQueryCallback,
    RuntimePlugin,
} from '../plugin';
import { stripAlias } from './kysely-utils';
import { QueryNameMapper } from './name-mapper';
import type { ZenStackDriver } from './zenstack-driver';

type QueryId = { queryId: string };

type MutationInterceptionInfo<Schema extends SchemaDef> = Pick<
    MutationInterceptionFilterResult,
    'loadBeforeMutationEntities' | 'loadAfterMutationEntities'
> & {
    action: 'create' | 'update' | 'delete';
    where: WhereNode | undefined;
    beforeMutationEntities: Record<string, unknown>[] | undefined;
    mutationModel: GetModels<Schema>;
    perPlugin: Map<RuntimePlugin<Schema>, MutationInterceptionFilterResult>;
};

type MutationQueryNode = InsertQueryNode | UpdateQueryNode | DeleteQueryNode;

export class ZenStackQueryExecutor<Schema extends SchemaDef> extends DefaultQueryExecutor {
    private readonly nameMapper: QueryNameMapper;

    constructor(
        private client: ClientImpl<Schema>,
        private readonly driver: ZenStackDriver,
        private readonly compiler: QueryCompiler,
        adapter: DialectAdapter,
        private readonly connectionProvider: ConnectionProvider,
        plugins: KyselyPlugin[] = [],
        private suppressMutationHooks: boolean = false,
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

    override async executeQuery(compiledQuery: CompiledQuery, _queryId: QueryId) {
        // proceed with the query with kysely interceptors
        // if the query is a raw query, we need to carry over the parameters
        const queryParams = (compiledQuery as any).$raw ? compiledQuery.parameters : undefined;
        const result = await this.proceedQueryWithKyselyInterceptors(compiledQuery.query, queryParams);

        return result.result;
    }

    private async proceedQueryWithKyselyInterceptors(
        queryNode: RootOperationNode,
        parameters: readonly unknown[] | undefined,
    ) {
        let proceed = (q: RootOperationNode) => this.proceedQuery(q, parameters);

        const hooks: OnKyselyQueryCallback<Schema>[] = [];
        // tsc perf
        for (const plugin of this.client.$options.plugins ?? []) {
            if (plugin.onKyselyQuery) {
                hooks.push(plugin.onKyselyQuery.bind(plugin));
            }
        }

        for (const hook of hooks) {
            const _proceed = proceed;
            proceed = async (query: RootOperationNode) => {
                const _p = async (q: RootOperationNode) => {
                    const r = await _proceed(q);
                    return r.result;
                };

                const hookResult = await hook!({
                    client: this.client as ClientContract<Schema>,
                    schema: this.client.$schema,
                    kysely: this.kysely,
                    query,
                    proceed: _p,
                });
                return { result: hookResult };
            };
        }

        const result = await proceed(queryNode);

        return result;
    }

    private async proceedQuery(query: RootOperationNode, parameters: readonly unknown[] | undefined) {
        let compiled: CompiledQuery | undefined;

        try {
            return await this.provideConnection(async (connection) => {
                if (this.suppressMutationHooks || !this.isMutationNode(query) || !this.hasEntityMutationPlugins) {
                    // non-mutation query or hooks suppressed, just proceed
                    const finalQuery = this.nameMapper.transformNode(query);
                    compiled = this.compileQuery(finalQuery);
                    if (parameters) {
                        compiled = { ...compiled, parameters };
                    }
                    const result = await connection.executeQuery<any>(compiled);
                    return { result };
                }

                const mutationInterceptionInfo = await this.callMutationInterceptionFilters(query, connection);

                if (
                    (InsertQueryNode.is(query) || UpdateQueryNode.is(query)) &&
                    mutationInterceptionInfo.loadAfterMutationEntities
                ) {
                    // need to make sure the query node has "returnAll"
                    // for insert and update queries
                    query = {
                        ...query,
                        returning: ReturningNode.create([SelectionNode.createSelectAll()]),
                    };
                }
                const finalQuery = this.nameMapper.transformNode(query);
                compiled = this.compileQuery(finalQuery);
                if (parameters) {
                    compiled = { ...compiled, parameters };
                }

                // the client passed to hooks needs to be in sync with current in-transaction
                // status so that it doesn't try to create a nested one
                const currentlyInTx = this.driver.isTransactionConnection(connection);

                const connectionClient = this.createClientForConnection(connection, currentlyInTx);

                // call before mutation hooks
                await this.callBeforeMutationHooks(finalQuery, mutationInterceptionInfo!, connectionClient);

                // if mutation interceptor demands to run afterMutation hook in the transaction but we're not already
                // inside one, we need to create one on the fly
                const shouldCreateTx =
                    mutationInterceptionInfo &&
                    this.hasPluginRequestingAfterMutationWithinTransaction(mutationInterceptionInfo) &&
                    !this.driver.isTransactionConnection(connection);

                if (!shouldCreateTx) {
                    // if no on-the-fly tx is needed, just proceed with the query as is
                    const result = await connection.executeQuery<any>(compiled);

                    invariant(mutationInterceptionInfo);

                    if (!this.driver.isTransactionConnection(connection)) {
                        // not in a transaction, just call all after-mutation hooks
                        await this.callAfterMutationHooks(
                            result,
                            finalQuery,
                            mutationInterceptionInfo,
                            connectionClient,
                            'all',
                        );
                    } else {
                        // run after-mutation hooks that are requested to be run inside tx
                        await this.callAfterMutationHooks(
                            result,
                            finalQuery,
                            mutationInterceptionInfo,
                            connectionClient,
                            'inTx',
                        );

                        // register other after-mutation hooks to be run after the tx is committed
                        this.driver.registerTransactionCommitCallback(connection, () =>
                            this.callAfterMutationHooks(
                                result,
                                finalQuery,
                                mutationInterceptionInfo,
                                connectionClient,
                                'outTx',
                            ),
                        );
                    }

                    return { result };
                } else {
                    // if an on-the-fly tx is created, create one and wrap the query execution inside
                    await this.driver.beginTransaction(connection, { isolationLevel: 'repeatable read' });
                    try {
                        // execute the query inside the on-the-fly transaction
                        const result = await connection.executeQuery<any>(compiled);

                        // run after-mutation hooks that are requested to be run inside tx
                        await this.callAfterMutationHooks(
                            result,
                            finalQuery,
                            mutationInterceptionInfo,
                            connectionClient,
                            'inTx',
                        );

                        // commit the transaction
                        await this.driver.commitTransaction(connection);

                        // run other after-mutation hooks after the tx is committed
                        await this.callAfterMutationHooks(
                            result,
                            finalQuery,
                            mutationInterceptionInfo,
                            connectionClient,
                            'outTx',
                        );

                        return { result };
                    } catch (err) {
                        // rollback the transaction
                        await this.driver.rollbackTransaction(connection);
                        throw err;
                    }
                }
            });
        } catch (err) {
            const message = `Failed to execute query: ${err}, sql: ${compiled?.sql}`;
            throw new QueryError(message, err);
        }
    }

    private createClientForConnection(connection: DatabaseConnection, inTx: boolean) {
        const innerExecutor = this.withConnectionProvider(new SingleConnectionProvider(connection));
        innerExecutor.suppressMutationHooks = true;
        const innerClient = this.client.withExecutor(innerExecutor);
        if (inTx) {
            innerClient.forceTransaction();
        }
        return innerClient as ClientContract<Schema>;
    }

    private get hasEntityMutationPlugins() {
        return (this.client.$options.plugins ?? []).some((plugin) => plugin.onEntityMutation);
    }

    private hasPluginRequestingAfterMutationWithinTransaction(
        mutationInterceptionInfo: MutationInterceptionInfo<Schema>,
    ) {
        return [...mutationInterceptionInfo.perPlugin.values()].some((info) => info.runAfterMutationWithinTransaction);
    }

    private isMutationNode(queryNode: RootOperationNode): queryNode is MutationQueryNode {
        return InsertQueryNode.is(queryNode) || UpdateQueryNode.is(queryNode) || DeleteQueryNode.is(queryNode);
    }

    override withPlugin(plugin: KyselyPlugin) {
        return new ZenStackQueryExecutor(
            this.client,
            this.driver,
            this.compiler,
            this.adapter,
            this.connectionProvider,
            [...this.plugins, plugin],
            this.suppressMutationHooks,
        );
    }

    override withPlugins(plugins: ReadonlyArray<KyselyPlugin>) {
        return new ZenStackQueryExecutor(
            this.client,
            this.driver,
            this.compiler,
            this.adapter,
            this.connectionProvider,
            [...this.plugins, ...plugins],
            this.suppressMutationHooks,
        );
    }

    override withPluginAtFront(plugin: KyselyPlugin) {
        return new ZenStackQueryExecutor(
            this.client,
            this.driver,
            this.compiler,
            this.adapter,
            this.connectionProvider,
            [plugin, ...this.plugins],
            this.suppressMutationHooks,
        );
    }

    override withoutPlugins() {
        return new ZenStackQueryExecutor(
            this.client,
            this.driver,
            this.compiler,
            this.adapter,
            this.connectionProvider,
            [],
            this.suppressMutationHooks,
        );
    }

    override withConnectionProvider(connectionProvider: ConnectionProvider) {
        const newExecutor = new ZenStackQueryExecutor(
            this.client,
            this.driver,
            this.compiler,
            this.adapter,
            connectionProvider,
            this.plugins as KyselyPlugin[],
            this.suppressMutationHooks,
        );
        // replace client with a new one associated with the new executor
        newExecutor.client = this.client.withExecutor(newExecutor);
        return newExecutor;
    }

    private getMutationModel(queryNode: OperationNode): GetModels<Schema> {
        return match(queryNode)
            .when(InsertQueryNode.is, (node) => {
                invariant(node.into, 'InsertQueryNode must have an into clause');
                return node.into.table.identifier.name;
            })
            .when(UpdateQueryNode.is, (node) => {
                invariant(node.table, 'UpdateQueryNode must have a table');
                const { node: tableNode } = stripAlias(node.table);
                invariant(TableNode.is(tableNode), 'UpdateQueryNode must use a TableNode');
                return tableNode.table.identifier.name;
            })
            .when(DeleteQueryNode.is, (node) => {
                invariant(node.from.froms.length === 1, 'Delete query must have exactly one from table');
                const { node: tableNode } = stripAlias(node.from.froms[0]!);
                invariant(TableNode.is(tableNode), 'DeleteQueryNode must use a TableNode');
                return tableNode.table.identifier.name;
            })
            .otherwise((node) => {
                throw new InternalError(`Invalid query node: ${node}`);
            }) as GetModels<Schema>;
    }

    private async callMutationInterceptionFilters(
        queryNode: UpdateQueryNode | InsertQueryNode | DeleteQueryNode,
        connection: DatabaseConnection,
    ): Promise<MutationInterceptionInfo<Schema>> {
        const mutationModel = this.getMutationModel(queryNode);
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

        const plugins = this.client.$options.plugins;
        const perPlugin = new Map<RuntimePlugin<Schema>, MutationInterceptionFilterResult>();
        if (plugins) {
            const mergedResult: Pick<
                MutationInterceptionFilterResult,
                'loadBeforeMutationEntities' | 'loadAfterMutationEntities'
            > = {};

            for (const plugin of plugins) {
                const onEntityMutation = plugin.onEntityMutation;
                if (!onEntityMutation) {
                    continue;
                }

                if (!onEntityMutation.mutationInterceptionFilter) {
                    // by default intercept without loading entities
                    perPlugin.set(plugin, { intercept: true });
                } else {
                    const filterResult = await onEntityMutation.mutationInterceptionFilter({
                        model: mutationModel,
                        action,
                        queryNode,
                    });
                    mergedResult.loadBeforeMutationEntities ||= filterResult.loadBeforeMutationEntities;
                    mergedResult.loadAfterMutationEntities ||= filterResult.loadAfterMutationEntities;
                    perPlugin.set(plugin, filterResult);
                }
            }

            let beforeMutationEntities: Record<string, unknown>[] | undefined;
            if (
                mergedResult.loadBeforeMutationEntities &&
                (UpdateQueryNode.is(queryNode) || DeleteQueryNode.is(queryNode))
            ) {
                beforeMutationEntities = await this.loadEntities(mutationModel, where, connection);
            }

            return {
                ...mergedResult,
                mutationModel,
                action,
                where,
                beforeMutationEntities,
                perPlugin,
            };
        } else {
            return {
                mutationModel,
                action,
                where,
                beforeMutationEntities: undefined,
                perPlugin,
            };
        }
    }

    private async callBeforeMutationHooks(
        queryNode: OperationNode,
        mutationInterceptionInfo: MutationInterceptionInfo<Schema>,
        client: ClientContract<Schema>,
    ) {
        if (this.options.plugins) {
            const mutationModel = this.getMutationModel(queryNode);
            for (const plugin of this.options.plugins) {
                const info = mutationInterceptionInfo.perPlugin.get(plugin);
                if (!info?.intercept) {
                    continue;
                }
                const onEntityMutation = plugin.onEntityMutation;
                if (onEntityMutation?.beforeEntityMutation) {
                    await onEntityMutation.beforeEntityMutation({
                        model: mutationModel,
                        action: mutationInterceptionInfo.action,
                        queryNode,
                        entities: mutationInterceptionInfo.beforeMutationEntities,
                        client,
                    });
                }
            }
        }
    }

    private async callAfterMutationHooks(
        queryResult: QueryResult<unknown>,
        queryNode: OperationNode,
        mutationInterceptionInfo: MutationInterceptionInfo<Schema>,
        client: ClientContract<Schema>,
        filterFor: 'inTx' | 'outTx' | 'all',
    ) {
        const hooks: AfterEntityMutationCallback<Schema>[] = [];

        // tsc perf
        for (const plugin of this.options.plugins ?? []) {
            const info = mutationInterceptionInfo.perPlugin.get(plugin);
            if (!info?.intercept) {
                continue;
            }

            if (filterFor === 'inTx' && !info.runAfterMutationWithinTransaction) {
                continue;
            }

            if (filterFor === 'outTx' && info.runAfterMutationWithinTransaction) {
                continue;
            }

            const onEntityMutation = plugin.onEntityMutation;
            if (onEntityMutation?.afterEntityMutation) {
                hooks.push(onEntityMutation.afterEntityMutation.bind(plugin));
            }
        }

        if (hooks.length === 0) {
            return;
        }

        const mutationModel = this.getMutationModel(queryNode);

        for (const hook of hooks) {
            let afterMutationEntities: Record<string, unknown>[] | undefined = undefined;
            if (mutationInterceptionInfo.loadAfterMutationEntities) {
                if (InsertQueryNode.is(queryNode) || UpdateQueryNode.is(queryNode)) {
                    afterMutationEntities = queryResult.rows as Record<string, unknown>[];
                }
            }

            await hook({
                model: mutationModel,
                action: mutationInterceptionInfo.action,
                queryNode,
                beforeMutationEntities: mutationInterceptionInfo.beforeMutationEntities,
                afterMutationEntities,
                client,
            });
        }
    }

    private async loadEntities(
        model: GetModels<Schema>,
        where: WhereNode | undefined,
        connection: DatabaseConnection,
    ): Promise<Record<string, unknown>[]> {
        const selectQuery = this.kysely.selectFrom(model).selectAll();
        let selectQueryNode = selectQuery.toOperationNode() as SelectQueryNode;
        selectQueryNode = {
            ...selectQueryNode,
            where: this.andNodes(selectQueryNode.where, where),
        };
        const compiled = this.compileQuery(selectQueryNode);
        // execute the query directly with the given connection to avoid triggering
        // any other side effects
        const result = await connection.executeQuery(compiled);
        return result.rows as Record<string, unknown>[];
    }

    private andNodes(condition1: WhereNode | undefined, condition2: WhereNode | undefined) {
        if (condition1 && condition2) {
            return WhereNode.create(AndNode.create(condition1, condition2));
        } else if (condition1) {
            return WhereNode.create(condition1);
        } else {
            return condition2;
        }
    }
}
