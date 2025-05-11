import { generateTsSchema } from '@zenstackhq/testtools';
import Sqlite from 'better-sqlite3';
import { Client as PGClient, Pool } from 'pg';
import { ZenStackClient } from '../src/client';
import type { ClientOptions } from '../src/client/options';
import type { SchemaDef } from '../src/schema/schema';

type SqliteSchema = SchemaDef & { provider: { type: 'sqlite' } };
type PostgresSchema = SchemaDef & { provider: { type: 'postgresql' } };

export async function makeSqliteClient<Schema extends SqliteSchema>(
    schema: Schema,
    extraOptions?: Partial<ClientOptions<Schema>>
) {
    return new ZenStackClient(schema, {
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

    return new ZenStackClient(schema, {
        ...extraOptions,
        dialectConfig: {
            pool: new Pool({
                ...pgConfig,
                database: dbName,
            }),
        },
    } as unknown as ClientOptions<Schema>);
}

type CreateTestClientOptions<Schema extends SchemaDef> = ClientOptions<Schema>;

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
            ? ((await generateTsSchema(schema)) as Schema)
            : schema;

    const { plugins, ...rest } = options ?? {};

    let client = new ZenStackClient(_schema, rest as ClientOptions<Schema>);
    await client.$pushSchema();

    if (options?.plugins) {
        for (const plugin of options.plugins) {
            client = client.$use(plugin);
        }
    }

    return client;
}
