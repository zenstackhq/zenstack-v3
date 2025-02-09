import { Kysely, ParseJSONResultsPlugin, type KyselyConfig } from 'kysely';
import { type GetModels, type SchemaDef } from '../schema/schema';
import { NotFoundError } from './errors';
import { runCreate } from './operations/create';
import { runFind } from './operations/find';
import type { toKysely } from './query-builder';
import type { DBClient, ModelOperations } from './types';

export type ClientOptions = {
    dialect: KyselyConfig['dialect'];
    plugins?: KyselyConfig['plugins'];
    log?: KyselyConfig['log'];
};

export function makeClient<Schema extends SchemaDef>(
    schema: Schema,
    options: ClientOptions
) {
    return new Client<Schema>(schema, options) as unknown as DBClient<Schema>;
}

export class Client<Schema extends SchemaDef> {
    public readonly $db: Kysely<toKysely<Schema>>;

    constructor(schema: Schema, options: ClientOptions) {
        this.$db = new Kysely({
            ...options,
            plugins: [...(options.plugins ?? []), new ParseJSONResultsPlugin()],
        });
        return createClientProxy(this, schema);
    }

    async $disconnect() {
        await this.$db.destroy();
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
