import { Model, Enum, DataModel } from '@zenstackhq/language/ast';
import { ZModelCodeGenerator } from '@zenstackhq/sdk';
import fs from 'node:fs';
import path from 'node:path';
import { execPrisma } from '../utils/exec-utils';
import { generateTempPrismaSchema, getSchemaFile, handleSubProcessError, requireDataSourceUrl, loadSchemaDocumentWithServices } from './action-utils';
import { syncEnums, syncRelation, syncTable, type Relation } from './pull';
import { providers } from './pull/provider';
import { getDatasource, getDbName } from './pull/utils';
import { config } from '@dotenvx/dotenvx';

type PushOptions = {
    schema?: string;
    acceptDataLoss?: boolean;
    forceReset?: boolean;
};

export type PullOptions = {
    schema?: string;
    out?: string;
    naming?: 'pascal' | 'camel' | 'snake' | 'kebab' | 'none';
    alwaysMap?: boolean;
    excludeSchemas: string[];
};

/**
 * CLI action for db related commands
 */
export async function run(command: string, options: any) {
    switch (command) {
        case 'push':
            await runPush(options);
            break;
        case 'pull':
            await runPull(options);
            break;
    }
}

async function runPush(options: PushOptions) {
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

async function runPull(options: PullOptions) {
    try {
        const schemaFile = getSchemaFile(options.schema);
        const { model, services } = await loadSchemaDocumentWithServices(schemaFile);
        config();
        const SUPPORTED_PROVIDERS = ['sqlite', 'postgresql'];
        const datasource = getDatasource(model);

        if (!datasource) {
            throw new Error('No datasource found in the schema.');
        }

        if (!SUPPORTED_PROVIDERS.includes(datasource.provider)) {
            throw new Error(`Unsupported datasource provider: ${datasource.provider}`);
        }

        const provider = providers[datasource.provider];

        if (!provider) {
            throw new Error(`No introspection provider found for: ${datasource.provider}`);
        }

        const { enums: allEnums, tables: allTables } = await provider.introspect(datasource.url);
        const enums = allEnums.filter((e) => !options.excludeSchemas.includes(e.schema_name));
        const tables = allTables.filter((t) => !options.excludeSchemas.includes(t.schema));

        const newModel: Model = {
            $type: 'Model',
            $container: undefined,
            $containerProperty: undefined,
            $containerIndex: undefined,
            declarations: [...model.declarations.filter((d) => ['DataSource'].includes(d.$type))],
            imports: [],
        };

        syncEnums({ dbEnums: enums, model: newModel, services, options });

        const resolvedRelations: Relation[] = [];
        for (const table of tables) {
            const relations = syncTable({ table, model: newModel, provider, services, options });
            resolvedRelations.push(...relations);
        }

        for (const relation of resolvedRelations) {
            syncRelation({ model: newModel, relation, services, options });
        }

        const cwd = new URL(`file://${process.cwd()}`).pathname;
        const docs = services.shared.workspace.LangiumDocuments.all
            .filter(({ uri }) => uri.path.toLowerCase().startsWith(cwd.toLowerCase()))
            .toArray();
        const docsSet = new Set(docs.map((d) => d.uri.toString()));
        console.log(docsSet);
        newModel.declarations
            .filter((d) => [DataModel, Enum].includes(d.$type))
            .forEach((_declaration) => {
                const declaration = _declaration as DataModel | Enum;
                const declarations = services.shared.workspace.IndexManager.allElements(declaration.$type, docsSet);
                const originalModel = declarations.find((d) => getDbName(d.node as any) === getDbName(declaration))
                    ?.node as DataModel | Enum | undefined;
                if (!originalModel) {
                    model.declarations.push(declaration);
                    (declaration as any).$container = model;
                    return;
                }

                declaration.fields.forEach((f) => {
                    const originalField = originalModel.fields.find((d) => getDbName(d) === getDbName(f));

                    if (!originalField) {
                        console.log(`Added field ${f.name} to ${originalModel.name}`);
                        (f as any).$container = originalModel;
                        originalModel.fields.push(f as any);
                        return;
                    }
                    //TODO: update field
                });
                originalModel.fields
                    .filter((f) => !declaration.fields.find((d) => getDbName(d) === getDbName(f)))
                    .forEach((f) => {
                        const model = f.$container;
                        const index = model.fields.findIndex((d) => d === f);
                        model.fields.splice(index, 1);
                        console.log(`Delete field ${f.name}`);
                    });
            });

        services.shared.workspace.IndexManager.allElements('DataModel', docsSet)
            .filter(
                (declaration) =>
                    !newModel.declarations.find((d) => getDbName(d) === getDbName(declaration.node as any)),
            )
            .forEach((decl) => {
                const model = decl.node!.$container as Model;
                const index = model.declarations.findIndex((d) => d === decl.node);
                model.declarations.splice(index, 1);
                console.log(`Delete model ${decl.name}`);
            });
        services.shared.workspace.IndexManager.allElements('Enum', docsSet)
            .filter(
                (declaration) =>
                    !newModel.declarations.find((d) => getDbName(d) === getDbName(declaration.node as any)),
            )
            .forEach((decl) => {
                const model = decl.node!.$container as Model;
                const index = model.declarations.findIndex((d) => d === decl.node);
                model.declarations.splice(index, 1);
                console.log(`Delete enum ${decl.name}`);
            });

        if (options.out && !fs.lstatSync(options.out).isFile()) {
            throw new Error(`Output path ${options.out} is not a file`);
        }

        const generator = new ZModelCodeGenerator({
            //TODO: make configurable
            quote: 'double',
        });

        if (options.out) {
            const zmodelSchema = generator.generate(newModel);

            console.log(`Writing to ${options.out}`);

            const outPath = options.out ? path.resolve(options.out) : schemaFile;

            fs.writeFileSync(outPath, zmodelSchema);
        } else {
            docs.forEach(({ uri, parseResult: { value: model } }) => {
                const zmodelSchema = generator.generate(model);
                console.log(`Writing to ${uri.path}`);
                fs.writeFileSync(uri.fsPath, zmodelSchema);
            });
        }
    } catch (error) {
        console.log(error);
        throw error;
    }
}
