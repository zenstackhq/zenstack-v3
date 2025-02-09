import Sqlite from 'better-sqlite3';
import { PostgresDialect, SqliteDialect } from 'kysely';
import { Client, Pool } from 'pg';
import { makeClient } from '../src/client';
import type { SchemaDef } from '../src/schema/schema';

export async function makeSqliteClient<Schema extends SchemaDef>(
    schema: Schema
) {
    return makeClient(schema, {
        dialect: new SqliteDialect({
            database: new Sqlite(':memory:'),
        }),
    });
}

export async function makePostgresClient<Schema extends SchemaDef>(
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

    const client = makeClient(schema, {
        dialect: new PostgresDialect({
            pool: new Pool({
                ...pgConfig,
                database: dbName,
            }),
        }),
    });

    return client;
}
