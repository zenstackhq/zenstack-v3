import { generateTsSchema } from '@zenstackhq/testtools';
import Sqlite from 'better-sqlite3';
import { Client as PGClient, Pool } from 'pg';
import invariant from 'tiny-invariant';
import { ZenStackClient } from '../src/client';
import type { ClientOptions } from '../src/client/options';
import type { SchemaDef } from '../src/schema/schema';

type SqliteSchema = SchemaDef & { provider: { type: 'sqlite' } };
type PostgresSchema = SchemaDef & { provider: { type: 'postgresql' } };

export async function makeSqliteClient<Schema extends SqliteSchema>(
    schema: Schema,
    extraOptions?: Partial<ClientOptions<Schema>>
) {
    const client = new ZenStackClient(schema, {
        ...extraOptions,
        dialectConfig: { database: new Sqlite(':memory:') },
    } as unknown as ClientOptions<Schema>);
    await client.$pushSchema();
    return client;
}

const TEST_PG_CONFIG = {
    host: process.env['TEST_PG_HOST'] ?? 'localhost',
    port: process.env['TEST_PG_PORT']
        ? parseInt(process.env['TEST_PG_PORT'])
        : 5432,
    user: process.env['TEST_PG_USER'] ?? 'postgres',
    password: process.env['TEST_PG_PASSWORD'] ?? 'abc123',
};

export async function makePostgresClient<Schema extends PostgresSchema>(
    schema: Schema,
    dbName: string,
    extraOptions?: Partial<ClientOptions<Schema>>
) {
    invariant(dbName, 'dbName is required');
    const pgClient = new PGClient(TEST_PG_CONFIG);
    await pgClient.connect();
    await pgClient.query(`DROP DATABASE IF EXISTS "${dbName}"`);
    await pgClient.query(`CREATE DATABASE "${dbName}"`);

    const client = new ZenStackClient(schema, {
        ...extraOptions,
        dialectConfig: {
            pool: new Pool({
                ...TEST_PG_CONFIG,
                database: dbName,
            }),
        },
    } as unknown as ClientOptions<Schema>);
    await client.$pushSchema();
    return client;
}

export type CreateTestClientOptions<Schema extends SchemaDef> =
    ClientOptions<Schema> & {
        provider?: 'sqlite' | 'postgresql';
        dbName?: string;
    };

export async function createTestClient<Schema extends SchemaDef>(
    schema: Schema,
    options?: CreateTestClientOptions<Schema>
): Promise<any>;
export async function createTestClient<Schema extends SchemaDef>(
    schema: string,
    options?: CreateTestClientOptions<Schema>
): Promise<any>;
export async function createTestClient<Schema extends SchemaDef>(
    schema: Schema | string,
    options?: CreateTestClientOptions<Schema>
): Promise<any> {
    let _schema =
        typeof schema === 'string'
            ? ((await generateTsSchema(
                  schema,
                  options?.provider,
                  options?.dbName
              )) as Schema)
            : schema;

    const { plugins, ...rest } = options ?? {};

    let client = new ZenStackClient(_schema, rest as ClientOptions<Schema>);

    if (options?.provider === 'postgresql') {
        invariant(options?.dbName, 'dbName is required');
        const pgClient = new PGClient(TEST_PG_CONFIG);
        await pgClient.connect();
        await pgClient.query(`DROP DATABASE IF EXISTS "${options!.dbName}"`);
        await pgClient.query(`CREATE DATABASE "${options!.dbName}"`);
        await pgClient.end();
    }

    await client.$pushSchema();

    if (options?.plugins) {
        for (const plugin of options.plugins) {
            client = client.$use(plugin);
        }
    }

    return client;
}
