import { formatDocument } from '@zenstackhq/language';
import colors from 'colors';
import fs from 'node:fs';
import { getSchemaFile } from './action-utils';

type Options = {
    schema?: string;
};

/**
 * CLI action for formatting a ZModel schema file.
 */
export async function run(options: Options) {
    const schemaFile = getSchemaFile(options.schema);
    let formattedContent: string;

    try {
        formattedContent = await formatDocument(fs.readFileSync(schemaFile, 'utf-8'));
    } catch (error) {
        console.error(colors.red('✗ Schema formatting failed.'));
        // Re-throw to maintain CLI exit code behavior
        throw error;
    }

    fs.writeFileSync(schemaFile, formattedContent, 'utf-8');
    console.log(colors.green('✓ Schema formatting completed successfully.'));
}
