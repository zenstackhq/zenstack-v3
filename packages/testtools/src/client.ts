import { invariant } from '@zenstackhq/common-helpers';
import type { Model } from '@zenstackhq/language/ast';
import { PolicyPlugin } from '@zenstackhq/plugin-policy';
import { ZenStackClient, type ClientContract, type ClientOptions } from '@zenstackhq/orm';
import type { SchemaDef } from '@zenstackhq/orm/schema';
import { PrismaSchemaGenerator } from '@zenstackhq/sdk';
import SQLite from 'better-sqlite3';
import { PostgresDialect, SqliteDialect, type LogEvent } from 'kysely';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Client as PGClient, Pool } from 'pg';
import { expect } from 'vitest';
import { createTestProject } from './project';
import { generateTsSchema } from './schema';
import { loadDocumentWithPlugins } from './utils';

export function getTestDbProvider() {
    const val = process.env['TEST_DB_PROVIDER'] ?? 'sqlite';
    if (!['sqlite', 'postgresql'].includes(val!)) {
        throw new Error(`Invalid TEST_DB_PROVIDER value: ${val}`);
    }
    return val as 'sqlite' | 'postgresql';
}

const TEST_PG_CONFIG = {
    host: process.env['TEST_PG_HOST'] ?? 'localhost',
    port: process.env['TEST_PG_PORT'] ? parseInt(process.env['TEST_PG_PORT']) : 5432,
    user: process.env['TEST_PG_USER'] ?? 'postgres',
    password: process.env['TEST_PG_PASSWORD'] ?? 'postgres',
};

export type CreateTestClientOptions<Schema extends SchemaDef> = Omit<ClientOptions<Schema>, 'dialect'> & {
    provider?: 'sqlite' | 'postgresql';
    dbName?: string;
    usePrismaPush?: boolean;
    extraSourceFiles?: Record<string, string>;
    workDir?: string;
    debug?: boolean;
    dbFile?: string;
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
    const provider = options?.provider ?? getTestDbProvider() ?? 'sqlite';
    const dbName = options?.dbName ?? getTestDbName(provider);

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
    if (options?.debug) {
        console.log(`Work directory: ${workDir}`);
    }

    // copy db file to workDir if specified
    if (options?.dbFile) {
        if (provider !== 'sqlite') {
            throw new Error('dbFile option is only supported for sqlite provider');
        }
        fs.copyFileSync(options.dbFile, path.join(workDir, dbName));
    }

    const { plugins, ...rest } = options ?? {};
    const _options: ClientOptions<Schema> = {
        ...rest,
    } as ClientOptions<Schema>;

    if (!options?.dbFile) {
        if (options?.usePrismaPush) {
            invariant(
                typeof schema === 'string' || schemaFile,
                'a schema file must be provided when using prisma db push',
            );
            if (!model) {
                const r = await loadDocumentWithPlugins(path.join(workDir, 'schema.zmodel'));
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

    if (!options?.usePrismaPush && !options?.dbFile) {
        await client.$pushSchema();
    }

    if (plugins) {
        for (const plugin of plugins) {
            client = client.$use(plugin);
        }
    }

    return client;
}

export async function createPolicyTestClient<Schema extends SchemaDef>(
    schema: Schema,
    options?: CreateTestClientOptions<Schema>,
): Promise<ClientContract<Schema>>;
export async function createPolicyTestClient<Schema extends SchemaDef>(
    schema: string,
    options?: CreateTestClientOptions<Schema>,
): Promise<any>;
export async function createPolicyTestClient<Schema extends SchemaDef>(
    schema: Schema | string,
    options?: CreateTestClientOptions<Schema>,
): Promise<any> {
    return createTestClient(
        schema as any,
        {
            ...options,
            plugins: [...(options?.plugins ?? []), new PolicyPlugin()],
        } as any,
    );
}

export function testLogger(e: LogEvent) {
    console.log(e.query.sql, e.query.parameters);
}

function getTestDbName(provider: string) {
    if (provider === 'sqlite') {
        return './test.db';
    }
    const testName = expect.getState().currentTestName ?? 'unnamed';
    const testPath = expect.getState().testPath ?? '';
    // digest test name
    const digest = createHash('md5')
        .update(testName + testPath)
        .digest('hex');
    // compute a database name based on test name
    return (
        'test_' +
        testName
            .toLowerCase()
            .replace(/[^a-z0-9_]/g, '_')
            .replace(/_+/g, '_')
            .substring(0, 30) +
        digest.slice(0, 6)
    );
}
