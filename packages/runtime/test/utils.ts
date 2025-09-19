import { invariant } from '@zenstackhq/common-helpers';
import { loadDocument } from '@zenstackhq/language';
import type { Model } from '@zenstackhq/language/ast';
import { PrismaSchemaGenerator } from '@zenstackhq/sdk';
import { createTestProject, generateTsSchema, getPluginModules } from '@zenstackhq/testtools';
import SQLite from 'better-sqlite3';
import { PostgresDialect, SqliteDialect, type LogEvent } from 'kysely';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { Client as PGClient, Pool } from 'pg';
import type { ClientContract, ClientOptions } from '../src/client';
import { ZenStackClient } from '../src/client';
import type { SchemaDef } from '../src/schema';

type SqliteSchema = SchemaDef & { provider: { type: 'sqlite' } };
type PostgresSchema = SchemaDef & { provider: { type: 'postgresql' } };

export async function makeSqliteClient<Schema extends SqliteSchema>(
    schema: Schema,
    extraOptions?: Partial<ClientOptions<Schema>>,
): Promise<ClientContract<Schema>> {
    const client = new ZenStackClient(schema, {
        ...extraOptions,
        dialect: new SqliteDialect({ database: new SQLite(':memory:') }),
    } as unknown as ClientOptions<Schema>);
    await client.$pushSchema();
    return client;
}

const TEST_PG_CONFIG = {
    host: process.env['TEST_PG_HOST'] ?? 'localhost',
    port: process.env['TEST_PG_PORT'] ? parseInt(process.env['TEST_PG_PORT']) : 5432,
    user: process.env['TEST_PG_USER'] ?? 'postgres',
    password: process.env['TEST_PG_PASSWORD'] ?? 'postgres',
};

export async function makePostgresClient<Schema extends PostgresSchema>(
    schema: Schema,
    dbName: string,
    extraOptions?: Partial<ClientOptions<Schema>>,
): Promise<ClientContract<Schema>> {
    invariant(dbName, 'dbName is required');
    const pgClient = new PGClient(TEST_PG_CONFIG);
    await pgClient.connect();
    await pgClient.query(`DROP DATABASE IF EXISTS "${dbName}"`);
    await pgClient.query(`CREATE DATABASE "${dbName}"`);

    const client = new ZenStackClient(schema, {
        ...extraOptions,
        dialect: new PostgresDialect({
            pool: new Pool({
                ...TEST_PG_CONFIG,
                database: dbName,
            }),
        }),
    } as unknown as ClientOptions<Schema>);
    await client.$pushSchema();
    return client;
}

export type CreateTestClientOptions<Schema extends SchemaDef> = Omit<ClientOptions<Schema>, 'dialect'> & {
    provider?: 'sqlite' | 'postgresql';
    dbName?: string;
    usePrismaPush?: boolean;
    extraSourceFiles?: Record<string, string>;
    workDir?: string;
};

export async function createTestClient<Schema extends SchemaDef>(
    schema: Schema,
    options?: CreateTestClientOptions<Schema>,
    schemaFile?: string,
): Promise<ClientContract<Schema>>;
export async function createTestClient<Schema extends SchemaDef>(
    schema: string,
    options?: CreateTestClientOptions<Schema>,
): Promise<any>;
export async function createTestClient<Schema extends SchemaDef>(
    schema: Schema | string,
    options?: CreateTestClientOptions<Schema>,
    schemaFile?: string,
): Promise<any> {
    let workDir = options?.workDir;
    let _schema: Schema;
    const provider = options?.provider ?? 'sqlite';

    let dbName = options?.dbName;
    if (!dbName) {
        if (provider === 'sqlite') {
            dbName = './test.db';
        } else {
            throw new Error(`dbName is required for ${provider} provider`);
        }
    }

    const dbUrl =
        provider === 'sqlite'
            ? `file:${dbName}`
            : `postgres://${TEST_PG_CONFIG.user}:${TEST_PG_CONFIG.password}@${TEST_PG_CONFIG.host}:${TEST_PG_CONFIG.port}/${dbName}`;

    let model: Model | undefined;

    if (typeof schema === 'string') {
        const generated = await generateTsSchema(schema, provider, dbUrl, options?.extraSourceFiles);
        workDir = generated.workDir;
        model = generated.model;
        // replace schema's provider
        _schema = {
            ...generated.schema,
            provider: {
                type: provider,
            },
        } as Schema;
    } else {
        // replace schema's provider
        _schema = {
            ...schema,
            provider: {
                type: provider,
            },
        };
        workDir ??= createTestProject();
        if (schemaFile) {
            let schemaContent = fs.readFileSync(schemaFile, 'utf-8');
            if (dbUrl) {
                // replace `datasource db { }` section
                schemaContent = schemaContent.replace(
                    /datasource\s+db\s*{[^}]*}/m,
                    `datasource db {
    provider = '${provider}'
    url = '${dbUrl}'
}`,
                );
            }
            fs.writeFileSync(path.join(workDir, 'schema.zmodel'), schemaContent);
        }
    }

    invariant(workDir);
    console.log(`Work directory: ${workDir}`);

    const { plugins, ...rest } = options ?? {};
    const _options: ClientOptions<Schema> = {
        ...rest,
    } as ClientOptions<Schema>;

    if (options?.usePrismaPush) {
        invariant(typeof schema === 'string' || schemaFile, 'a schema file must be provided when using prisma db push');
        if (!model) {
            const r = await loadDocument(path.join(workDir, 'schema.zmodel'), getPluginModules());
            if (!r.success) {
                throw new Error(r.errors.join('\n'));
            }
            model = r.model;
        }
        const prismaSchema = new PrismaSchemaGenerator(model);
        const prismaSchemaText = await prismaSchema.generate();
        fs.writeFileSync(path.resolve(workDir!, 'schema.prisma'), prismaSchemaText);
        execSync('npx prisma db push --schema ./schema.prisma --skip-generate --force-reset', {
            cwd: workDir,
            stdio: 'ignore',
        });
    } else {
        if (provider === 'postgresql') {
            invariant(dbName, 'dbName is required');
            const pgClient = new PGClient(TEST_PG_CONFIG);
            await pgClient.connect();
            await pgClient.query(`DROP DATABASE IF EXISTS "${dbName}"`);
            await pgClient.query(`CREATE DATABASE "${dbName}"`);
            await pgClient.end();
        }
    }

    if (provider === 'postgresql') {
        _options.dialect = new PostgresDialect({
            pool: new Pool({
                ...TEST_PG_CONFIG,
                database: dbName,
            }),
        });
    } else {
        _options.dialect = new SqliteDialect({
            database: new SQLite(path.join(workDir!, dbName)),
        });
    }

    let client = new ZenStackClient(_schema, _options);

    if (!options?.usePrismaPush) {
        await client.$pushSchema();
    }

    if (plugins) {
        for (const plugin of plugins) {
            client = client.$use(plugin);
        }
    }

    return client;
}

export function testLogger(e: LogEvent) {
    console.log(e.query.sql, e.query.parameters);
}
