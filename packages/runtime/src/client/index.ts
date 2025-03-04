import {
    Kysely,
    PostgresDialect,
    SqliteDialect,
    type PostgresDialectConfig,
    type SqliteDialectConfig,
} from 'kysely';
import { match } from 'ts-pattern';
import { type GetModels, type SchemaDef } from '../schema/schema';
import { CrudHandler } from './crud/crud-handler';
import { NotFoundError } from './errors';
import { PolicyPlugin } from './features/policy';
import type { ClientOptions, FeatureSettings } from './options';
import type { ToKysely } from './query-builder';
import { ResultProcessor } from './result-processor';
import type { ModelOperations } from './types';

export type Client<Schema extends SchemaDef> = {
    $qb: ToKysely<Schema>;
    $disconnect(): Promise<void>;
    $withFeatures(features: FeatureSettings<Schema>): Client<Schema>;
} & {
    [Key in GetModels<Schema> as Key extends string
        ? Uncapitalize<Key>
        : never]: ModelOperations<Schema, Key>;
};

export function makeClient<Schema extends SchemaDef>(
    schema: Schema,
    options: ClientOptions<Schema>
) {
    return new ClientImpl<Schema>(schema, options) as unknown as Client<Schema>;
}

class ClientImpl<Schema extends SchemaDef> {
    public readonly $qb: ToKysely<Schema>;

    constructor(
        private readonly schema: Schema,
        private readonly options: ClientOptions<Schema>
    ) {
        const plugins = [...(options.plugins ?? [])];
        if (options.features?.policy) {
            plugins.push(new PolicyPlugin(schema, options));
        }

        this.$qb = new Kysely({
            dialect: this.getKyselyDialect(),
            log: options.log,
            plugins,
        });
        return createClientProxy(this, schema, options);
    }

    private getKyselyDialect() {
        return match(this.schema.provider)
            .with(
                'sqlite',
                () =>
                    new SqliteDialect(
                        this.options.dialectConfig as SqliteDialectConfig
                    )
            )
            .with(
                'postgresql',
                () =>
                    new PostgresDialect(
                        this.options.dialectConfig as PostgresDialectConfig
                    )
            )
            .exhaustive();
    }

    async $disconnect() {
        await this.$qb.destroy();
    }

    $withFeatures(features: FeatureSettings<Schema>) {
        return makeClient(this.schema, {
            ...this.options,
            features: {
                ...this.options.features,
                ...features,
            },
        });
    }
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
                    return createModelProxy(
                        client,
                        client.$qb,
                        schema,
                        options,
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
    const handler = new CrudHandler(schema, kysely, options, model);
    const resultProcessor = new ResultProcessor(schema);
    return {
        create: async (args) => {
            const r = await handler.create(args);
            return resultProcessor.processResult(r, model);
        },

        findUnique: async (args) => {
            const r = await handler.findUnique(args);
            return resultProcessor.processResult(r, model) ?? null;
        },

        findUniqueOrThrow: async (args) => {
            const r = await handler.findUnique(args);
            if (!r) {
                throw new NotFoundError(`No "${model}" found`);
            } else {
                return resultProcessor.processResult(r, model);
            }
        },

        findFirst: async (args) => {
            const r = await handler.findFirst(args);
            return resultProcessor.processResult(r, model);
        },

        findFirstOrThrow: async (args) => {
            const r = await handler.findFirst(args);
            if (!r) {
                throw new NotFoundError(`No "${model}" found`);
            } else {
                return resultProcessor.processResult(r, model);
            }
        },

        findMany: async (args) => {
            const r = await handler.findMany(args);
            return resultProcessor.processResult(r, model);
        },
    };
}

export type { FeatureSettings, PolicySettings } from './options';
export type * from './types';
export type { ClientOptions, ToKysely };
