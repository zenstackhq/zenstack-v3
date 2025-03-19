import path from 'node:path';
import { execPackage } from '../utils/exec-utils';
import { getSchemaFile } from './action-utils';
import { run as runGenerate } from './generate';

type CommonOptions = {
    schema?: string;
    name?: string;
};

/**
 * CLI action for generating code from schema
 */
export async function run(command: string, options: CommonOptions) {
    const schemaFile = getSchemaFile(options.schema);

    // run generate first
    await runGenerate({
        schema: schemaFile,
        silent: true,
    });

    const prismaSchemaFile = path.join(
        path.dirname(schemaFile),
        'schema.prisma'
    );

    switch (command) {
        case 'dev':
            await runDev(schemaFile, prismaSchemaFile, options);
            break;

        case 'reset':
            await runReset(schemaFile, prismaSchemaFile, options as any);
            break;

        case 'deploy':
            await runDeploy(schemaFile, prismaSchemaFile, options);
            break;

        case 'status':
            await runStatus(schemaFile, prismaSchemaFile, options);
            break;
    }
}

async function runDev(
    _schemaFile: string,
    prismaSchemaFile: string,
    _options: unknown
) {
    try {
        await execPackage(
            `prisma migrate dev --schema "${prismaSchemaFile}" --skip-generate`,
            {
                stdio: 'inherit',
            }
        );
    } catch (err) {
        handleSubProcessError(err);
    }
}

async function runReset(
    _schemaFile: string,
    prismaSchemaFile: string,
    options: { force: boolean }
) {
    try {
        await execPackage(
            `prisma migrate reset --schema "${prismaSchemaFile}"${
                options.force ? ' --force' : ''
            }`,
            {
                stdio: 'inherit',
            }
        );
    } catch (err) {
        handleSubProcessError(err);
    }
}

async function runDeploy(
    _schemaFile: string,
    prismaSchemaFile: string,
    _options: unknown
) {
    try {
        await execPackage(
            `prisma migrate deploy --schema "${prismaSchemaFile}"`,
            {
                stdio: 'inherit',
            }
        );
    } catch (err) {
        handleSubProcessError(err);
    }
}

async function runStatus(
    _schemaFile: string,
    prismaSchemaFile: string,
    _options: unknown
) {
    try {
        await execPackage(
            `prisma migrate status --schema "${prismaSchemaFile}"`,
            {
                stdio: 'inherit',
            }
        );
    } catch (err) {
        handleSubProcessError(err);
    }
}

function handleSubProcessError(err: unknown) {
    if (
        err instanceof Error &&
        'status' in err &&
        typeof err.status === 'number'
    ) {
        process.exit(err.status);
    } else {
        process.exit(1);
    }
}
