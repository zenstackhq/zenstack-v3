import {
    Kysely,
    PostgresDialect,
    SqliteDialect,
    type KyselyPlugin,
    type PostgresDialectConfig,
    type SqliteDialectConfig,
} from 'kysely';
import { match } from 'ts-pattern';
import type { GetModels, ProcedureDef, SchemaDef } from '../schema';
import type { ClientConstructor, ClientContract } from './contract';
import type { ModelOperations } from './crud-types';
import { AggregateOperationHandler } from './crud/operations/aggregate';
import type { CrudOperation } from './crud/operations/base';
import { BaseOperationHandler } from './crud/operations/base';
import { CountOperationHandler } from './crud/operations/count';
import { CreateOperationHandler } from './crud/operations/create';
import { DeleteOperationHandler } from './crud/operations/delete';
import { FindOperationHandler } from './crud/operations/find';
import { UpdateOperationHandler } from './crud/operations/update';
import { InputValidator } from './crud/validator';
import { NotFoundError, QueryError } from './errors';
import { SchemaDbPusher } from './helpers/schema-db-pusher';
import type { ClientOptions, ProceduresOptions } from './options';
import type { RuntimePlugin } from './plugin';
import { createDeferredPromise } from './promise';
import type { ToKysely } from './query-builder';
import { ResultProcessor } from './result-processor';

/**
 * Creates a new ZenStack client instance.
 */
export const ZenStackClient = function <Schema extends SchemaDef>(
    this: any,
    schema: any,
    options?: ClientOptions<Schema>
) {
    return new ClientImpl<Schema>(schema, options);
} as unknown as ClientConstructor;

class ClientImpl<Schema extends SchemaDef> {
    private kysely: ToKysely<Schema>;
    public readonly $options: ClientOptions<Schema>;
    public readonly $schema: Schema;

    constructor(
        private readonly schema: Schema,
        private options?: ClientOptions<Schema>
    ) {
        this.$schema = schema;
        this.$options = options ?? ({} as ClientOptions<Schema>);

        this.kysely = new Kysely({
            dialect: this.getKyselyDialect(),
            log: options?.log,
        });

        return createClientProxy(this as unknown as ClientContract<Schema>);
    }

    public get $qb() {
        return this.kysely;
    }

    private getKyselyDialect() {
        return match(this.schema.provider.type)
            .with('sqlite', () => this.makeSqliteKyselyDialect())
            .with('postgresql', () => this.makePostgresKyselyDialect())
            .exhaustive();
    }

    private makePostgresKyselyDialect(): PostgresDialect {
        const { dialectConfigProvider } = this.schema.provider;
        const mergedConfig = {
            ...dialectConfigProvider(),
            ...this.options?.dialectConfig,
        } as PostgresDialectConfig;
        return new PostgresDialect(mergedConfig);
    }

    private makeSqliteKyselyDialect(): SqliteDialect {
        const { dialectConfigProvider } = this.schema.provider;
        const mergedConfig = {
            ...dialectConfigProvider(),
            ...this.options?.dialectConfig,
        } as SqliteDialectConfig;
        return new SqliteDialect(mergedConfig);
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

    get $procs() {
        return Object.keys(this.$schema.procs ?? {}).reduce((acc, name) => {
            acc[name] = (...args: unknown[]) => this.handleProc(name, args);
            return acc;
        }, {} as any);
    }

    private async handleProc(name: string, args: unknown[]) {
        if (
            !('procs' in this.$options) ||
            !this.$options ||
            typeof this.$options.procs !== 'object'
        ) {
            throw new QueryError(
                'Procedures are not configured for the client.'
            );
        }

        const procOptions = this.$options.procs as ProceduresOptions<
            Schema & {
                procs: Record<string, ProcedureDef>;
            }
        >;
        if (!procOptions[name] || typeof procOptions[name] !== 'function') {
            throw new Error(
                `Procedure "${name}" does not have a handler configured.`
            );
        }

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
        const newClient = new ClientImpl<Schema>(this.schema, newOptions);
        newClient.kysely = this.installKyselyPlugin(
            this.kysely,
            plugin,
            newClient as unknown as ClientContract<Schema>
        );
        return newClient;
    }

    private installKyselyPlugin(
        kysely: ToKysely<Schema>,
        plugin: RuntimePlugin<Schema>,
        client: ClientContract<Schema>
    ) {
        if (plugin.transformKyselyQuery || plugin.transformKyselyResult) {
            const kyselyPlugin: KyselyPlugin = {
                transformQuery(args) {
                    return plugin.transformKyselyQuery
                        ? plugin.transformKyselyQuery({
                              node: args.node,
                              client,
                          })
                        : args.node;
                },
                transformResult(args) {
                    return plugin.transformKyselyResult
                        ? plugin.transformKyselyResult({
                              ...args,
                              client,
                          })
                        : Promise.resolve(args.result);
                },
            };
            return kysely.withPlugin(kyselyPlugin);
        } else {
            return kysely;
        }
    }
}

function createClientProxy<Schema extends SchemaDef>(
    client: ClientContract<Schema>
): ClientImpl<Schema> {
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
                        model as GetModels<Schema>
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
    model: Model
): ModelOperations<Schema, Model> {
    const inputValidator = new InputValidator(client.$schema);
    const resultProcessor = new ResultProcessor(client.$schema);

    const createPromise = (
        operation: CrudOperation,
        args: unknown,
        handler: BaseOperationHandler<Schema>,
        postProcess = false,
        throwIfNotFound = false
    ) => {
        return createDeferredPromise(async () => {
            let proceed = async (
                args: unknown,
                tx?: ClientContract<Schema>
            ) => {
                const _handler = tx ? handler.withClient(tx) : handler;
                const r = await _handler.handle(operation, args);
                if (!r && throwIfNotFound) {
                    throw new NotFoundError(model);
                }
                let result: unknown;
                if (r && postProcess) {
                    result = resultProcessor.processResult(r, model);
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
                    proceed = () => plugin.onQuery!(context, _proceed);
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
                new FindOperationHandler(client, model, inputValidator, {
                    client,
                    model,
                    operation: 'findUnique',
                    queryArgs: args,
                }),
                true
            );
        },

        findUniqueOrThrow: (args: unknown) => {
            return createPromise(
                'findUnique',
                args,
                new FindOperationHandler(client, model, inputValidator, {
                    client,
                    model,
                    operation: 'findUnique',
                    queryArgs: args,
                }),
                true,
                true
            );
        },

        findFirst: (args: unknown) => {
            return createPromise(
                'findFirst',
                args,
                new FindOperationHandler(client, model, inputValidator, {
                    client,
                    model,
                    operation: 'findFirst',
                    queryArgs: args,
                }),
                true
            );
        },

        findFirstOrThrow: (args: unknown) => {
            return createPromise(
                'findFirst',
                args,
                new FindOperationHandler(client, model, inputValidator, {
                    client,
                    model,
                    operation: 'findFirst',
                    queryArgs: args,
                }),
                true,
                true
            );
        },

        findMany: (args: unknown) => {
            return createPromise(
                'findMany',
                args,
                new FindOperationHandler(client, model, inputValidator, {
                    client,
                    model,
                    operation: 'findMany',
                    queryArgs: args,
                }),
                true
            );
        },

        create: (args: unknown) => {
            return createPromise(
                'create',
                args,
                new CreateOperationHandler(client, model, inputValidator, {
                    client,
                    model,
                    operation: 'create',
                    queryArgs: args,
                }),
                true
            );
        },

        createMany: (args: unknown) => {
            return createPromise(
                'createMany',
                args,
                new CreateOperationHandler(client, model, inputValidator, {
                    client,
                    model,
                    operation: 'createMany',
                    queryArgs: args,
                }),
                false
            );
        },

        update: (args: unknown) => {
            return createPromise(
                'update',
                args,
                new UpdateOperationHandler(client, model, inputValidator, {
                    client,
                    model,
                    operation: 'update',
                    queryArgs: args,
                }),
                true
            );
        },

        updateMany: (args: unknown) => {
            return createPromise(
                'updateMany',
                args,
                new UpdateOperationHandler(client, model, inputValidator, {
                    client,
                    model,
                    operation: 'updateMany',
                    queryArgs: args,
                }),
                false
            );
        },

        delete: (args: unknown) => {
            return createPromise(
                'delete',
                args,
                new DeleteOperationHandler(client, model, inputValidator, {
                    client,
                    model,
                    operation: 'delete',
                    queryArgs: args,
                }),
                true
            );
        },

        deleteMany: (args: unknown) => {
            return createPromise(
                'deleteMany',
                args,
                new DeleteOperationHandler(client, model, inputValidator, {
                    client,
                    model,
                    operation: 'deleteMany',
                    queryArgs: args,
                }),
                false
            );
        },

        count: (args: unknown) => {
            return createPromise(
                'count',
                args,
                new CountOperationHandler(client, model, inputValidator, {
                    client,
                    model,
                    operation: 'count',
                    queryArgs: args,
                }),
                false
            );
        },

        aggregate: (args: unknown) => {
            return createPromise(
                'aggregate',
                args,
                new AggregateOperationHandler(client, model, inputValidator, {
                    client,
                    model,
                    operation: 'aggregate',
                    queryArgs: args,
                }),
                false
            );
        },
    } as ModelOperations<Schema, Model>;
}
