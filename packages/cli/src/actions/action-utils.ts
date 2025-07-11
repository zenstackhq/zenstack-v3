import { findUp } from '@zenstackhq/common-helpers';
import { loadDocument } from '@zenstackhq/language';
import { PrismaSchemaGenerator } from '@zenstackhq/sdk';
import colors from 'colors';
import fs from 'node:fs';
import path from 'node:path';
import { CliError } from '../cli-error';

export function getSchemaFile(file?: string) {
    if (file) {
        if (!fs.existsSync(file)) {
            throw new CliError(`Schema file not found: ${file}`);
        }
        return file;
    }

    const pkgJsonConfig = getPkgJsonConfig(process.cwd());
    if (pkgJsonConfig.schema) {
        if (!fs.existsSync(pkgJsonConfig.schema)) {
            throw new CliError(`Schema file not found: ${pkgJsonConfig.schema}`);
        }
        return pkgJsonConfig.schema;
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

export async function generateTempPrismaSchema(zmodelPath: string, folder?: string) {
    const model = await loadSchemaDocument(zmodelPath);
    const prismaSchema = await new PrismaSchemaGenerator(model).generate();
    if (!folder) {
        folder = path.dirname(zmodelPath);
    }
    const prismaSchemaFile = path.resolve(folder, '~schema.prisma');
    console.log('Writing prisma schema to:', prismaSchemaFile);
    fs.writeFileSync(prismaSchemaFile, prismaSchema);
    return prismaSchemaFile;
}

export function getPkgJsonConfig(startPath: string) {
    const result: { schema: string | undefined; output: string | undefined } = { schema: undefined, output: undefined };
    const pkgJsonFile = findUp(['package.json'], startPath, false);

    if (!pkgJsonFile) {
        return result;
    }

    let pkgJson: any = undefined;
    try {
        pkgJson = JSON.parse(fs.readFileSync(pkgJsonFile, 'utf8'));
    } catch {
        return result;
    }

    if (pkgJson.zenstack && typeof pkgJson.zenstack === 'object') {
        result.schema = pkgJson.zenstack.schema && path.resolve(path.dirname(pkgJsonFile), pkgJson.zenstack.schema);
        result.output = pkgJson.zenstack.output && path.resolve(path.dirname(pkgJsonFile), pkgJson.zenstack.output);
    }

    return result;
}
