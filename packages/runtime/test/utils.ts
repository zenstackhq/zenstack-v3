import { loadDocument } from '@zenstackhq/language';
import { PrismaSchemaGenerator } from '@zenstackhq/sdk';
import { generateTsSchema } from '@zenstackhq/testtools';
import Sqlite from 'better-sqlite3';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { Client as PGClient, Pool } from 'pg';
import invariant from 'tiny-invariant';
import type { ClientOptions } from '../src/client';
import { ZenStackClient } from '../src/client';
import type { SchemaDef } from '../src/schema';

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
    password: process.env['TEST_PG_PASSWORD'] ?? 'postgres',
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
        usePrismaPush?: boolean;
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
    let workDir: string | undefined;
    let _schema: Schema;

    if (typeof schema === 'string') {
        const generated = await generateTsSchema(
            schema,
            options?.provider,
            options?.dbName
        );
        workDir = generated.workDir;
        _schema = generated.schema as Schema;
    } else {
        _schema = schema;
    }

    if (options?.usePrismaPush) {
        invariant(typeof schema === 'string', 'schema must be a string');
        invariant(workDir, 'workDir is required');
        const r = await loadDocument(path.resolve(workDir, 'schema.zmodel'));
        if (!r.success) {
            throw new Error(r.errors.join('\n'));
        }
        const prismaSchema = new PrismaSchemaGenerator(r.model);
        const prismaSchemaText = await prismaSchema.generate();
        fs.writeFileSync(
            path.resolve(workDir, 'schema.prisma'),
            prismaSchemaText
        );
        execSync(
            'npx prisma db push --schema ./schema.prisma --skip-generate --force-reset',
            {
                cwd: workDir!,
                stdio: 'inherit',
            }
        );
    } else {
        if (options?.provider === 'postgresql') {
            invariant(options?.dbName, 'dbName is required');
            const pgClient = new PGClient(TEST_PG_CONFIG);
            await pgClient.connect();
            await pgClient.query(
                `DROP DATABASE IF EXISTS "${options!.dbName}"`
            );
            await pgClient.query(`CREATE DATABASE "${options!.dbName}"`);
            await pgClient.end();
        }
    }

    const { plugins, usePrismaPush, ...rest } = options ?? {};

    let client = new ZenStackClient(_schema, rest as ClientOptions<Schema>);

    if (!usePrismaPush) {
        await client.$pushSchema();
    }

    if (options?.plugins) {
        for (const plugin of options.plugins) {
            client = client.$use(plugin);
        }
    }

    return client;
}
