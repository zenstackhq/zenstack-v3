import colors from 'colors';
import { getSchemaFile, loadSchemaDocument } from './action-utils';

type Options = {
    schema?: string;
};

/**
 * CLI action for checking a schema's validity.
 */
export async function run(options: Options) {
    const schemaFile = getSchemaFile(options.schema);

    try {
        await loadSchemaDocument(schemaFile);
        console.log(colors.green('✓ Schema validation completed successfully.'));
    } catch (error) {
        console.error(colors.red('✗ Schema validation failed.'));
        // Re-throw to maintain CLI exit code behavior
        throw error;
    }
}
