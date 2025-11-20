import fs from 'node:fs';
import { execPrisma } from '../utils/exec-utils';
import { generateTempPrismaSchema, getSchemaFile, handleSubProcessError, requireDataSourceUrl } from './action-utils';

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
    const schemaFile = getSchemaFile(options.schema);

    // validate datasource url exists
    await requireDataSourceUrl(schemaFile);

    // generate a temp prisma schema file
    const prismaSchemaFile = await generateTempPrismaSchema(schemaFile);

    try {
        // run prisma db push
        const cmd = [
            'db push',
            ` --schema "${prismaSchemaFile}"`,
            options.acceptDataLoss ? ' --accept-data-loss' : '',
            options.forceReset ? ' --force-reset' : '',
            ' --skip-generate',
        ].join('');

        try {
            execPrisma(cmd);
        } catch (err) {
            handleSubProcessError(err);
        }
    } finally {
        if (fs.existsSync(prismaSchemaFile)) {
            fs.unlinkSync(prismaSchemaFile);
        }
    }
}
