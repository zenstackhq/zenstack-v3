import {
    AndNode,
    CompiledQuery,
    DefaultQueryExecutor,
    DeleteQueryNode,
    InsertQueryNode,
    ReturningNode,
    SelectionNode,
    SelectQueryNode,
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
    type TableNode,
} from 'kysely';
import { nanoid } from 'nanoid';
import { match } from 'ts-pattern';
import type { GetModels, SchemaDef } from '../../schema';
import { type ClientImpl } from '../client-impl';
import type { ClientContract } from '../contract';
import { InternalError, QueryError } from '../errors';
import type { AfterEntityMutationCallback, MutationInterceptionFilterResult, OnKyselyQueryCallback } from '../plugin';
import { QueryNameMapper } from './name-mapper';
import type { ZenStackDriver } from './zenstack-driver';

type QueryId = { queryId: string };

export class ZenStackQueryExecutor<Schema extends SchemaDef> extends DefaultQueryExecutor {
    private readonly nameMapper: QueryNameMapper;

    constructor(
        private client: ClientImpl<Schema>,
        private readonly driver: ZenStackDriver,
        private readonly compiler: QueryCompiler,
        adapter: DialectAdapter,
        private readonly connectionProvider: ConnectionProvider,
        plugins: KyselyPlugin[] = [],
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
        let queryNode = compiledQuery.query;
        let mutationInterceptionInfo: Awaited<ReturnType<typeof this.callMutationInterceptionFilters>>;
        if (this.isMutationNode(queryNode) && this.hasMutationHooks) {
            mutationInterceptionInfo = await this.callMutationInterceptionFilters(queryNode);
        }

        const task = async () => {
            // call before mutation hooks
            if (this.isMutationNode(queryNode)) {
                await this.callBeforeMutationHooks(queryNode, mutationInterceptionInfo);
            }

            // TODO: make sure insert and update return rows
            const oldQueryNode = queryNode;
            if (
                (InsertQueryNode.is(queryNode) || UpdateQueryNode.is(queryNode)) &&
                mutationInterceptionInfo?.loadAfterMutationEntities
            ) {
                // need to make sure the query node has "returnAll"
                // for insert and update queries
                queryNode = {
                    ...queryNode,
                    returning: ReturningNode.create([SelectionNode.createSelectAll()]),
                };
            }

            // proceed with the query with kysely interceptors
            // if the query is a raw query, we need to carry over the parameters
            const queryParams = (compiledQuery as any).$raw ? compiledQuery.parameters : undefined;
            const result = await this.proceedQueryWithKyselyInterceptors(queryNode, queryParams);

            // call after mutation hooks
            if (this.isMutationNode(queryNode)) {
                await this.callAfterMutationHooks(
                    result.result,
                    queryNode,
                    mutationInterceptionInfo,
                    result.connection,
                );
            }

            if (oldQueryNode !== queryNode) {
                // TODO: trim the result to the original query node
            }

            return result.result;
        };

        return task();
    }

    private proceedQueryWithKyselyInterceptors(
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
                let connection: DatabaseConnection | undefined;
                const _p = async (q: RootOperationNode) => {
                    const r = await _proceed(q);
                    // carry over the database connection returned by the original executor
                    connection = r.connection;
                    return r.result;
                };

                const hookResult = await hook!({
                    client: this.client as ClientContract<Schema>,
                    schema: this.client.$schema,
                    kysely: this.kysely,
                    query,
                    proceed: _p,
                });
                return { result: hookResult, connection: connection! };
            };
        }

        return proceed(queryNode);
    }

    private async proceedQuery(query: RootOperationNode, parameters: readonly unknown[] | undefined) {
        // run built-in transformers
        const finalQuery = this.nameMapper.transformNode(query);
        let compiled = this.compileQuery(finalQuery);
        if (parameters) {
            compiled = { ...compiled, parameters };
        }

        try {
            return await this.provideConnection(async (connection) => {
                const result = await connection.executeQuery<any>(compiled);
                return { result, connection };
            });
        } catch (err) {
            let message = `Failed to execute query: ${err}, sql: ${compiled.sql}`;
            throw new QueryError(message, err);
        }
    }

    private isMutationNode(queryNode: RootOperationNode) {
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
        );
    }

    override withConnectionProvider(connectionProvider: ConnectionProvider) {
        const newExecutor = new ZenStackQueryExecutor(
            this.client,
            this.driver,
            this.compiler,
            this.adapter,
            connectionProvider,
        );
        // replace client with a new one associated with the new executor
        newExecutor.client = this.client.withExecutor(newExecutor);
        return newExecutor;
    }

    private get hasMutationHooks() {
        return this.client.$options.plugins?.some((plugin) => !!plugin.onEntityMutation);
    }

    private getMutationModel(queryNode: OperationNode): GetModels<Schema> {
        return match(queryNode)
            .when(InsertQueryNode.is, (node) => node.into!.table.identifier.name)
            .when(UpdateQueryNode.is, (node) => (node.table as TableNode).table.identifier.name)
            .when(DeleteQueryNode.is, (node) => {
                if (node.from.froms.length !== 1) {
                    throw new InternalError(`Delete query must have exactly one from table`);
                }
                return (node.from.froms[0] as TableNode).table.identifier.name;
            })
            .otherwise((node) => {
                throw new InternalError(`Invalid query node: ${node}`);
            }) as GetModels<Schema>;
    }

    private async callMutationInterceptionFilters(queryNode: UpdateQueryNode | InsertQueryNode | DeleteQueryNode) {
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
                const onEntityMutation = plugin.onEntityMutation;
                if (!onEntityMutation) {
                    continue;
                }

                if (!onEntityMutation.mutationInterceptionFilter) {
                    // by default intercept without loading entities
                    result.intercept = true;
                } else {
                    const filterResult = await onEntityMutation.mutationInterceptionFilter({
                        model: mutationModel,
                        action,
                        queryNode,
                    });
                    result.intercept ||= filterResult.intercept;
                    result.loadBeforeMutationEntities ||= filterResult.loadBeforeMutationEntities;
                    result.loadAfterMutationEntities ||= filterResult.loadAfterMutationEntities;
                }
            }

            let beforeMutationEntities: Record<string, unknown>[] | undefined;
            if (result.loadBeforeMutationEntities && (UpdateQueryNode.is(queryNode) || DeleteQueryNode.is(queryNode))) {
                beforeMutationEntities = await this.loadEntities(mutationModel, where);
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

    private async callBeforeMutationHooks(
        queryNode: OperationNode,
        mutationInterceptionInfo: Awaited<ReturnType<typeof this.callMutationInterceptionFilters>>,
    ) {
        if (!mutationInterceptionInfo?.intercept) {
            return;
        }

        if (this.options.plugins) {
            const mutationModel = this.getMutationModel(queryNode);
            for (const plugin of this.options.plugins) {
                const onEntityMutation = plugin.onEntityMutation;
                if (onEntityMutation?.beforeEntityMutation) {
                    await onEntityMutation.beforeEntityMutation({
                        model: mutationModel,
                        action: mutationInterceptionInfo.action,
                        queryNode,
                        entities: mutationInterceptionInfo.beforeMutationEntities,
                    });
                }
            }
        }
    }

    private async callAfterMutationHooks(
        queryResult: QueryResult<unknown>,
        queryNode: OperationNode,
        mutationInterceptionInfo: Awaited<ReturnType<typeof this.callMutationInterceptionFilters>>,
        connection: DatabaseConnection,
    ) {
        if (!mutationInterceptionInfo?.intercept) {
            return;
        }

        const hooks: AfterEntityMutationCallback<Schema>[] = [];
        // tsc perf
        for (const plugin of this.options.plugins ?? []) {
            const onEntityMutation = plugin.onEntityMutation;
            if (onEntityMutation?.afterEntityMutation) {
                hooks.push(onEntityMutation.afterEntityMutation.bind(plugin));
            }
        }
        if (hooks.length === 0) {
            return;
        }

        const mutationModel = this.getMutationModel(queryNode);
        const inTransaction = this.driver.isTransactionConnection(connection);

        for (const hook of hooks) {
            let afterMutationEntities: Record<string, unknown>[] | undefined = undefined;
            if (mutationInterceptionInfo.loadAfterMutationEntities) {
                if (InsertQueryNode.is(queryNode) || UpdateQueryNode.is(queryNode)) {
                    afterMutationEntities = queryResult.rows as Record<string, unknown>[];
                }
            }

            const action = async () => {
                try {
                    await hook({
                        model: mutationModel,
                        action: mutationInterceptionInfo.action,
                        queryNode,
                        beforeMutationEntities: mutationInterceptionInfo.beforeMutationEntities,
                        afterMutationEntities,
                    });
                } catch (err) {
                    console.error(`Error in afterEntityMutation hook for model "${mutationModel}": ${err}`);
                }
            };

            if (inTransaction) {
                // if we're in a transaction, the after mutation hooks should be triggered after the transaction is committed,
                // only register a callback here
                this.driver.registerTransactionCommitCallback(connection, action);
            } else {
                // otherwise trigger the hooks immediately
                await action();
            }
        }
    }

    private async loadEntities(
        model: GetModels<Schema>,
        where: WhereNode | undefined,
    ): Promise<Record<string, unknown>[]> {
        const selectQuery = this.kysely.selectFrom(model).selectAll();
        let selectQueryNode = selectQuery.toOperationNode() as SelectQueryNode;
        selectQueryNode = {
            ...selectQueryNode,
            where: this.andNodes(selectQueryNode.where, where),
        };
        const compiled = this.compileQuery(selectQueryNode);
        const result = await this.executeQuery(compiled, { queryId: `zenstack-${nanoid()}` });
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
