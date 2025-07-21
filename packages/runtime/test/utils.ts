import { invariant } from '@zenstackhq/common-helpers';
import { loadDocument } from '@zenstackhq/language';
import { PrismaSchemaGenerator } from '@zenstackhq/sdk';
import { generateTsSchema } from '@zenstackhq/testtools';
import SQLite from 'better-sqlite3';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { Client as PGClient, Pool } from 'pg';
import type { ClientOptions } from '../src/client';
import { ZenStackClient } from '../src/client';
import type { SchemaDef } from '../src/schema';

type SqliteSchema = SchemaDef & { provider: { type: 'sqlite' } };
type PostgresSchema = SchemaDef & { provider: { type: 'postgresql' } };

export async function makeSqliteClient<Schema extends SqliteSchema>(
    schema: Schema,
    extraOptions?: Partial<ClientOptions<Schema>>,
) {
    const client = new ZenStackClient(schema, {
        ...extraOptions,
        dialectConfig: { database: new SQLite(':memory:') },
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

export type CreateTestClientOptions<Schema extends SchemaDef> = Omit<ClientOptions<Schema>, 'dialectConfig'> & {
    provider?: 'sqlite' | 'postgresql';
    dbName?: string;
    usePrismaPush?: boolean;
    extraSourceFiles?: Record<string, string>;
};

export async function createTestClient<Schema extends SchemaDef>(
    schema: Schema,
    options?: CreateTestClientOptions<Schema>,
): Promise<any>;
export async function createTestClient<Schema extends SchemaDef>(
    schema: string,
    options?: CreateTestClientOptions<Schema>,
): Promise<any>;
export async function createTestClient<Schema extends SchemaDef>(
    schema: Schema | string,
    options?: CreateTestClientOptions<Schema>,
): Promise<any> {
    let workDir: string | undefined;
    let _schema: Schema;

    let dbName = options?.dbName;
    const provider = options?.provider ?? 'sqlite';
    if (provider === 'sqlite' && options?.usePrismaPush && !dbName) {
        dbName = 'file:./test.db';
    }

    if (typeof schema === 'string') {
        const generated = await generateTsSchema(schema, provider, dbName, options?.extraSourceFiles);
        workDir = generated.workDir;
        _schema = generated.schema as Schema;
    } else {
        _schema = schema;
        if (options?.extraSourceFiles) {
            throw new Error('`extraSourceFiles` is not supported when schema is a SchemaDef object');
        }
    }

    const { plugins, ...rest } = options ?? {};
    const _options: ClientOptions<Schema> = {
        ...rest,
    } as ClientOptions<Schema>;

    if (options?.usePrismaPush) {
        invariant(typeof schema === 'string', 'schema must be a string');
        invariant(workDir, 'workDir is required');
        const r = await loadDocument(path.resolve(workDir, 'schema.zmodel'));
        if (!r.success) {
            throw new Error(r.errors.join('\n'));
        }
        const prismaSchema = new PrismaSchemaGenerator(r.model);
        const prismaSchemaText = await prismaSchema.generate();
        fs.writeFileSync(path.resolve(workDir, 'schema.prisma'), prismaSchemaText);
        execSync('npx prisma db push --schema ./schema.prisma --skip-generate --force-reset', {
            cwd: workDir!,
            stdio: 'inherit',
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
        _options.dialectConfig = {
            pool: new Pool({
                ...TEST_PG_CONFIG,
                database: dbName,
            }),
        } as unknown as ClientOptions<Schema>['dialectConfig'];
    } else {
        _options.dialectConfig = {
            database: new SQLite(options?.usePrismaPush ? getDbPath(path.join(workDir!, 'schema.prisma')) : ':memory:'),
        } as unknown as ClientOptions<Schema>['dialectConfig'];
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

function getDbPath(prismaSchemaPath: string) {
    const content = fs.readFileSync(prismaSchemaPath, 'utf-8');
    const found = content.match(/^\s*url\s*=(\s|")*([^"]+)(\s|")*$/m);
    if (!found) {
        throw new Error('No url found in prisma schema');
    }
    const dbPath = found[2]!;
    // convert 'file:./dev.db' to './dev.db'
    const r = path.join(path.dirname(prismaSchemaPath), dbPath.replace(/^file:/, ''));
    return r;
}
