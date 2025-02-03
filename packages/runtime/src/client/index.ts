import SQLite from 'better-sqlite3';
import { Kysely, SqliteDialect } from 'kysely';
import { type GetModels, type SchemaDef } from '../schema/schema';
import { runCreate } from './operations/create';
import type { toKysely } from './query-builder';
import type { DBClient, ModelOperations } from './types';
import { runFind } from './operations/find';
import { NotFoundError } from './errors';

export function makeClient<Schema extends SchemaDef>(schema: Schema) {
    return new Client<Schema>(schema) as unknown as DBClient<Schema>;
}

class Client<Schema extends SchemaDef> {
    public readonly $db: Kysely<toKysely<Schema>>;

    constructor(schema: Schema) {
        this.$db = this.createKysely(schema);
        return createClientProxy(this, schema);
    }

    private createKysely<Schema extends SchemaDef>(
        _schema: Schema
    ): Kysely<toKysely<Schema>> {
        return new Kysely({
            dialect: new SqliteDialect({ database: new SQLite(':memory:') }),
        });
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
                    return createModelProxy(client, client.$db, schema, model);
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
            return runCreate(db, schema, model, args);
        },

        findUnique: async (args) => {
            const r = await runFind(db, schema, model, 'findUnique', args);
            return r ?? null;
        },

        findUniqueOrThrow: async (args) => {
            const r = await runFind(db, schema, model, 'findUnique', args);
            if (!r) {
                throw new NotFoundError(`No "${model}" found`);
            } else {
                return r;
            }
        },

        findFirst: async (args) => {
            return runFind(db, schema, model, 'findFirst', args);
        },

        findFirstOrThrow: async (args) => {
            const r = await runFind(db, schema, model, 'findFirst', args);
            if (!r) {
                throw new NotFoundError(`No "${model}" found`);
            } else {
                return r;
            }
        },

        findMany: async (args) => {
            return runFind(db, schema, model, 'findMany', args);
        },
    };
}
