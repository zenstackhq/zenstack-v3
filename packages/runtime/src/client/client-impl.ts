import type { SqliteDialectConfig } from 'kysely';
import {
    DefaultConnectionProvider,
    DefaultQueryExecutor,
    Kysely,
    Log,
    PostgresDialect,
    SqliteDialect,
    type KyselyProps,
    type PostgresDialectConfig,
} from 'kysely';
import { match } from 'ts-pattern';
import type { GetModels, ProcedureDef, SchemaDef } from '../schema';
import type { AuthType } from '../schema/auth';
import type { ClientConstructor, ClientContract } from './contract';
import type { ModelOperations } from './crud-types';
import { AggregateOperationHandler } from './crud/operations/aggregate';
import type { CrudOperation } from './crud/operations/base';
import { BaseOperationHandler } from './crud/operations/base';
import { CountOperationHandler } from './crud/operations/count';
import { CreateOperationHandler } from './crud/operations/create';
import { DeleteOperationHandler } from './crud/operations/delete';
import { FindOperationHandler } from './crud/operations/find';
import { GroupByeOperationHandler } from './crud/operations/group-by';
import { UpdateOperationHandler } from './crud/operations/update';
import { InputValidator } from './crud/validator';
import { NotFoundError, QueryError } from './errors';
import { ZenStackDriver } from './executor/zenstack-driver';
import { ZenStackQueryExecutor } from './executor/zenstack-query-executor';
import * as BuiltinFunctions from './functions';
import { SchemaDbPusher } from './helpers/schema-db-pusher';
import type { ClientOptions, ProceduresOptions } from './options';
import type { RuntimePlugin } from './plugin';
import { createDeferredPromise } from './promise';
import type { ToKysely } from './query-builder';
import { ResultProcessor } from './result-processor';

/**
 * ZenStack client.
 */
export const ZenStackClient = function <Schema extends SchemaDef>(
    this: any,
    schema: any,
    options: ClientOptions<Schema>
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
        baseClient?: ClientImpl<Schema>
    ) {
        this.$schema = schema;
        this.$options = options ?? ({} as ClientOptions<Schema>);

        this.$options.functions = {
            ...BuiltinFunctions,
            ...this.$options.functions,
        };

        // here we use kysely's props constructor so we can pass a custom query executor
        if (baseClient) {
            this.kyselyProps = {
                ...baseClient.kyselyProps,
                executor: new ZenStackQueryExecutor(
                    this,
                    baseClient.kyselyProps.driver as ZenStackDriver,
                    baseClient.kyselyProps.dialect.createQueryCompiler(),
                    baseClient.kyselyProps.dialect.createAdapter(),
                    new DefaultConnectionProvider(baseClient.kyselyProps.driver)
                ),
            };
            this.kyselyRaw = baseClient.kyselyRaw;
        } else {
            const dialect = this.getKyselyDialect();
            const driver = new ZenStackDriver(
                dialect.createDriver(),
                new Log(this.$options.log ?? [])
            );
            const compiler = dialect.createQueryCompiler();
            const adapter = dialect.createAdapter();
            const connectionProvider = new DefaultConnectionProvider(driver);
            const executor = new ZenStackQueryExecutor(
                this,
                driver,
                compiler,
                adapter,
                connectionProvider
            );

            this.kyselyProps = {
                config: {
                    dialect,
                    log: this.$options.log,
                },
                dialect,
                driver,
                executor,
            };

            // raw kysely instance with default executor
            this.kyselyRaw = new Kysely({
                ...this.kyselyProps,
                executor: new DefaultQueryExecutor(
                    compiler,
                    adapter,
                    connectionProvider,
                    []
                ),
            });
        }

        this.kysely = new Kysely(this.kyselyProps);

        return createClientProxy(this as unknown as ClientContract<Schema>);
    }

    public get $qb() {
        return this.kysely;
    }

    public get $qbRaw() {
        return this.kyselyRaw;
    }

    private getKyselyDialect() {
        return match(this.schema.provider.type)
            .with('sqlite', () => this.makeSqliteKyselyDialect())
            .with('postgresql', () => this.makePostgresKyselyDialect())
            .exhaustive();
    }

    private makePostgresKyselyDialect(): PostgresDialect {
        return new PostgresDialect(
            this.options.dialectConfig as PostgresDialectConfig
        );
    }

    private makeSqliteKyselyDialect(): SqliteDialect {
        return new SqliteDialect(
            this.options.dialectConfig as SqliteDialectConfig
        );
    }

    async $transaction<T>(
        callback: (tx: ClientContract<Schema>) => Promise<T>
    ): Promise<T> {
        return this.kysely.transaction().execute((tx) => {
            const txClient = new ClientImpl<Schema>(this.schema, this.$options);
            txClient.kysely = tx;
            return callback(txClient as unknown as ClientContract<Schema>);
        });
    }

    get $procedures() {
        return Object.keys(this.$schema.procedures ?? {}).reduce(
            (acc, name) => {
                acc[name] = (...args: unknown[]) => this.handleProc(name, args);
                return acc;
            },
            {} as any
        );
    }

    private async handleProc(name: string, args: unknown[]) {
        if (
            !('procedures' in this.$options) ||
            !this.$options ||
            typeof this.$options.procedures !== 'object'
        ) {
            throw new QueryError(
                'Procedures are not configured for the client.'
            );
        }

        const procOptions = this.$options.procedures as ProceduresOptions<
            Schema & {
                procedures: Record<string, ProcedureDef>;
            }
        >;
        if (!procOptions[name] || typeof procOptions[name] !== 'function') {
            throw new Error(
                `Procedure "${name}" does not have a handler configured.`
            );
        }

        // eslint-disable-next-line @typescript-eslint/ban-types
        return (procOptions[name] as Function).apply(this, [this, ...args]);
    }

    async $disconnect() {
        await this.kysely.destroy();
    }

    async $pushSchema() {
        await new SchemaDbPusher(this.schema, this.kysely).push();
    }

    $use(plugin: RuntimePlugin<Schema>) {
        const newOptions = {
            ...this.options,
            plugins: [...(this.options?.plugins ?? []), plugin],
        } as ClientOptions<Schema>;
        return new ClientImpl<Schema>(this.schema, newOptions, this);
    }

    $unuseAll() {
        const newOptions = {
            ...this.options,
            plugins: [] as RuntimePlugin<Schema>[],
        } as ClientOptions<Schema>;
        return new ClientImpl<Schema>(this.schema, newOptions, this);
    }

    $setAuth(auth: AuthType<Schema> | undefined) {
        if (auth !== undefined && typeof auth !== 'object') {
            throw new Error('Invalid auth object');
        }
        const newClient = new ClientImpl<Schema>(
            this.schema,
            this.$options,
            this
        );
        newClient.auth = auth;
        return newClient;
    }

    get $auth() {
        return this.auth;
    }
}

function createClientProxy<Schema extends SchemaDef>(
    client: ClientContract<Schema>
): ClientImpl<Schema> {
    const inputValidator = new InputValidator(client.$schema);
    const resultProcessor = new ResultProcessor(client.$schema);

    return new Proxy(client, {
        get: (target, prop, receiver) => {
            if (typeof prop === 'string' && prop.startsWith('$')) {
                return Reflect.get(target, prop, receiver);
            }

            if (typeof prop === 'string') {
                const model = Object.keys(client.$schema.models).find(
                    (m) => m.toLowerCase() === prop.toLowerCase()
                );
                if (model) {
                    return createModelCrudHandler(
                        client,
                        model as GetModels<Schema>,
                        inputValidator,
                        resultProcessor
                    );
                }
            }

            return Reflect.get(target, prop, receiver);
        },
    }) as unknown as ClientImpl<Schema>;
}

function createModelCrudHandler<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>
>(
    client: ClientContract<Schema>,
    model: Model,
    inputValidator: InputValidator<Schema>,
    resultProcessor: ResultProcessor<Schema>
): ModelOperations<Schema, Model> {
    const createPromise = (
        operation: CrudOperation,
        args: unknown,
        handler: BaseOperationHandler<Schema>,
        postProcess = false,
        throwIfNoResult = false
    ) => {
        return createDeferredPromise(async () => {
            let proceed = async (
                _args?: unknown,
                tx?: ClientContract<Schema>
            ) => {
                const _handler = tx ? handler.withClient(tx) : handler;
                const r = await _handler.handle(operation, _args ?? args);
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

            const context = {
                client,
                model,
                operation,
                queryArgs: args,
            };

            const plugins = [...(client.$options.plugins ?? [])];
            for (const plugin of plugins) {
                if (plugin.onQuery) {
                    const _proceed = proceed;
                    proceed = () =>
                        plugin.onQuery!({ ...context, proceed: _proceed });
                }
            }

            return proceed(args);
        });
    };

    return {
        findUnique: (args: unknown) => {
            return createPromise(
                'findUnique',
                args,
                new FindOperationHandler(client, model, inputValidator),
                true
            );
        },

        findUniqueOrThrow: (args: unknown) => {
            return createPromise(
                'findUnique',
                args,
                new FindOperationHandler(client, model, inputValidator),
                true,
                true
            );
        },

        findFirst: (args: unknown) => {
            return createPromise(
                'findFirst',
                args,
                new FindOperationHandler(client, model, inputValidator),
                true
            );
        },

        findFirstOrThrow: (args: unknown) => {
            return createPromise(
                'findFirst',
                args,
                new FindOperationHandler(client, model, inputValidator),
                true,
                true
            );
        },

        findMany: (args: unknown) => {
            return createPromise(
                'findMany',
                args,
                new FindOperationHandler(client, model, inputValidator),
                true
            );
        },

        create: (args: unknown) => {
            return createPromise(
                'create',
                args,
                new CreateOperationHandler(client, model, inputValidator),
                true
            );
        },

        createMany: (args: unknown) => {
            return createPromise(
                'createMany',
                args,
                new CreateOperationHandler(client, model, inputValidator),
                false
            );
        },

        createManyAndReturn: (args: unknown) => {
            return createPromise(
                'createManyAndReturn',
                args,
                new CreateOperationHandler(client, model, inputValidator),
                true
            );
        },

        update: (args: unknown) => {
            return createPromise(
                'update',
                args,
                new UpdateOperationHandler(client, model, inputValidator),
                true
            );
        },

        updateMany: (args: unknown) => {
            return createPromise(
                'updateMany',
                args,
                new UpdateOperationHandler(client, model, inputValidator),
                false
            );
        },

        updateManyAndReturn: (args: unknown) => {
            return createPromise(
                'updateManyAndReturn',
                args,
                new UpdateOperationHandler(client, model, inputValidator),
                true
            );
        },

        upsert: (args: unknown) => {
            return createPromise(
                'upsert',
                args,
                new UpdateOperationHandler(client, model, inputValidator),
                true
            );
        },

        delete: (args: unknown) => {
            return createPromise(
                'delete',
                args,
                new DeleteOperationHandler(client, model, inputValidator),
                true
            );
        },

        deleteMany: (args: unknown) => {
            return createPromise(
                'deleteMany',
                args,
                new DeleteOperationHandler(client, model, inputValidator),
                false
            );
        },

        count: (args: unknown) => {
            return createPromise(
                'count',
                args,
                new CountOperationHandler(client, model, inputValidator),
                false
            );
        },

        aggregate: (args: unknown) => {
            return createPromise(
                'aggregate',
                args,
                new AggregateOperationHandler(client, model, inputValidator),
                false
            );
        },

        groupBy: (args: unknown) => {
            return createPromise(
                'groupBy',
                args,
                new GroupByeOperationHandler(client, model, inputValidator)
            );
        },
    } as ModelOperations<Schema, Model>;
}
