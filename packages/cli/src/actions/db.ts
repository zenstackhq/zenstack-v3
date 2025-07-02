import fs from 'node:fs';
import { execPackage } from '../utils/exec-utils';
import { generateTempPrismaSchema, getSchemaFile, handleSubProcessError } from './action-utils';

type Options = {
    schema?: string;
    acceptDataLoss?: boolean;
    forceReset?: boolean;
};

/**
 * CLI action for db related commands
 */
export async function run(command: string, options: Options) {
    switch (command) {
        case 'push':
            await runPush(options);
            break;
    }
}

async function runPush(options: Options) {
    // generate a temp prisma schema file
    const schemaFile = getSchemaFile(options.schema);
    const prismaSchemaFile = await generateTempPrismaSchema(schemaFile);

    try {
        // run prisma db push
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
    } finally {
        if (fs.existsSync(prismaSchemaFile)) {
            fs.unlinkSync(prismaSchemaFile);
        }
    }
}
