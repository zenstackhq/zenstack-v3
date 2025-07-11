import fs from 'node:fs';
import path from 'node:path';
import { execPackage } from '../utils/exec-utils';
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

/**
 * CLI action for migration-related commands
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
        }
    } finally {
        if (fs.existsSync(prismaSchemaFile)) {
            fs.unlinkSync(prismaSchemaFile);
        }
    }
}

async function runDev(prismaSchemaFile: string, options: DevOptions) {
    try {
        const cmd = [
            'prisma migrate dev',
            ` --schema "${prismaSchemaFile}"`,
            ' --skip-generate',
            options.name ? ` --name ${options.name}` : '',
            options.createOnly ? ' --create-only' : '',
        ].join('');

        await execPackage(cmd);
    } catch (err) {
        handleSubProcessError(err);
    }
}

async function runReset(prismaSchemaFile: string, options: ResetOptions) {
    try {
        const cmd = ['prisma migrate reset', ` --schema "${prismaSchemaFile}"`, options.force ? ' --force' : ''].join(
            '',
        );

        await execPackage(cmd);
    } catch (err) {
        handleSubProcessError(err);
    }
}

async function runDeploy(prismaSchemaFile: string, _options: DeployOptions) {
    try {
        const cmd = ['prisma migrate deploy', ` --schema "${prismaSchemaFile}"`].join('');

        await execPackage(cmd);
    } catch (err) {
        handleSubProcessError(err);
    }
}

async function runStatus(prismaSchemaFile: string, _options: StatusOptions) {
    try {
        await execPackage(`prisma migrate status --schema "${prismaSchemaFile}"`);
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
