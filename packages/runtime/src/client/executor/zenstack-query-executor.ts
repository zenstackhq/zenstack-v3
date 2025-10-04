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
import { TransactionIsolationLevel, type ClientContract } from '../contract';
import { InternalError, QueryError, ZenStackError } from '../errors';
import type { AfterEntityMutationCallback, OnKyselyQueryCallback } from '../plugin';
import { stripAlias } from '../query-utils';
import { QueryNameMapper } from './name-mapper';
import type { ZenStackDriver } from './zenstack-driver';

type QueryId = { queryId: string };

type MutationQueryNode = InsertQueryNode | UpdateQueryNode | DeleteQueryNode;

type MutationInfo<Schema extends SchemaDef> = {
    model: GetModels<Schema>;
    action: 'create' | 'update' | 'delete';
    where: WhereNode | undefined;
};

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

    override executeQuery(compiledQuery: CompiledQuery, queryId: QueryId) {
        // proceed with the query with kysely interceptors
        // if the query is a raw query, we need to carry over the parameters
        const queryParams = (compiledQuery as any).$raw ? compiledQuery.parameters : undefined;

        return this.provideConnection(async (connection) => {
            let startedTx = false;
            try {
                // mutations are wrapped in tx if not already in one
                if (this.isMutationNode(compiledQuery.query) && !this.driver.isTransactionConnection(connection)) {
                    await this.driver.beginTransaction(connection, {
                        isolationLevel: TransactionIsolationLevel.RepeatableRead,
                    });
                    startedTx = true;
                }
                const result = await this.proceedQueryWithKyselyInterceptors(
                    connection,
                    compiledQuery.query,
                    queryParams,
                    queryId.queryId,
                );
                if (startedTx) {
                    await this.driver.commitTransaction(connection);
                }
                return result;
            } catch (err) {
                if (startedTx) {
                    await this.driver.rollbackTransaction(connection);
                }
                if (err instanceof ZenStackError) {
                    throw err;
                } else {
                    // wrap error
                    const message = `Failed to execute query: ${err}, sql: ${compiledQuery?.sql}`;
                    throw new QueryError(message, err);
                }
            }
        });
    }

    private async proceedQueryWithKyselyInterceptors(
        connection: DatabaseConnection,
        queryNode: RootOperationNode,
        parameters: readonly unknown[] | undefined,
        queryId: string,
    ) {
        let proceed = (q: RootOperationNode) => this.proceedQuery(connection, q, parameters, queryId);

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
                const _p = (q: RootOperationNode) => _proceed(q);
                const hookResult = await hook!({
                    client: this.client as ClientContract<Schema>,
                    schema: this.client.$schema,
                    query,
                    proceed: _p,
                });
                return hookResult;
            };
        }

        const result = await proceed(queryNode);

        return result;
    }

    private getMutationInfo(queryNode: MutationQueryNode): MutationInfo<Schema> {
        const model = this.getMutationModel(queryNode);
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

        return { model, action, where };
    }

    private async proceedQuery(
        connection: DatabaseConnection,
        query: RootOperationNode,
        parameters: readonly unknown[] | undefined,
        queryId: string,
    ) {
        let compiled: CompiledQuery | undefined;

        if (this.suppressMutationHooks || !this.isMutationNode(query) || !this.hasEntityMutationPlugins) {
            // no need to handle mutation hooks, just proceed
            const finalQuery = this.nameMapper.transformNode(query);
            compiled = this.compileQuery(finalQuery);
            if (parameters) {
                compiled = { ...compiled, parameters };
            }
            return connection.executeQuery<any>(compiled);
        }

        if (
            (InsertQueryNode.is(query) || UpdateQueryNode.is(query)) &&
            this.hasEntityMutationPluginsWithAfterMutationHooks
        ) {
            // need to make sure the query node has "returnAll" for insert and update queries
            // so that after-mutation hooks can get the mutated entities with all fields
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

        const mutationInfo = this.getMutationInfo(finalQuery);

        // cache already loaded before-mutation entities
        let beforeMutationEntities: Record<string, unknown>[] | undefined;
        const loadBeforeMutationEntities = async () => {
            if (beforeMutationEntities === undefined && (UpdateQueryNode.is(query) || DeleteQueryNode.is(query))) {
                beforeMutationEntities = await this.loadEntities(mutationInfo.model, mutationInfo.where, connection);
            }
            return beforeMutationEntities;
        };

        // call before mutation hooks
        await this.callBeforeMutationHooks(
            finalQuery,
            mutationInfo,
            loadBeforeMutationEntities,
            connectionClient,
            queryId,
        );

        const result = await connection.executeQuery<any>(compiled);

        if (!this.driver.isTransactionConnection(connection)) {
            // not in a transaction, just call all after-mutation hooks
            await this.callAfterMutationHooks(result, finalQuery, mutationInfo, connectionClient, 'all', queryId);
        } else {
            // run after-mutation hooks that are requested to be run inside tx
            await this.callAfterMutationHooks(result, finalQuery, mutationInfo, connectionClient, 'inTx', queryId);

            // register other after-mutation hooks to be run after the tx is committed
            this.driver.registerTransactionCommitCallback(connection, () =>
                this.callAfterMutationHooks(result, finalQuery, mutationInfo, connectionClient, 'outTx', queryId),
            );
        }

        return result;
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

    private get hasEntityMutationPluginsWithAfterMutationHooks() {
        return (this.client.$options.plugins ?? []).some((plugin) => plugin.onEntityMutation?.afterEntityMutation);
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

    private async callBeforeMutationHooks(
        queryNode: OperationNode,
        mutationInfo: MutationInfo<Schema>,
        loadBeforeMutationEntities: () => Promise<Record<string, unknown>[] | undefined>,
        client: ClientContract<Schema>,
        queryId: string,
    ) {
        if (this.options.plugins) {
            for (const plugin of this.options.plugins) {
                const onEntityMutation = plugin.onEntityMutation;
                if (!onEntityMutation?.beforeEntityMutation) {
                    continue;
                }

                await onEntityMutation.beforeEntityMutation({
                    model: mutationInfo.model,
                    action: mutationInfo.action,
                    queryNode,
                    loadBeforeMutationEntities,
                    client,
                    queryId,
                });
            }
        }
    }

    private async callAfterMutationHooks(
        queryResult: QueryResult<unknown>,
        queryNode: OperationNode,
        mutationInfo: MutationInfo<Schema>,
        client: ClientContract<Schema>,
        filterFor: 'inTx' | 'outTx' | 'all',
        queryId: string,
    ) {
        const hooks: AfterEntityMutationCallback<Schema>[] = [];

        // tsc perf
        for (const plugin of this.options.plugins ?? []) {
            const onEntityMutation = plugin.onEntityMutation;

            if (!onEntityMutation?.afterEntityMutation) {
                continue;
            }
            if (filterFor === 'inTx' && !onEntityMutation.runAfterMutationWithinTransaction) {
                continue;
            }

            if (filterFor === 'outTx' && onEntityMutation.runAfterMutationWithinTransaction) {
                continue;
            }

            hooks.push(onEntityMutation.afterEntityMutation.bind(plugin));
        }

        if (hooks.length === 0) {
            return;
        }

        const mutationModel = this.getMutationModel(queryNode);

        const loadAfterMutationEntities = async () => {
            if (mutationInfo.action === 'delete') {
                return undefined;
            } else {
                return queryResult.rows as Record<string, unknown>[];
            }
        };

        for (const hook of hooks) {
            await hook({
                model: mutationModel,
                action: mutationInfo.action,
                queryNode,
                loadAfterMutationEntities,
                client,
                queryId,
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
