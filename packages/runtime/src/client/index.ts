import {
    Kysely,
    PostgresDialect,
    SqliteDialect,
    type PostgresDialectConfig,
    type SqliteDialectConfig,
} from 'kysely';
import { match } from 'ts-pattern';
import { type GetModels, type SchemaDef } from '../schema/schema';
import type { ModelOperations } from './client-types';
import { CrudHandler } from './crud/crud-handler';
import { NotFoundError } from './errors';
import { PolicyPlugin } from './features/policy';
import type { ClientOptions, HasComputedFields } from './options';
import { createDeferredPromise } from './promise';
import type { ToKysely } from './query-builder';
import { ResultProcessor } from './result-processor';
import { SchemaDbPusher } from './helpers/schema-db-pusher';

export type Client<Schema extends SchemaDef> = {
    /**
     * The Kysely query builder instance.
     */
    readonly $qb: ToKysely<Schema>;

    /**
     * Disconnects the client from the database.
     */
    $disconnect(): Promise<void>;

    /**
     * Pushes the schema to the database. For testing purposes only.
     */
    $pushSchema(): Promise<void>;

    // $withFeatures(features: FeatureSettings<Schema>): Client<Schema>;
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
    public readonly $qb: ToKysely<Schema>;

    constructor(
        private readonly schema: Schema,
        private readonly options?: ClientOptions<Schema>
    ) {
        const plugins = [...(this.options?.plugins ?? [])];
        if (options?.features?.policy) {
            plugins.push(new PolicyPlugin(schema, options));
        }

        this.$qb =
            options?.kysely ??
            new Kysely({
                dialect: this.getKyselyDialect(),
                log: options?.log,
                plugins,
            });
        return createClientProxy(
            this,
            schema,
            (options ?? {}) as ClientOptions<Schema>
        );
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
        await this.$qb.destroy();
    }

    async $pushSchema() {
        await new SchemaDbPusher(this.schema, this.$qb).push();
    }

    // $withFeatures(features: FeatureSettings<Schema>) {
    //     return createClient(this.schema, {
    //         ...this.options,
    //         features: {
    //             ...this.options.features,
    //             ...features,
    //         },
    //     });
    // }
}

function createClientProxy<Schema extends SchemaDef>(
    client: ClientImpl<Schema>,
    schema: Schema,
    options: ClientOptions<Schema>
): ClientImpl<Schema> {
    return new Proxy(client, {
        get: (target, prop, receiver) => {
            if (typeof prop === 'string' && prop.startsWith('$')) {
                return Reflect.get(target, prop, receiver);
            }

            if (typeof prop === 'string') {
                const model = Object.keys(schema.models).find(
                    (m) => m.toLowerCase() === prop.toLowerCase()
                );
                if (model) {
                    const _options: ClientOptions<Schema> = options ?? {};

                    return createModelProxy(
                        client,
                        client.$qb,
                        schema,
                        _options,
                        model as GetModels<Schema>
                    );
                }
            }

            return Reflect.get(target, prop, receiver);
        },
    });
}

function createModelProxy<
    Schema extends SchemaDef,
    Model extends GetModels<Schema>
>(
    _client: ClientImpl<Schema>,
    kysely: ToKysely<Schema>,
    schema: Schema,
    options: ClientOptions<Schema>,
    model: Model
): ModelOperations<Schema, Model> {
    const handler = new CrudHandler(schema, kysely, options ?? {}, model);
    const resultProcessor = new ResultProcessor(schema);
    return {
        findUnique: (args) =>
            createDeferredPromise(async () => {
                const r = await handler.findUnique(args);
                return resultProcessor.processResult(r, model) ?? null;
            }),

        findUniqueOrThrow: (args) =>
            createDeferredPromise(async () => {
                const r = await handler.findUnique(args);
                if (!r) {
                    throw new NotFoundError(model);
                } else {
                    return resultProcessor.processResult(r, model);
                }
            }),

        findFirst: (args) =>
            createDeferredPromise(async () => {
                const r = await handler.findFirst(args);
                return resultProcessor.processResult(r, model);
            }),

        findFirstOrThrow: (args) =>
            createDeferredPromise(async () => {
                const r = await handler.findFirst(args);
                if (!r) {
                    throw new NotFoundError(model);
                } else {
                    return resultProcessor.processResult(r, model);
                }
            }),

        findMany: (args) =>
            createDeferredPromise(async () => {
                const r = await handler.findMany(args);
                return resultProcessor.processResult(r, model);
            }),

        create: (args) =>
            createDeferredPromise(async () => {
                const r = await handler.create(args);
                return resultProcessor.processResult(r, model);
            }),

        createMany: (args) =>
            createDeferredPromise(() => handler.createMany(args)),

        update: (args) =>
            createDeferredPromise(async () => {
                const r = await handler.update(args);
                return resultProcessor.processResult(r, model);
            }),

        updateMany: (args) =>
            createDeferredPromise(() => handler.updateMany(args)),

        delete: (args) =>
            createDeferredPromise(async () => {
                const r = await handler.delete(args);
                return resultProcessor.processResult(r, model);
            }),

        deleteMany: (args) =>
            createDeferredPromise(() => handler.deleteMany(args)),

        count: (args) =>
            createDeferredPromise(() => handler.count(args) as any),

        aggregate: (args) =>
            createDeferredPromise(async () => handler.aggregate(args) as any),
    };
}

export type * from './client-types';
export type { FeatureSettings, PolicySettings } from './options';
export type { ClientOptions, ToKysely };
