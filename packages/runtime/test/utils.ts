import Sqlite from 'better-sqlite3';
import { Client as PGClient, Pool } from 'pg';
import { createClient } from '../src/client';
import type { ClientOptions } from '../src/client/options';
import type { SchemaDef } from '../src/schema/schema';

type SqliteSchema = SchemaDef & { provider: { type: 'sqlite' } };
type PostgresSchema = SchemaDef & { provider: { type: 'postgresql' } };

export async function makeSqliteClient<Schema extends SqliteSchema>(
    schema: Schema,
    extraOptions?: Partial<ClientOptions<Schema>>
) {
    return createClient(schema, {
        ...extraOptions,
        dialectConfig: { database: new Sqlite(':memory:') },
    } as unknown as ClientOptions<Schema>);
}

export async function makePostgresClient<Schema extends PostgresSchema>(
    schema: Schema,
    dbName: string,
    extraOptions?: Partial<ClientOptions<Schema>>
) {
    const pgConfig = {
        host: 'localhost',
        port: 5432,
        user: 'postgres',
        password: 'abc123',
    };

    const pgClient = new PGClient(pgConfig);
    await pgClient.connect();
    await pgClient.query(`DROP DATABASE IF EXISTS "${dbName}"`);
    await pgClient.query(`CREATE DATABASE "${dbName}"`);

    return createClient(schema, {
        ...extraOptions,
        dialectConfig: {
            pool: new Pool({
                ...pgConfig,
                database: dbName,
            }),
        },
    } as unknown as ClientOptions<Schema>);
}
