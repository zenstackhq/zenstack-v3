import { invariant } from '@zenstackhq/common-helpers';
import type { QueryExecutor } from 'kysely';
import {
    CompiledQuery,
    DefaultConnectionProvider,
    DefaultQueryExecutor,
    Kysely,
    Log,
    sql,
    Transaction,
    type KyselyProps,
} from 'kysely';
import type { GetModels, ProcedureDef, SchemaDef } from '../schema';
import type { UnwrapTuplePromises } from '../utils/type-utils';
import type {
    AuthType,
    ClientConstructor,
    ClientContract,
    ModelOperations,
    TransactionIsolationLevel,
} from './contract';
import { AggregateOperationHandler } from './crud/operations/aggregate';
import type { AllCrudOperation, CoreCrudOperation } from './crud/operations/base';
import { BaseOperationHandler } from './crud/operations/base';
import { CountOperationHandler } from './crud/operations/count';
import { CreateOperationHandler } from './crud/operations/create';
import { DeleteOperationHandler } from './crud/operations/delete';
import { FindOperationHandler } from './crud/operations/find';
import { GroupByOperationHandler } from './crud/operations/group-by';
import { UpdateOperationHandler } from './crud/operations/update';
import { InputValidator } from './crud/validator';
import { NotFoundError, QueryError } from './errors';
import { ZenStackDriver } from './executor/zenstack-driver';
import { ZenStackQueryExecutor } from './executor/zenstack-query-executor';
import * as BuiltinFunctions from './functions';
import { SchemaDbPusher } from './helpers/schema-db-pusher';
import type { ClientOptions, ProceduresOptions } from './options';
import type { RuntimePlugin } from './plugin';
import { createZenStackPromise, type ZenStackPromise } from './promise';
import type { ToKysely } from './query-builder';
import { ResultProcessor } from './result-processor';

/**
 * ZenStack ORM client.
 */
export const ZenStackClient = function <Schema extends SchemaDef>(
    this: any,
    schema: Schema,
    options: ClientOptions<Schema>,
) {
    return new ClientImpl<Schema>(schema, options);
} as unknown as ClientConstructor;

export class ClientImpl<Schema extends SchemaDef> {
    private kysely: ToKysely<Schema>;
    private kyselyRaw: ToKysely<any>;
    public readonly $options: ClientOptions<Schema>;
    public readonly $schema: Schema;
    readonly kyselyProps: KyselyProps;
    private auth: AuthType<Schema> | undefined;

    constructor(
        private readonly schema: Schema,
        private options: ClientOptions<Schema>,
        baseClient?: ClientImpl<Schema>,
        executor?: QueryExecutor,
    ) {
        this.$schema = schema;
        this.$options = options;

        this.$options.functions = {
            ...BuiltinFunctions,
            ...this.$options.functions,
        };

        // here we use kysely's props constructor so we can pass a custom query executor
        if (baseClient) {
            this.kyselyProps = {
                ...baseClient.kyselyProps,
                executor:
                    executor ??
                    new ZenStackQueryExecutor(
                        this,
                        baseClient.kyselyProps.driver as ZenStackDriver,
                        baseClient.kyselyProps.dialect.createQueryCompiler(),
                        baseClient.kyselyProps.dialect.createAdapter(),
                        new DefaultConnectionProvider(baseClient.kyselyProps.driver),
                    ),
            };
            this.kyselyRaw = baseClient.kyselyRaw;
            this.auth = baseClient.auth;
        } else {
            const driver = new ZenStackDriver(options.dialect.createDriver(), new Log(this.$options.log ?? []));
            const compiler = options.dialect.createQueryCompiler();
            const adapter = options.dialect.createAdapter();
            const connectionProvider = new DefaultConnectionProvider(driver);

            this.kyselyProps = {
                config: {
                    dialect: options.dialect,
                    log: this.$options.log,
                },
                dialect: options.dialect,
                driver,
                executor: executor ?? new ZenStackQueryExecutor(this, driver, compiler, adapter, connectionProvider),
            };

            // raw kysely instance with default executor
            this.kyselyRaw = new Kysely({
                ...this.kyselyProps,
                executor: new DefaultQueryExecutor(compiler, adapter, connectionProvider, []),
            });
        }

        this.kysely = new Kysely(this.kyselyProps);

        return createClientProxy(this);
    }

    get $qb() {
        return this.kysely;
    }

    get $qbRaw() {
        return this.kyselyRaw;
    }

    get isTransaction() {
        return this.kysely.isTransaction;
    }

    /**
     * Create a new client with a new query executor.
     */
    withExecutor(executor: QueryExecutor) {
        return new ClientImpl(this.schema, this.$options, this, executor);
    }

    // overload for interactive transaction
    $transaction<T>(
        callback: (tx: ClientContract<Schema>) => Promise<T>,
        options?: { isolationLevel?: TransactionIsolationLevel },
    ): Promise<T>;

    // overload for sequential transaction
    $transaction<P extends ZenStackPromise<Schema, any>[]>(
        arg: [...P],
        options?: { isolationLevel?: TransactionIsolationLevel },
    ): Promise<UnwrapTuplePromises<P>>;

    // implementation
    async $transaction(input: any, options?: { isolationLevel?: TransactionIsolationLevel }) {
        invariant(
            typeof input === 'function' || (Array.isArray(input) && input.every((p) => p.then && p.cb)),
            'Invalid transaction input, expected a function or an array of ZenStackPromise',
        );
        if (typeof input === 'function') {
            return this.interactiveTransaction(input, options);
        } else {
            return this.sequentialTransaction(input, options);
        }
    }

    forceTransaction() {
        if (!this.kysely.isTransaction) {
            this.kysely = new Transaction(this.kyselyProps);
        }
    }

    private async interactiveTransaction(
        callback: (tx: ClientContract<Schema>) => Promise<any>,
        options?: { isolationLevel?: TransactionIsolationLevel },
    ): Promise<any> {
        if (this.kysely.isTransaction) {
            // proceed directly if already in a transaction
            return callback(this as unknown as ClientContract<Schema>);
        } else {
            // otherwise, create a new transaction, clone the client, and execute the callback
            let txBuilder = this.kysely.transaction();
            if (options?.isolationLevel) {
                txBuilder = txBuilder.setIsolationLevel(options.isolationLevel);
            }
            return txBuilder.execute((tx) => {
                const txClient = new ClientImpl<Schema>(this.schema, this.$options, this);
                txClient.kysely = tx;
                return callback(txClient as unknown as ClientContract<Schema>);
            });
        }
    }

    private async sequentialTransaction(
        arg: ZenStackPromise<Schema, any>[],
        options?: { isolationLevel?: TransactionIsolationLevel },
    ) {
        const execute = async (tx: Kysely<any>) => {
            const txClient = new ClientImpl<Schema>(this.schema, this.$options, this);
            txClient.kysely = tx;
            const result: any[] = [];
            for (const promise of arg) {
                result.push(await promise.cb(txClient as unknown as ClientContract<Schema>));
            }
            return result;
        };
        if (this.kysely.isTransaction) {
            // proceed directly if already in a transaction
            return execute(this.kysely);
        } else {
            // otherwise, create a new transaction, clone the client, and execute the callback
            let txBuilder = this.kysely.transaction();
            if (options?.isolationLevel) {
                txBuilder = txBuilder.setIsolationLevel(options.isolationLevel);
            }
            return txBuilder.execute((tx) => execute(tx as Kysely<any>));
        }
    }

    get $procedures() {
        return Object.keys(this.$schema.procedures ?? {}).reduce((acc, name) => {
            acc[name] = (...args: unknown[]) => this.handleProc(name, args);
            return acc;
        }, {} as any);
    }

    private async handleProc(name: string, args: unknown[]) {
        if (!('procedures' in this.$options) || !this.$options || typeof this.$options.procedures !== 'object') {
            throw new QueryError('Procedures are not configured for the client.');
        }

        const procOptions = this.$options.procedures as ProceduresOptions<
            Schema & {
                procedures: Record<string, ProcedureDef>;
            }
        >;
        if (!procOptions[name] || typeof procOptions[name] !== 'function') {
            throw new Error(`Procedure "${name}" does not have a handler configured.`);
        }

        return (procOptions[name] as Function).apply(this, [this, ...args]);
    }

    async $connect() {
        await this.kysely.connection().execute(async (conn) => {
            await conn.executeQuery(sql`select 1`.compile(this.kysely));
        });
    }

    async $disconnect() {
        await this.kysely.destroy();
    }

    async $pushSchema() {
        await new SchemaDbPusher(this.schema, this.kysely).push();
    }

    $use(plugin: RuntimePlugin<Schema>) {
        // tsc perf
        const newPlugins: RuntimePlugin<Schema>[] = [...(this.$options.plugins ?? []), plugin];
        const newOptions: ClientOptions<Schema> = {
            ...this.options,
            plugins: newPlugins,
        };
        return new ClientImpl<Schema>(this.schema, newOptions, this);
    }

    $unuse(pluginId: string) {
        // tsc perf
        const newPlugins: RuntimePlugin<Schema>[] = [];
        for (const plugin of this.options.plugins ?? []) {
            if (plugin.id !== pluginId) {
                newPlugins.push(plugin);
            }
        }
        const newOptions: ClientOptions<Schema> = {
            ...this.options,
            plugins: newPlugins,
        };
        return new ClientImpl<Schema>(this.schema, newOptions, this);
    }

    $unuseAll() {
        // tsc perf
        const newOptions: ClientOptions<Schema> = {
            ...this.options,
            plugins: [] as RuntimePlugin<Schema>[],
        };
        return new ClientImpl<Schema>(this.schema, newOptions, this);
    }

    $setAuth(auth: AuthType<Schema> | undefined) {
        if (auth !== undefined && typeof auth !== 'object') {
            throw new Error('Invalid auth object');
        }
        const newClient = new ClientImpl<Schema>(this.schema, this.$options, this);
        newClient.auth = auth;
        return newClient;
    }

    get $auth() {
        return this.auth;
    }

    $setInputValidation(enable: boolean) {
        const newOptions: ClientOptions<Schema> = {
            ...this.options,
            validateInput: enable,
        };
        return new ClientImpl<Schema>(this.schema, newOptions, this);
    }

    $executeRaw(query: TemplateStringsArray, ...values: any[]) {
        return createZenStackPromise(async () => {
            const result = await sql(query, ...values).execute(this.kysely);
            return Number(result.numAffectedRows ?? 0);
        });
    }

    $executeRawUnsafe(query: string, ...values: any[]) {
        return createZenStackPromise(async () => {
            const compiledQuery = this.createRawCompiledQuery(query, values);
            const result = await this.kysely.executeQuery(compiledQuery);
            return Number(result.numAffectedRows ?? 0);
        });
    }

    $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: any[]) {
        return createZenStackPromise(async () => {
            const result = await sql(query, ...values).execute(this.kysely);
            return result.rows as T;
        });
    }

    $queryRawUnsafe<T = unknown>(query: string, ...values: any[]) {
        return createZenStackPromise(async () => {
            const compiledQuery = this.createRawCompiledQuery(query, values);
            const result = await this.kysely.executeQuery(compiledQuery);
            return result.rows as T;
        });
    }

    private createRawCompiledQuery(query: string, values: any[]) {
        const q = CompiledQuery.raw(query, values);
        return { ...q, $raw: true } as CompiledQuery;
    }
}

function createClientProxy<Schema extends SchemaDef>(client: ClientImpl<Schema>): ClientImpl<Schema> {
    const inputValidator = new InputValidator(client as unknown as ClientContract<Schema>);
    const resultProcessor = new ResultProcessor(client.$schema, client.$options);

    return new Proxy(client, {
        get: (target, prop, receiver) => {
            if (typeof prop === 'string' && prop.startsWith('$')) {
                return Reflect.get(target, prop, receiver);
            }

            if (typeof prop === 'string') {
                const model = Object.keys(client.$schema.models).find((m) => m.toLowerCase() === prop.toLowerCase());
                if (model) {
                    return createModelCrudHandler(
                        client as unknown as ClientContract<Schema>,
                        model as GetModels<Schema>,
                        inputValidator,
                        resultProcessor,
                    );
                }
            }

            return Reflect.get(target, prop, receiver);
        },
    }) as unknown as ClientImpl<Schema>;
}

function createModelCrudHandler<Schema extends SchemaDef, Model extends GetModels<Schema>>(
    client: ClientContract<Schema>,
    model: Model,
    inputValidator: InputValidator<Schema>,
    resultProcessor: ResultProcessor<Schema>,
): ModelOperations<Schema, Model> {
    const createPromise = (
        operation: CoreCrudOperation,
        nominalOperation: AllCrudOperation,
        args: unknown,
        handler: BaseOperationHandler<Schema>,
        postProcess = false,
        throwIfNoResult = false,
    ) => {
        return createZenStackPromise(async (txClient?: ClientContract<Schema>) => {
            let proceed = async (_args: unknown) => {
                const _handler = txClient ? handler.withClient(txClient) : handler;
                const r = await _handler.handle(operation, _args);
                if (!r && throwIfNoResult) {
                    throw new NotFoundError(model);
                }
                let result: unknown;
                if (r && postProcess) {
                    result = resultProcessor.processResult(r, model, args);
                } else {
                    result = r ?? null;
                }
                return result;
            };

            // apply plugins
            const plugins = [...(client.$options.plugins ?? [])];
            for (const plugin of plugins) {
                const onQuery = plugin.onQuery;
                if (onQuery) {
                    const _proceed = proceed;
                    proceed = (_args: unknown) =>
                        onQuery({
                            client,
                            model,
                            operation: nominalOperation,
                            // reflect the latest override if provided
                            args: _args,
                            // ensure inner overrides are propagated to the previous proceed
                            proceed: (nextArgs: unknown) => _proceed(nextArgs),
                        }) as Promise<unknown>;
                }
            }

            return proceed(args);
        });
    };

    // type parameters to operation handlers are explicitly specified to improve tsc performance
    return {
        findUnique: (args: unknown) => {
            return createPromise(
                'findUnique',
                'findUnique',
                args,
                new FindOperationHandler<Schema>(client, model, inputValidator),
                true,
            );
        },

        findUniqueOrThrow: (args: unknown) => {
            return createPromise(
                'findUnique',
                'findUniqueOrThrow',
                args,
                new FindOperationHandler<Schema>(client, model, inputValidator),
                true,
                true,
            );
        },

        findFirst: (args: unknown) => {
            return createPromise(
                'findFirst',
                'findFirst',
                args,
                new FindOperationHandler<Schema>(client, model, inputValidator),
                true,
            );
        },

        findFirstOrThrow: (args: unknown) => {
            return createPromise(
                'findFirst',
                'findFirstOrThrow',
                args,
                new FindOperationHandler<Schema>(client, model, inputValidator),
                true,
                true,
            );
        },

        findMany: (args: unknown) => {
            return createPromise(
                'findMany',
                'findMany',
                args,
                new FindOperationHandler<Schema>(client, model, inputValidator),
                true,
            );
        },

        create: (args: unknown) => {
            return createPromise(
                'create',
                'create',
                args,
                new CreateOperationHandler<Schema>(client, model, inputValidator),
                true,
            );
        },

        createMany: (args: unknown) => {
            return createPromise(
                'createMany',
                'createMany',
                args,
                new CreateOperationHandler<Schema>(client, model, inputValidator),
                false,
            );
        },

        createManyAndReturn: (args: unknown) => {
            return createPromise(
                'createManyAndReturn',
                'createManyAndReturn',
                args,
                new CreateOperationHandler<Schema>(client, model, inputValidator),
                true,
            );
        },

        update: (args: unknown) => {
            return createPromise(
                'update',
                'update',
                args,
                new UpdateOperationHandler<Schema>(client, model, inputValidator),
                true,
            );
        },

        updateMany: (args: unknown) => {
            return createPromise(
                'updateMany',
                'updateMany',
                args,
                new UpdateOperationHandler<Schema>(client, model, inputValidator),
                false,
            );
        },

        updateManyAndReturn: (args: unknown) => {
            return createPromise(
                'updateManyAndReturn',
                'updateManyAndReturn',
                args,
                new UpdateOperationHandler<Schema>(client, model, inputValidator),
                true,
            );
        },

        upsert: (args: unknown) => {
            return createPromise(
                'upsert',
                'upsert',
                args,
                new UpdateOperationHandler<Schema>(client, model, inputValidator),
                true,
            );
        },

        delete: (args: unknown) => {
            return createPromise(
                'delete',
                'delete',
                args,
                new DeleteOperationHandler<Schema>(client, model, inputValidator),
                true,
            );
        },

        deleteMany: (args: unknown) => {
            return createPromise(
                'deleteMany',
                'deleteMany',
                args,
                new DeleteOperationHandler<Schema>(client, model, inputValidator),
                false,
            );
        },

        count: (args: unknown) => {
            return createPromise(
                'count',
                'count',
                args,
                new CountOperationHandler<Schema>(client, model, inputValidator),
                false,
            );
        },

        aggregate: (args: unknown) => {
            return createPromise(
                'aggregate',
                'aggregate',
                args,
                new AggregateOperationHandler<Schema>(client, model, inputValidator),
                false,
            );
        },

        groupBy: (args: unknown) => {
            return createPromise(
                'groupBy',
                'groupBy',
                args,
                new GroupByOperationHandler<Schema>(client, model, inputValidator),
                true,
            );
        },
    } as ModelOperations<Schema, Model>;
}
