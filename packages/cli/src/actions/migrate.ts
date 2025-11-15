import fs from 'node:fs';
import path from 'node:path';
import { CliError } from '../cli-error';
import { execPrisma } from '../utils/exec-utils';
import { generateTempPrismaSchema, getSchemaFile } from './action-utils';

type CommonOptions = {
    schema?: string;
    migrations?: string;
};

type DevOptions = CommonOptions & {
    name?: string;
    createOnly?: boolean;
};

type ResetOptions = CommonOptions & {
    force?: boolean;
};

type DeployOptions = CommonOptions;

type StatusOptions = CommonOptions;

type ResolveOptions = CommonOptions & {
    applied?: string;
    rolledBack?: string;
};

/**
 * Run a migration-related CLI command using a temporary Prisma schema and ensure the temporary schema file is removed.
 *
 * @param command - The migration command to run: 'dev', 'reset', 'deploy', 'status', or 'resolve'
 * @param options - Common options that may include `schema` (path to a Prisma schema) and `migrations` (path to the migrations directory); additional command-specific options are accepted for certain commands
 */
export async function run(command: string, options: CommonOptions) {
    const schemaFile = getSchemaFile(options.schema);
    const prismaSchemaDir = options.migrations ? path.dirname(options.migrations) : undefined;
    const prismaSchemaFile = await generateTempPrismaSchema(schemaFile, prismaSchemaDir);

    try {
        switch (command) {
            case 'dev':
                await runDev(prismaSchemaFile, options as DevOptions);
                break;

            case 'reset':
                await runReset(prismaSchemaFile, options as ResetOptions);
                break;

            case 'deploy':
                await runDeploy(prismaSchemaFile, options as DeployOptions);
                break;

            case 'status':
                await runStatus(prismaSchemaFile, options as StatusOptions);
                break;

            case 'resolve':
                await runResolve(prismaSchemaFile, options as ResolveOptions);
                break;
        }
    } finally {
        if (fs.existsSync(prismaSchemaFile)) {
            fs.unlinkSync(prismaSchemaFile);
        }
    }
}

/**
 * Run Prisma Migrate in development mode using the given schema and options.
 *
 * Invokes the CLI command equivalent to `migrate dev` with `--schema` and `--skip-generate`, and adds `--name` and/or `--create-only` when provided in `options`.
 *
 * @param prismaSchemaFile - Path to the Prisma schema file to use for the migrate command.
 * @param options - Options controlling migrate behavior (may include `name` and `createOnly`).
 */
function runDev(prismaSchemaFile: string, options: DevOptions) {
    try {
        const cmd = [
            'migrate dev',
            ` --schema "${prismaSchemaFile}"`,
            ' --skip-generate',
            options.name ? ` --name "${options.name}"` : '',
            options.createOnly ? ' --create-only' : '',
        ].join('');
        execPrisma(cmd);
    } catch (err) {
        handleSubProcessError(err);
    }
}

/**
 * Runs `prisma migrate reset` against the provided Prisma schema file.
 *
 * @param prismaSchemaFile - Path to the Prisma schema file to target
 * @param options - Reset options; if `options.force` is `true`, the reset proceeds without interactive confirmation
 */
function runReset(prismaSchemaFile: string, options: ResetOptions) {
    try {
        const cmd = [
            'migrate reset',
            ` --schema "${prismaSchemaFile}"`,
            ' --skip-generate',
            options.force ? ' --force' : '',
        ].join('');
        execPrisma(cmd);
    } catch (err) {
        handleSubProcessError(err);
    }
}

/**
 * Executes a Prisma Migrate deploy using the specified Prisma schema file.
 *
 * @param prismaSchemaFile - Path to the Prisma schema file to use for the deploy command
 */
function runDeploy(prismaSchemaFile: string, _options: DeployOptions) {
    try {
        const cmd = ['migrate deploy', ` --schema "${prismaSchemaFile}"`].join('');
        execPrisma(cmd);
    } catch (err) {
        handleSubProcessError(err);
    }
}

/**
 * Show the current status of database migrations for the given Prisma schema.
 *
 * Runs the `migrate status` command against the provided schema file. Subprocess failures are handled by the module's subprocess error handler.
 *
 * @param prismaSchemaFile - Path to the Prisma schema file to use for the status check
 */
function runStatus(prismaSchemaFile: string, _options: StatusOptions) {
    try {
        execPrisma(`migrate status --schema "${prismaSchemaFile}"`);
    } catch (err) {
        handleSubProcessError(err);
    }
}

/**
 * Resolve migration status for specified migration names against a Prisma schema.
 *
 * @param prismaSchemaFile - Path to the Prisma schema file to use for the migrate command
 * @param options - Resolve options; include `applied` to mark a migration as applied and/or `rolledBack` to mark a migration as rolled back
 * @throws CliError - If neither `applied` nor `rolledBack` is provided on `options`
 */
function runResolve(prismaSchemaFile: string, options: ResolveOptions) {
    if (!options.applied && !options.rolledBack) {
        throw new CliError('Either --applied or --rolled-back option must be provided');
    }

    try {
        const cmd = [
            'migrate resolve',
            ` --schema "${prismaSchemaFile}"`,
            options.applied ? ` --applied "${options.applied}"` : '',
            options.rolledBack ? ` --rolled-back "${options.rolledBack}"` : '',
        ].join('');
        execPrisma(cmd);
    } catch (err) {
        handleSubProcessError(err);
    }
}

function handleSubProcessError(err: unknown) {
    if (err instanceof Error && 'status' in err && typeof err.status === 'number') {
        process.exit(err.status);
    } else {
        process.exit(1);
    }
}