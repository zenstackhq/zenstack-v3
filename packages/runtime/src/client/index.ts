import { Effect, Match } from 'effect';
import {
    Kysely,
    ParseJSONResultsPlugin,
    PostgresDialect,
    SqliteDialect,
    type Dialect,
    type PostgresDialectConfig,
    type SqliteDialectConfig,
} from 'kysely';
import { type GetModels, type SchemaDef } from '../schema/schema';
import { makeZodSchemas } from '../zod/runtime';
import { NotFoundError } from './errors';
import { PolicyPlugin } from './features/policy';
import type { OperationContext } from './operations/context';
import { runCreate } from './operations/create';
import { getQueryDialect } from './operations/dialect';
import { runFind } from './operations/find';
import type { ClientOptions, FeatureSettings } from './options';
import type { toKysely } from './query-builder';
import type { ModelOperations } from './types';

export type Client<Schema extends SchemaDef> = {
    $qb: Kysely<toKysely<Schema>>;
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
    public readonly $qb: Kysely<toKysely<Schema>>;

    constructor(
        private readonly schema: Schema,
        private readonly options: ClientOptions<Schema>
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
    kysely: Kysely<toKysely<Schema>>,
    schema: Schema,
    options: ClientOptions<Schema>,
    model: Model
): ModelOperations<Schema, Model> {
    const baseContext: Omit<OperationContext<Schema>, 'operation'> = {
        kysely,
        schema,
        model,
        clientOptions: options,
    };
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

        $validation: makeZodSchemas(schema, model),
    };
}

export type { FeatureSettings, PolicySettings } from './options';
export type * from './types';
export type { ClientOptions, toKysely };
