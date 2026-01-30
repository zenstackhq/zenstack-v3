import { config } from '@dotenvx/dotenvx';
import { formatDocument, ZModelCodeGenerator } from '@zenstackhq/language';
import { DataModel, Enum, type Model } from '@zenstackhq/language/ast';
import colors from 'colors';
import fs from 'node:fs';
import path from 'node:path';
import ora from 'ora';
import { execPrisma } from '../utils/exec-utils';
import {
    generateTempPrismaSchema,
    getSchemaFile,
    handleSubProcessError,
    loadSchemaDocument,
    requireDataSourceUrl,
} from './action-utils';
import { syncEnums, syncRelation, syncTable, type Relation } from './pull';
import { providers } from './pull/provider';
import { getDatasource, getDbName, getRelationFieldsKey, getRelationFkName } from './pull/utils';
import type { DataSourceProviderType } from '@zenstackhq/schema';

type PushOptions = {
    schema?: string;
    acceptDataLoss?: boolean;
    forceReset?: boolean;
};

export type PullOptions = {
    schema?: string;
    out?: string;
    modelCasing: 'pascal' | 'camel' | 'snake' | 'kebab' | 'none';
    fieldCasing: 'pascal' | 'camel' | 'snake' | 'kebab' | 'none';
    alwaysMap: boolean;
    quote: 'single' | 'double';
    indent: number;
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
    const spinner = ora();
    try {
        const schemaFile = getSchemaFile(options.schema);
        const { model, services } = await loadSchemaDocument(schemaFile, { returnServices: true, keepImports: true });
        config({
            ignore: ['MISSING_ENV_FILE'],
        });
        const SUPPORTED_PROVIDERS = Object.keys(providers) as DataSourceProviderType[];
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

        spinner.start('Introspecting database...');
        const { enums: allEnums, tables: allTables } = await provider.introspect(datasource.url);
        spinner.succeed('Database introspected');

        const enums = provider.isSupportedFeature('Schema')
            ? allEnums.filter((e) => datasource.allSchemas.includes(e.schema_name))
            : allEnums;
        const tables = provider.isSupportedFeature('Schema')
            ? allTables.filter((t) => datasource.allSchemas.includes(t.schema))
            : allTables;

        console.log(colors.blue('Syncing schema...'));

        const newModel: Model = {
            $type: 'Model',
            $container: undefined,
            $containerProperty: undefined,
            $containerIndex: undefined,
            declarations: [...model.declarations.filter((d) => ['DataSource'].includes(d.$type))],
            imports: [],
        };
        syncEnums({
            dbEnums: enums,
            model: newModel,
            services,
            options,
            defaultSchema: datasource.defaultSchema,
            oldModel: model,
            provider,
        });

        const resolvedRelations: Relation[] = [];
        for (const table of tables) {
            const relations = syncTable({
                table,
                model: newModel,
                provider,
                services,
                options,
                defaultSchema: datasource.defaultSchema,
                oldModel: model,
            });
            resolvedRelations.push(...relations);
        }
        // sync relation fields
        for (const relation of resolvedRelations) {
            const simmilarRelations = resolvedRelations.filter((rr) => {
                return (
                    rr !== relation &&
                    ((rr.schema === relation.schema &&
                        rr.table === relation.table &&
                        rr.references.schema === relation.references.schema &&
                        rr.references.table === relation.references.table) ||
                        (rr.schema === relation.references.schema &&
                            rr.column === relation.references.column &&
                            rr.references.schema === relation.schema &&
                            rr.references.table === relation.table))
                );
            }).length;
            const selfRelation =
                relation.references.schema === relation.schema && relation.references.table === relation.table;
            syncRelation({
                model: newModel,
                relation,
                services,
                options,
                selfRelation,
                simmilarRelations,
            });
        }

        console.log(colors.blue('Schema synced'));

        const cwd = new URL(`file://${process.cwd()}`).pathname;
        const docs = services.shared.workspace.LangiumDocuments.all
            .filter(({ uri }) => uri.path.toLowerCase().startsWith(cwd.toLowerCase()))
            .toArray();
        const docsSet = new Set(docs.map((d) => d.uri.toString()));

        console.log(colors.bold('\nApplying changes to ZModel...'));

        const deletedModels: string[] = [];
        const deletedEnums: string[] = [];
        const addedFields: string[] = [];
        const deletedAttributes: string[] = [];
        const deletedFields: string[] = [];

        //Delete models
        services.shared.workspace.IndexManager.allElements('DataModel', docsSet)
            .filter(
                (declaration) =>
                    !newModel.declarations.find((d) => getDbName(d) === getDbName(declaration.node as any)),
            )
            .forEach((decl) => {
                const model = decl.node!.$container as Model;
                const index = model.declarations.findIndex((d) => d === decl.node);
                model.declarations.splice(index, 1);
                deletedModels.push(colors.red(`- Model ${decl.name} deleted`));
            });

        // Delete Enums
        if (provider.isSupportedFeature('NativeEnum'))
            services.shared.workspace.IndexManager.allElements('Enum', docsSet)
                .filter(
                    (declaration) =>
                        !newModel.declarations.find((d) => getDbName(d) === getDbName(declaration.node as any)),
                )
                .forEach((decl) => {
                    const model = decl.node!.$container as Model;
                    const index = model.declarations.findIndex((d) => d === decl.node);
                    model.declarations.splice(index, 1);
                    deletedEnums.push(colors.red(`- Enum ${decl.name} deleted`));
                });
        //
        newModel.declarations
            .filter((d) => [DataModel, Enum].includes(d.$type))
            .forEach((_declaration) => {
                const newDataModel = _declaration as DataModel | Enum;
                const declarations = services.shared.workspace.IndexManager.allElements(
                    newDataModel.$type,
                    docsSet,
                ).toArray();
                const originalDataModel = declarations.find((d) => getDbName(d.node as any) === getDbName(newDataModel))
                    ?.node as DataModel | Enum | undefined;
                if (!originalDataModel) {
                    model.declarations.push(newDataModel);
                    (newDataModel as any).$container = model;
                    newDataModel.fields.forEach((f) => {
                        if (f.$type === 'DataField' && f.type.reference?.ref) {
                            const ref = declarations.find(
                                (d) => getDbName(d.node as any) === getDbName(f.type.reference!.ref as any),
                            )?.node;
                            if (ref) (f.type.reference.ref as any) = ref;
                        }
                    });
                    return;
                }

                newDataModel.fields.forEach((f) => {
                    // Prioritized matching: exact db name > relation fields key > relation FK name > type reference
                    let originalFields = originalDataModel.fields.filter((d) => getDbName(d) === getDbName(f));

                    if (originalFields.length === 0) {
                        // Try matching by relation fields key (the `fields` attribute in @relation)
                        // This matches relation fields by their FK field references
                        const newFieldsKey = getRelationFieldsKey(f as any);
                        if (newFieldsKey) {
                            originalFields = originalDataModel.fields.filter(
                                (d) => getRelationFieldsKey(d as any) === newFieldsKey,
                            );
                        }
                    }

                    if (originalFields.length === 0) {
                        // Try matching by relation FK name (the `map` attribute in @relation)
                        originalFields = originalDataModel.fields.filter(
                            (d) =>
                                getRelationFkName(d as any) === getRelationFkName(f as any) &&
                                !!getRelationFkName(d as any) &&
                                !!getRelationFkName(f as any),
                        );
                    }

                    if (originalFields.length === 0) {
                        // Try matching by type reference
                        originalFields = originalDataModel.fields.filter(
                            (d) =>
                                f.$type === 'DataField' &&
                                d.$type === 'DataField' &&
                                f.type.reference?.ref &&
                                d.type.reference?.ref &&
                                getDbName(f.type.reference.ref) === getDbName(d.type.reference.ref),
                        );
                    }

                    if (originalFields.length > 1) {
                        // If this is a back-reference relation field (no `fields` attribute),
                        // silently skip when there are multiple potential matches
                        const isBackReferenceField = !getRelationFieldsKey(f as any);
                        if (!isBackReferenceField) {
                            console.warn(
                                colors.yellow(
                                    `Found more original fields, need to tweak the search algorithm. ${originalDataModel.name}->[${originalFields.map((of) => of.name).join(', ')}](${f.name})`,
                                ),
                            );
                        }
                        return;
                    }
                    const originalField = originalFields.at(0);
                    Object.freeze(originalField);
                    if (!originalField) {
                        addedFields.push(colors.green(`+ Field ${f.name} added to ${originalDataModel.name}`));
                        (f as any).$container = originalDataModel;
                        originalDataModel.fields.push(f as any);
                        if (f.$type === 'DataField' && f.type.reference?.ref) {
                            const ref = declarations.find(
                                (d) => getDbName(d.node as any) === getDbName(f.type.reference!.ref as any),
                            )?.node as DataModel | undefined;
                            if (ref) {
                                (f.type.reference.$refText as any) = ref.name;
                                (f.type.reference.ref as any) = ref;
                            }
                        }
                        return;
                    }

                    originalField.attributes
                        .filter(
                            (attr) =>
                                !f.attributes.find((d) => d.decl.$refText === attr.decl.$refText) &&
                                !['@map', '@@map', '@default', '@updatedAt'].includes(attr.decl.$refText),
                        )
                        .forEach((attr) => {
                            const field = attr.$container;
                            const index = field.attributes.findIndex((d) => d === attr);
                            field.attributes.splice(index, 1);
                            deletedAttributes.push(
                                colors.yellow(`- Attribute ${attr.decl.$refText} deleted from field: ${field.name}`),
                            );
                        });
                });
                originalDataModel.fields
                    .filter((f) => {
                        // Prioritized matching: exact db name > relation fields key > relation FK name > type reference
                        const matchByDbName = newDataModel.fields.find((d) => getDbName(d) === getDbName(f));
                        if (matchByDbName) return false;

                        // Try matching by relation fields key (the `fields` attribute in @relation)
                        const originalFieldsKey = getRelationFieldsKey(f as any);
                        if (originalFieldsKey) {
                            const matchByFieldsKey = newDataModel.fields.find(
                                (d) => getRelationFieldsKey(d as any) === originalFieldsKey,
                            );
                            if (matchByFieldsKey) return false;
                        }

                        const matchByFkName = newDataModel.fields.find(
                            (d) =>
                                getRelationFkName(d as any) === getRelationFkName(f as any) &&
                                !!getRelationFkName(d as any) &&
                                !!getRelationFkName(f as any),
                        );
                        if (matchByFkName) return false;

                        const matchByTypeRef = newDataModel.fields.find(
                            (d) =>
                                f.$type === 'DataField' &&
                                d.$type === 'DataField' &&
                                f.type.reference?.ref &&
                                d.type.reference?.ref &&
                                getDbName(f.type.reference.ref) === getDbName(d.type.reference.ref),
                        );
                        return !matchByTypeRef;
                    })
                    .forEach((f) => {
                        const _model = f.$container;
                        const index = _model.fields.findIndex((d) => d === f);
                        _model.fields.splice(index, 1);
                        deletedFields.push(colors.red(`- Field ${f.name} deleted from ${_model.name}`));
                    });
            });

        if (deletedModels.length > 0) {
            console.log(colors.bold('\nDeleted Models:'));
            deletedModels.forEach((msg) => console.log(msg));
        }

        if (deletedEnums.length > 0) {
            console.log(colors.bold('\nDeleted Enums:'));
            deletedEnums.forEach((msg) => console.log(msg));
        }

        if (addedFields.length > 0) {
            console.log(colors.bold('\nAdded Fields:'));
            addedFields.forEach((msg) => console.log(msg));
        }

        if (deletedAttributes.length > 0) {
            console.log(colors.bold('\nDeleted Attributes:'));
            deletedAttributes.forEach((msg) => console.log(msg));
        }

        if (deletedFields.length > 0) {
            console.log(colors.bold('\nDeleted Fields:'));
            deletedFields.forEach((msg) => console.log(msg));
        }

        if (options.out && !fs.lstatSync(options.out).isFile()) {
            throw new Error(`Output path ${options.out} is not a file`);
        }

        const generator = new ZModelCodeGenerator({
            quote: options.quote,
            indent: options.indent,
        });

        if (options.out) {
            const zmodelSchema = await formatDocument(generator.generate(newModel));

            console.log(colors.blue(`Writing to ${options.out}`));

            const outPath = options.out ? path.resolve(options.out) : schemaFile;

            fs.writeFileSync(outPath, zmodelSchema);
        } else {
            for (const { uri, parseResult: { value: model } } of docs) {
                const zmodelSchema = await formatDocument(generator.generate(model));
                console.log(colors.blue(`Writing to ${uri.path}`));
                fs.writeFileSync(uri.fsPath, zmodelSchema);
            }
        }

        console.log(colors.green.bold('\nPull completed successfully!'));
    } catch (error) {
        spinner.fail('Pull failed');
        console.error(error);
        throw error;
    }
}