import { Match } from 'effect';
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
    type GetModels,
    type SchemaDef,
    type SupportedProviders,
} from '../schema/schema';
import { NotFoundError } from './errors';
import { runCreate } from './operations/create';
import { runFind } from './operations/find';
import type { toKysely } from './query-builder';
import type { DBClient, ModelOperations } from './types';

export type ClientOptions<Provider extends SupportedProviders> = {
    // dialect: KyselyConfig['dialect'];
    plugins?: KyselyConfig['plugins'];
    log?: KyselyConfig['log'];
    dialectConfig: Provider extends 'sqlite'
        ? SqliteDialectConfig
        : Provider extends 'postgresql'
        ? PostgresDialectConfig
        : never;
};

export function makeClient<Schema extends SchemaDef>(
    schema: Schema,
    options: ClientOptions<Schema['provider']>
) {
    return new Client<Schema>(schema, options) as unknown as DBClient<Schema>;
}

export class Client<Schema extends SchemaDef> {
    public readonly $qb: Kysely<toKysely<Schema>>;

    constructor(schema: Schema, options: ClientOptions<Schema['provider']>) {
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
        this.$qb = new Kysely({
            dialect,
            log: options.log,
            plugins: [...(options.plugins ?? []), new ParseJSONResultsPlugin()],
        });
        return createClientProxy(this, schema);
    }

    async $disconnect() {
        await this.$qb.destroy();
    }
}

function createClientProxy<Schema extends SchemaDef>(
    client: Client<Schema>,
    schema: Schema
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
                    return createModelProxy(client, client.$qb, schema, model);
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
    db: Kysely<toKysely<Schema>>,
    schema: Schema,
    model: string
): ModelOperations<Schema, Model> {
    return {
        create: async (args) => {
            const r = await runCreate(
                { db, schema, model, operation: 'create' },
                args
            );
            return r;
        },

        findUnique: async (args) => {
            const r = await runFind(
                { db, schema, model, operation: 'findUnique' },
                args
            );
            return r ?? null;
        },

        findUniqueOrThrow: async (args) => {
            const r = await runFind(
                { db, schema, model, operation: 'findUnique' },
                args
            );
            if (!r) {
                throw new NotFoundError(`No "${model}" found`);
            } else {
                return r;
            }
        },

        findFirst: async (args) => {
            return runFind({ db, schema, model, operation: 'findFirst' }, args);
        },

        findFirstOrThrow: async (args) => {
            const r = await runFind(
                { db, schema, model, operation: 'findFirst' },
                args
            );
            if (!r) {
                throw new NotFoundError(`No "${model}" found`);
            } else {
                return r;
            }
        },

        findMany: async (args) => {
            return runFind({ db, schema, model, operation: 'findMany' }, args);
        },
    };
}

export type { DBClient, toKysely };
