import fs from 'node:fs';
import { CliError } from '../cli-error';
import { loadDocument } from '@zenstackhq/language';
import colors from 'colors';

export function getSchemaFile(file?: string) {
    if (file) {
        if (!fs.existsSync(file)) {
            throw new CliError(`Schema file not found: ${file}`);
        }
        return file;
    }

    if (fs.existsSync('./zenstack/schema.zmodel')) {
        return './zenstack/schema.zmodel';
    } else if (fs.existsSync('./schema.zmodel')) {
        return './schema.zmodel';
    } else {
        throw new CliError(
            'Schema file not found in default locations ("./zenstack/schema.zmodel" or "./schema.zmodel").',
        );
    }
}

export async function loadSchemaDocument(schemaFile: string) {
    const loadResult = await loadDocument(schemaFile);
    if (!loadResult.success) {
        console.error(colors.red('Error loading schema:'));
        loadResult.errors.forEach((err) => {
            console.error(colors.red(err));
        });
        throw new CliError('Failed to load schema');
    }
    return loadResult.model;
}

export function handleSubProcessError(err: unknown) {
    if (err instanceof Error && 'status' in err && typeof err.status === 'number') {
        process.exit(err.status);
    } else {
        process.exit(1);
    }
}
