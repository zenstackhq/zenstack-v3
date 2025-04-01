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
import { CrudHandler, type CrudOperation } from './crud/crud-handler';
import { InputValidator } from './crud/operations/validator';
import { NotFoundError } from './errors';
import { SchemaDbPusher } from './helpers/schema-db-pusher';
import type { ClientOptions, HasComputedFields } from './options';
import type { RuntimePlugin } from './plugin';
import { createDeferredPromise } from './promise';
import type { ToKysely } from './query-builder';
import { ResultProcessor } from './result-processor';

export type Client<Schema extends SchemaDef> = {
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
    $use(plugin: RuntimePlugin<Schema>): Client<Schema>;

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

export function createClient<Schema extends SchemaDef>(
    schema: HasComputedFields<Schema> extends false ? Schema : never
): Client<Schema>;
export function createClient<Schema extends SchemaDef>(
    schema: Schema,
    options: ClientOptions<Schema>
): Client<Schema>;
export function createClient<Schema extends SchemaDef>(
    schema: any,
    options?: ClientOptions<Schema>
) {
    return new ClientImpl<Schema>(schema, options) as unknown as Client<Schema>;
}

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

        const plugins = [...(this.options?.kyselyPlugins ?? [])];
        this.kysely =
            options?.kysely ??
            new Kysely({
                dialect: this.getKyselyDialect(),
                log: options?.log,
                plugins,
            });

        return createClientProxy(this as Client<Schema>);
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
            newClient as Client<Schema>
        );
        return newClient;
    }

    private installKyselyPlugin(
        kysely: ToKysely<Schema>,
        plugin: RuntimePlugin<Schema>,
        client: Client<Schema>
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
    client: Client<Schema>
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
                    return createModelProxy(client, model as GetModels<Schema>);
                }
            }

            return Reflect.get(target, prop, receiver);
        },
    }) as ClientImpl<Schema>;
}

function createModelProxy<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>
>(client: Client<Schema>, model: Model): ModelOperations<Schema, Model> {
    const inputValidator = new InputValidator(client.$schema);
    const resultProcessor = new ResultProcessor(client.$schema);

    const makeHandler = (operation: CrudOperation, args: unknown) => {
        return new CrudHandler(client, inputValidator, model, operation, args);
    };

    return {
        findUnique: (args) =>
            createDeferredPromise(async () => {
                const handler = makeHandler('findUnique', args);
                const r = await handler.findUnique(args);
                return resultProcessor.processResult(r, model) ?? null;
            }),

        findUniqueOrThrow: (args) =>
            createDeferredPromise(async () => {
                const handler = makeHandler('findUnique', args);
                const r = await handler.findUnique(args);
                if (!r) {
                    throw new NotFoundError(model);
                } else {
                    return resultProcessor.processResult(r, model);
                }
            }),

        findFirst: (args) =>
            createDeferredPromise(async () => {
                const handler = makeHandler('findFirst', args);
                const r = await handler.findFirst(args);
                return resultProcessor.processResult(r, model);
            }),

        findFirstOrThrow: (args) =>
            createDeferredPromise(async () => {
                const handler = makeHandler('findFirst', args);
                const r = await handler.findFirst(args);
                if (!r) {
                    throw new NotFoundError(model);
                } else {
                    return resultProcessor.processResult(r, model);
                }
            }),

        findMany: (args) =>
            createDeferredPromise(async () => {
                const handler = makeHandler('findMany', args);
                const r = await handler.findMany(args);
                return resultProcessor.processResult(r, model);
            }),

        create: (args) =>
            createDeferredPromise(async () => {
                const handler = makeHandler('create', args);
                const r = await handler.create(args);
                return resultProcessor.processResult(r, model);
            }),

        createMany: (args) => {
            const handler = makeHandler('createMany', args);
            return createDeferredPromise(() => handler.createMany(args));
        },

        update: (args) =>
            createDeferredPromise(async () => {
                const handler = makeHandler('update', args);
                const r = await handler.update(args);
                return resultProcessor.processResult(r, model);
            }),

        updateMany: (args) => {
            const handler = makeHandler('updateMany', args);
            return createDeferredPromise(() => handler.updateMany(args));
        },

        delete: (args) =>
            createDeferredPromise(async () => {
                const handler = makeHandler('delete', args);
                const r = await handler.delete(args);
                return resultProcessor.processResult(r, model);
            }),

        deleteMany: (args) => {
            const handler = makeHandler('deleteMany', args);
            return createDeferredPromise(() => handler.deleteMany(args));
        },

        count: (args) => {
            const handler = makeHandler('count', args);
            return createDeferredPromise(() => handler.count(args) as any);
        },

        aggregate: (args) => {
            const handler = makeHandler('aggregate', args);
            return createDeferredPromise(
                async () => handler.aggregate(args) as any
            );
        },
    };
}

export type * from './client-types';
export type { ClientOptions, ToKysely };
export type { CliGenerator } from './plugin';
