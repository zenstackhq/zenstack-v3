import { isDataSource } from '@zenstackhq/language/ast';
import { getOutputPath, getSchemaFile, loadSchemaDocument } from './action-utils';
import { CliError } from '../cli-error';
import { ZModelCodeGenerator } from '@zenstackhq/language';
import { getStringLiteral } from '@zenstackhq/language/utils';
import { SqliteDialect } from '@zenstackhq/orm/dialects/sqlite';
import { PostgresDialect } from '@zenstackhq/orm/dialects/postgres';
import SQLite from 'better-sqlite3';
import { Pool } from 'pg';
import path from 'node:path';
import { ZenStackClient, type ClientContract } from '@zenstackhq/orm';
import { RPCApiHandler } from '@zenstackhq/server/api';
import { ZenStackMiddleware } from '@zenstackhq/server/express';
import express from 'express';
import colors from 'colors';
import { createJiti } from 'jiti';
import { getVersion } from '../utils/version-utils';
import cors from 'cors';

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
            console.log(colors.gray(`Connecting to SQLite database at: ${resolvedUrl}`));
            return new SqliteDialect({
                database: new SQLite(resolvedUrl),
            });
        }
        case 'postgresql':
            console.log(colors.gray(`Connecting to PostgreSQL database at: ${databaseUrl}`));
            return new PostgresDialect({
                pool: new Pool({
                    connectionString: databaseUrl,
                }),
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
            // getSessionUser extracts the current session user from the request, its
            // implementation depends on your auth solution
            getClient: () => client,
        }),
    );

    app.get('/api/schema', (_req, res: express.Response) => {
        res.json({ ...schema, zenstackVersion: getVersion() });
    });

    const server = app.listen(options.port, () => {
        console.log(`ZenStack proxy server is running on port: ${options.port}`);
        console.log(`ZenStack Studio is running at: ${colors.blue('https://studio.zenstack.dev')}`);
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
