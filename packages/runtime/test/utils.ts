import Sqlite from 'better-sqlite3';
import { Client, Pool } from 'pg';
import { makeClient } from '../src/client';
import type { DBClient } from '../src/client/types';
import type { SchemaDef } from '../src/schema/schema';

type SqliteSchema = SchemaDef & { provider: 'sqlite' };
type PostgresSchema = SchemaDef & { provider: 'postgresql' };

export async function makeSqliteClient<Schema extends SqliteSchema>(
    schema: Schema
) {
    return makeClient<SqliteSchema>(schema, {
        dialectConfig: { database: new Sqlite(':memory:') },
    }) as unknown as DBClient<Schema>;
}

export async function makePostgresClient<Schema extends PostgresSchema>(
    schema: Schema,
    dbName: string
) {
    const pgConfig = {
        host: 'localhost',
        port: 5432,
        user: 'postgres',
        password: 'abc123',
    };

    const pgClient = new Client(pgConfig);
    await pgClient.connect();
    console.log('Dropping database:', dbName);
    await pgClient.query(`DROP DATABASE IF EXISTS "${dbName}"`);
    console.log('Creating database:', dbName);
    await pgClient.query(`CREATE DATABASE "${dbName}"`);

    const client = makeClient<PostgresSchema>(schema, {
        dialectConfig: {
            pool: new Pool({
                ...pgConfig,
                database: dbName,
            }),
        },
    });

    return client as unknown as DBClient<Schema>;
}
