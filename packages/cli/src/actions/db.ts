import path from 'node:path';
import { execPackage } from '../utils/exec-utils';
import { getSchemaFile, handleSubProcessError } from './action-utils';
import { run as runGenerate } from './generate';

type CommonOptions = {
    schema?: string;
    name?: string;
};

/**
 * CLI action for db related commands
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
        case 'push':
            await runPush(prismaSchemaFile, options);
            break;
    }
}

async function runPush(prismaSchemaFile: string, options: any) {
    const cmd = `prisma db push --schema "${prismaSchemaFile}"${
        options.acceptDataLoss ? ' --accept-data-loss' : ''
    }${options.forceReset ? ' --force-reset' : ''} --skip-generate`;
    try {
        await execPackage(cmd, {
            stdio: 'inherit',
        });
    } catch (err) {
        handleSubProcessError(err);
    }
}
