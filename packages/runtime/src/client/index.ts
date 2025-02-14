import { Effect, Match } from 'effect';
import {
    Kysely,
    ParseJSONResultsPlugin,
    PostgresDialect,
    SqliteDialect,
    type Dialect,
    type KyselyConfig,
    type PostgresDialectConfig,
    type SqliteDialectConfig,
} from 'kysely';
import {
    type DataSourceProvider,
    type GetModels,
    type SchemaDef,
} from '../schema/schema';
import { NotFoundError } from './errors';
import { PolicyPlugin } from './features/policy';
import { runCreate } from './operations/create';
import { getQueryDialect } from './operations/dialect';
import { runFind } from './operations/find';
import type { toKysely } from './query-builder';
import type { DBClient, FeatureSettings, ModelOperations } from './types';

type DialectConfig<Provider extends DataSourceProvider> =
    Provider extends 'sqlite'
        ? SqliteDialectConfig
        : Provider extends 'postgresql'
        ? PostgresDialectConfig
        : never;

export type ClientOptions<Provider extends DataSourceProvider> = {
    /**
     * Database dialect configuration.
     */
    dialectConfig: DialectConfig<Provider>;

    /**
     * Kysely plugins.
     */
    plugins?: KyselyConfig['plugins'];

    /**
     * Logging configuration.
     */
    log?: KyselyConfig['log'];

    /**
     * Feature enablement and configuration.
     */
    features?: FeatureSettings;
};

export type PolicySettings = {};

export function makeClient<Schema extends SchemaDef>(
    schema: Schema,
    options: ClientOptions<Schema['provider']>
) {
    return new Client<Schema>(schema, options) as unknown as DBClient<Schema>;
}

class Client<Schema extends SchemaDef> {
    public readonly $qb: Kysely<toKysely<Schema>>;

    constructor(
        private readonly schema: Schema,
        private readonly options: ClientOptions<Schema['provider']>
    ) {
        const dialect: Dialect = Match.value(schema.provider).pipe(
            Match.when(
                'sqlite',
                () =>
                    new SqliteDialect(
                        options.dialectConfig as SqliteDialectConfig
                    )
            ),
            Match.when(
                'postgresql',
                () =>
                    new PostgresDialect(
                        options.dialectConfig as PostgresDialectConfig
                    )
            ),
            Match.exhaustive
        );

        const plugins = [
            ...(options.plugins ?? []),
            new ParseJSONResultsPlugin(),
        ];
        if (options.features?.policy) {
            plugins.push(
                new PolicyPlugin(
                    schema,
                    getQueryDialect(schema.provider),
                    options.features.policy
                )
            );
        }

        this.$qb = new Kysely({
            dialect,
            log: options.log,
            plugins,
        });
        return createClientProxy(this, schema, options);
    }

    async $disconnect() {
        await this.$qb.destroy();
    }

    $withFeatures(features: FeatureSettings) {
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
    client: Client<Schema>,
    schema: Schema,
    options: ClientOptions<Schema['provider']>
): Client<Schema> {
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
                        model
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
    _client: Client<Schema>,
    kysely: Kysely<toKysely<Schema>>,
    schema: Schema,
    options: ClientOptions<Schema['provider']>,
    model: string
): ModelOperations<Schema, Model> {
    const baseContext = { kysely, schema, model, clientOptions: options };
    return {
        create: async (args) => {
            const r = await Effect.runPromise(
                runCreate(
                    {
                        ...baseContext,
                        operation: 'create',
                    },
                    args
                )
            );
            return r;
        },

        findUnique: async (args) => {
            const r = await Effect.runPromise(
                runFind(
                    {
                        ...baseContext,
                        operation: 'findUnique',
                    },
                    args
                )
            );
            return r ?? null;
        },

        findUniqueOrThrow: async (args) => {
            const r = await Effect.runPromise(
                runFind(
                    {
                        ...baseContext,
                        operation: 'findUnique',
                    },
                    args
                )
            );
            if (!r) {
                throw new NotFoundError(`No "${model}" found`);
            } else {
                return r;
            }
        },

        findFirst: async (args) => {
            return Effect.runPromise(
                runFind(
                    {
                        ...baseContext,
                        operation: 'findFirst',
                    },
                    args
                )
            );
        },

        findFirstOrThrow: async (args) => {
            const r = await Effect.runPromise(
                runFind(
                    {
                        ...baseContext,
                        operation: 'findFirst',
                    },
                    args
                )
            );
            if (!r) {
                throw new NotFoundError(`No "${model}" found`);
            } else {
                return r;
            }
        },

        findMany: async (args) => {
            return Effect.runPromise(
                runFind(
                    {
                        ...baseContext,
                        operation: 'findMany',
                    },
                    args
                )
            );
        },
    };
}

export type { DBClient, toKysely };
