import SQLite from 'better-sqlite3';
import { Kysely, SqliteDialect } from 'kysely';
import { type GetModels, type SchemaDef } from '../schema';
import { runCreate } from './operations/create';
import type { toKysely } from './query-builder';
import { hasModel } from './query-utils';
import type { DBClient, ModelOperations } from './types';

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

            if (typeof prop === 'string' && hasModel(schema, prop)) {
                return createModelProxy(client, client.$db, schema, prop);
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
        findUnique: async (_args) => {
            throw new Error('Not implemented');
        },
        findFirst: async (_args) => {
            throw new Error('Not implemented');
        },
        findMany: async (_args) => {
            throw new Error('Not implemented');
        },
    };
}
