import { loadDocument } from '@zenstackhq/language';
import { isDataSource } from '@zenstackhq/language/ast';
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
        loadResult.errors.forEach((err) => {
            console.error(colors.red(err));
        });
        throw new CliError('Schema contains errors. See above for details.');
    }
    loadResult.warnings.forEach((warn) => {
        console.warn(colors.yellow(warn));
    });
    return loadResult.model;
}

export async function loadSchemaDocumentWithServices(schemaFile: string) {
    const loadResult = await loadDocument(schemaFile);
    if (!loadResult.success) {
        loadResult.errors.forEach((err) => {
            console.error(colors.red(err));
        });
        throw new CliError('Schema contains errors. See above for details.');
    }
    loadResult.warnings.forEach((warn) => {
        console.warn(colors.yellow(warn));
    });
    return { services: loadResult.services, model: loadResult.model };
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
    if (!model.declarations.some(isDataSource)) {
        throw new CliError('Schema must define a datasource');
    }
    const prismaSchema = await new PrismaSchemaGenerator(model).generate();
    if (!folder) {
        folder = path.dirname(zmodelPath);
    }
    const prismaSchemaFile = path.resolve(folder, '~schema.prisma');
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

type FindUpResult<Multiple extends boolean> = Multiple extends true ? string[] | undefined : string | undefined;

function findUp<Multiple extends boolean = false>(
    names: string[],
    cwd: string = process.cwd(),
    multiple: Multiple = false as Multiple,
    result: string[] = [],
): FindUpResult<Multiple> {
    if (!names.some((name) => !!name)) {
        return undefined;
    }
    const target = names.find((name) => fs.existsSync(path.join(cwd, name)));
    if (multiple === false && target) {
        return path.join(cwd, target) as FindUpResult<Multiple>;
    }
    if (target) {
        result.push(path.join(cwd, target));
    }
    const up = path.resolve(cwd, '..');
    if (up === cwd) {
        return (multiple && result.length > 0 ? result : undefined) as FindUpResult<Multiple>;
    }
    return findUp(names, up, multiple, result);
}
