import { createZModelServices, loadDocument, type ZModelServices } from '@zenstackhq/language';
import { isDataSource, isPlugin, Model } from '@zenstackhq/language/ast';
import { getLiteral } from '@zenstackhq/language/utils';
import { PrismaSchemaGenerator } from '@zenstackhq/sdk';
import colors from 'colors';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CliError } from '../cli-error';
import { PLUGIN_MODULE_NAME } from '../constants';

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
    const { ZModelLanguage: services } = createZModelServices();
    const pluginDocs = await getPluginDocuments(services, schemaFile);
    const loadResult = await loadDocument(schemaFile, pluginDocs);
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

export async function getPluginDocuments(services: ZModelServices, fileName: string): Promise<string[]> {
    // parse the user document (without validation)
    const parseResult = services.parser.LangiumParser.parse(fs.readFileSync(fileName, { encoding: 'utf-8' }));
    const parsed = parseResult.value as Model;

    // balk if there are syntax errors
    if (parseResult.lexerErrors.length > 0 || parseResult.parserErrors.length > 0) {
        return [];
    }

    // traverse plugins and collect "plugin.zmodel" documents
    const result: string[] = [];
    for (const decl of parsed.declarations.filter(isPlugin)) {
        const providerField = decl.fields.find((f) => f.name === 'provider');
        if (!providerField) {
            continue;
        }

        const provider = getLiteral<string>(providerField.value);
        if (!provider) {
            continue;
        }

        let pluginModelFile: string | undefined;

        // first try to treat provider as a path
        let providerPath = path.resolve(path.dirname(fileName), provider);
        if (fs.existsSync(providerPath)) {
            if (fs.statSync(providerPath).isDirectory()) {
                providerPath = path.join(providerPath, 'index.js');
            }

            // try plugin.zmodel next to the provider file
            pluginModelFile = path.resolve(path.dirname(providerPath), PLUGIN_MODULE_NAME);
            if (!fs.existsSync(pluginModelFile)) {
                // try to find upwards
                pluginModelFile = findUp([PLUGIN_MODULE_NAME], path.dirname(providerPath));
            }
        }

        if (!pluginModelFile) {
            // try loading it as a ESM module
            try {
                const resolvedUrl = import.meta.resolve(`${provider}/${PLUGIN_MODULE_NAME}`);
                pluginModelFile = fileURLToPath(resolvedUrl);
            } catch {
                // noop
            }
        }

        if (pluginModelFile && fs.existsSync(pluginModelFile)) {
            result.push(pluginModelFile);
        }
    }
    return result;
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
