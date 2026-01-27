import { ZModelCodeGenerator } from '@zenstackhq/language';
import { isDataSource } from '@zenstackhq/language/ast';
import { getStringLiteral } from '@zenstackhq/language/utils';
import { ZenStackClient, type ClientContract } from '@zenstackhq/orm';
import { MysqlDialect } from '@zenstackhq/orm/dialects/mysql';
import { PostgresDialect } from '@zenstackhq/orm/dialects/postgres';
import { SqliteDialect } from '@zenstackhq/orm/dialects/sqlite';
import { RPCApiHandler } from '@zenstackhq/server/api';
import { ZenStackMiddleware } from '@zenstackhq/server/express';
import SQLite from 'better-sqlite3';
import colors from 'colors';
import cors from 'cors';
import express from 'express';
import { createJiti } from 'jiti';
import { createPool as createMysqlPool } from 'mysql2';
import path from 'node:path';
import { Pool as PgPool } from 'pg';
import { CliError } from '../cli-error';
import { getVersion } from '../utils/version-utils';
import { getOutputPath, getSchemaFile, loadSchemaDocument } from './action-utils';

type Options = {
    output?: string;
    schema?: string;
    port?: number;
    logLevel?: string[];
    databaseUrl?: string;
};

export async function run(options: Options) {
    const schemaFile = getSchemaFile(options.schema);
    console.log(colors.gray(`Loading ZModel schema from: ${schemaFile}`));

    let outputPath = getOutputPath(options, schemaFile);

    // Ensure outputPath is absolute
    if (!path.isAbsolute(outputPath)) {
        outputPath = path.resolve(process.cwd(), outputPath);
    }

    const model = await loadSchemaDocument(schemaFile);

    const dataSource = model.declarations.find(isDataSource);

    let databaseUrl = options.databaseUrl;

    if (!databaseUrl) {
        const schemaUrl = dataSource?.fields.find((f) => f.name === 'url')?.value;

        if (!schemaUrl) {
            throw new CliError(
                `The schema's "datasource" does not have a "url" field, please provide it with -d option.`,
            );
        }
        const zModelGenerator = new ZModelCodeGenerator();
        const url = zModelGenerator.generate(schemaUrl);

        databaseUrl = evaluateUrl(url);
    }

    const provider = getStringLiteral(dataSource?.fields.find((f) => f.name === 'provider')?.value)!;

    const dialect = createDialect(provider, databaseUrl!, outputPath);

    const jiti = createJiti(import.meta.url);

    const schemaModule = (await jiti.import(path.join(outputPath, 'schema'))) as any;

    const allowedLogLevels = ['error', 'query'] as const;
    const log = options.logLevel?.filter((level): level is (typeof allowedLogLevels)[number] =>
        allowedLogLevels.includes(level as any),
    );

    const db = new ZenStackClient(schemaModule.schema, {
        dialect: dialect,
        log: log && log.length > 0 ? log : undefined,
    });

    // check whether the database is reachable
    try {
        await db.$connect();
    } catch (err) {
        throw new CliError(`Failed to connect to the database: ${err instanceof Error ? err.message : String(err)}`);
    }

    startServer(db, schemaModule.schema, options);
}

function evaluateUrl(value: string): string {
    // Create env helper function
    const env = (varName: string) => {
        const envValue = process.env[varName];
        if (!envValue) {
            throw new CliError(`Environment variable ${varName} is not set`);
        }
        return envValue;
    };

    try {
        // Use Function constructor to evaluate the url value
        const urlFn = new Function('env', `return ${value}`);
        const url = urlFn(env);
        return url;
    } catch (err) {
        if (err instanceof CliError) {
            throw err;
        }
        throw new CliError('Could not evaluate datasource url from schema, you could provide it via -d option.');
    }
}

function redactDatabaseUrl(url: string): string {
    try {
        const parsedUrl = new URL(url);
        if (parsedUrl.password) {
            parsedUrl.password = '***';
        }
        if (parsedUrl.username) {
            parsedUrl.username = '***';
        }
        return parsedUrl.toString();
    } catch {
        // If URL parsing fails, return the original (might be a file path for SQLite)
        return url;
    }
}

function createDialect(provider: string, databaseUrl: string, outputPath: string) {
    switch (provider) {
        case 'sqlite': {
            let resolvedUrl = databaseUrl.trim();
            if (resolvedUrl.startsWith('file:')) {
                const filePath = resolvedUrl.substring('file:'.length);
                if (!path.isAbsolute(filePath)) {
                    resolvedUrl = path.join(outputPath, filePath);
                }
            }
            console.log(colors.gray(`Connecting to SQLite database at: ${redactDatabaseUrl(resolvedUrl)}`));
            return new SqliteDialect({
                database: new SQLite(resolvedUrl),
            });
        }
        case 'postgresql':
            console.log(colors.gray(`Connecting to PostgreSQL database at: ${redactDatabaseUrl(databaseUrl)}`));
            return new PostgresDialect({
                pool: new PgPool({
                    connectionString: databaseUrl,
                }),
            });

        case 'mysql':
            console.log(colors.gray(`Connecting to MySQL database at: ${redactDatabaseUrl(databaseUrl)}`));
            return new MysqlDialect({
                pool: createMysqlPool(databaseUrl),
            });

        default:
            throw new CliError(`Unsupported database provider: ${provider}`);
    }
}

function startServer(client: ClientContract<any, any>, schema: any, options: Options) {
    const app = express();
    app.use(cors());
    app.use(express.json({ limit: '5mb' }));
    app.use(express.urlencoded({ extended: true, limit: '5mb' }));

    app.use(
        '/api/model',
        ZenStackMiddleware({
            apiHandler: new RPCApiHandler({ schema }),
            getClient: () => client,
        }),
    );

    app.get('/api/schema', (_req, res: express.Response) => {
        res.json({ ...schema, zenstackVersion: getVersion() });
    });

    const server = app.listen(options.port, () => {
        console.log(`ZenStack proxy server is running on port: ${options.port}`);
        console.log(`You can visit ZenStack Studio at: ${colors.blue('https://studio.zenstack.dev')}`);
    });

    // Graceful shutdown
    process.on('SIGTERM', async () => {
        server.close(() => {
            console.log('\nZenStack proxy server closed');
        });

        await client.$disconnect();
        process.exit(0);
    });

    process.on('SIGINT', async () => {
        server.close(() => {
            console.log('\nZenStack proxy server closed');
        });
        await client.$disconnect();
        process.exit(0);
    });
}
