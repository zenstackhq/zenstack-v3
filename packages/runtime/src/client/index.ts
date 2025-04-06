import {
    Kysely,
    PostgresDialect,
    SqliteDialect,
    type KyselyPlugin,
    type PostgresDialectConfig,
    type SqliteDialectConfig,
} from 'kysely';
import { match } from 'ts-pattern';
import { type GetModels, type SchemaDef } from '../schema/schema';
import type { ModelOperations } from './client-types';
import { AggregateOperationHandler } from './crud/operations/aggregate';
import type {
    BaseOperationHandler,
    CrudOperation,
} from './crud/operations/base';
import { CountOperationHandler } from './crud/operations/count';
import { CreateOperationHandler } from './crud/operations/create';
import { DeleteOperationHandler } from './crud/operations/delete';
import { FindOperationHandler } from './crud/operations/find';
import { UpdateOperationHandler } from './crud/operations/update';
import { InputValidator } from './crud/operations/validator';
import { NotFoundError } from './errors';
import { SchemaDbPusher } from './helpers/schema-db-pusher';
import type { ClientOptions, HasComputedFields } from './options';
import type { RuntimePlugin } from './plugin';
import { createDeferredPromise } from './promise';
import type { ToKysely } from './query-builder';
import { ResultProcessor } from './result-processor';

/**
 * ZenStack client interface.
 */
export type ClientContract<Schema extends SchemaDef> = {
    readonly $schema: Schema;

    /**
     * The client options.
     */
    readonly $options: ClientOptions<Schema>;

    /**
     * The Kysely query builder instance.
     */
    readonly $qb: ToKysely<Schema>;

    /**
     * Returns a new client with the specified plugin installed.
     */
    $use(plugin: RuntimePlugin<Schema>): ClientContract<Schema>;

    /**
     * Disconnects the underlying Kysely instance from the database.
     */
    $disconnect(): Promise<void>;

    /**
     * Pushes the schema to the database. For testing purposes only.
     */
    $pushSchema(): Promise<void>;
} & {
    [Key in GetModels<Schema> as Key extends string
        ? Uncapitalize<Key>
        : never]: ModelOperations<Schema, Key>;
};

/**
 * Creates a new ZenStack client instance.
 */
export interface ClientConstructor {
    new <Schema extends SchemaDef>(
        schema: HasComputedFields<Schema> extends false ? Schema : never
    ): ClientContract<Schema>;
    new <Schema extends SchemaDef>(
        schema: Schema,
        options: ClientOptions<Schema>
    ): ClientContract<Schema>;
}

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

        return createClientProxy(this as ClientContract<Schema>);
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
            newClient as ClientContract<Schema>
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
    }) as ClientImpl<Schema>;
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

    async function callBeforeQueryLifecycleHooks(
        operation: CrudOperation,
        args: unknown
    ) {
        const plugins = client.$options.plugins?.filter(
            (p) => typeof p.beforeQuery === 'function'
        );
        if (plugins && plugins.length > 0) {
            await Promise.all(
                plugins.map((plugin) => {
                    plugin.beforeQuery!({
                        client,
                        model,
                        operation,
                        args,
                    });
                })
            );
        }
    }

    async function callAfterQueryLifecycleHooks(
        operation: CrudOperation,
        args: unknown,
        result: unknown | undefined,
        error: unknown | undefined
    ) {
        const plugins = client.$options.plugins?.filter(
            (p) => typeof p.afterQuery === 'function'
        );
        if (plugins && plugins.length > 0) {
            await Promise.all(
                plugins.map((plugin) => {
                    plugin.afterQuery!({
                        client,
                        model,
                        operation,
                        args,
                        result,
                        error,
                    });
                })
            );
        }
    }

    const createPromise = (
        operation: CrudOperation,
        args: unknown,
        handler: BaseOperationHandler<Schema>,
        postProcess = false,
        throwIfNotFound = false
    ) => {
        return createDeferredPromise(async () => {
            // call beforeQuery lifecycle hooks
            await callBeforeQueryLifecycleHooks(operation, args);

            return handler
                .handle(operation, args)
                .then((r) => {
                    if (!r && throwIfNotFound) {
                        throw new NotFoundError(model);
                    }
                    let result: unknown;
                    if (r && postProcess) {
                        result = resultProcessor.processResult(r, model);
                    } else {
                        result = r ?? null;
                    }

                    // call afterQuery lifecycle hooks with result
                    callAfterQueryLifecycleHooks(
                        operation,
                        args,
                        result,
                        undefined
                    );

                    return result;
                })
                .catch((err) => {
                    // call afterQuery lifecycle hooks with error
                    callAfterQueryLifecycleHooks(
                        operation,
                        args,
                        undefined,
                        err
                    );
                    throw err;
                });
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
                    args,
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
                    args,
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
                    args,
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
                    args,
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
                    args,
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
                    args,
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
                    args,
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
                    args,
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
                    args,
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
                    args,
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
                    args,
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
                    args,
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
                    args,
                }),
                false
            );
        },
    } as ModelOperations<Schema, Model>;
}

export type * from './client-types';
export type { CliGenerator } from './plugin';
export type { ClientOptions, ToKysely };
