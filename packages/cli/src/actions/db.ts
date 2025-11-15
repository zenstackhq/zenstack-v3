import fs from 'node:fs';
import { execPrisma } from '../utils/exec-utils';
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

/**
 * Pushes the Prisma schema to the database using a temporary schema file and removes the temporary file when finished.
 *
 * Generates a temporary Prisma schema from the provided base schema, runs `prisma db push` with optional flags, and ensures the temporary file is deleted regardless of success or failure. Subprocess errors from the Prisma CLI are handled internally.
 *
 * @param options - Configuration for the push:
 *   - `schema`: path to the base Prisma schema to use when generating the temporary schema (optional).
 *   - `acceptDataLoss`: include `--accept-data-loss` when pushing to the database (optional).
 *   - `forceReset`: include `--force-reset` when pushing to the database (optional).
 */
async function runPush(options: Options) {
    // generate a temp prisma schema file
    const schemaFile = getSchemaFile(options.schema);
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