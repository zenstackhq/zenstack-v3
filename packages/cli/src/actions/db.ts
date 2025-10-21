import { Model, Enum, DataModel, DataField } from '@zenstackhq/language/ast';
import { ZModelCodeGenerator } from '@zenstackhq/sdk';
import fs from 'node:fs';
import path from 'node:path';
import { execPrisma } from '../utils/exec-utils';
import { generateTempPrismaSchema, getSchemaFile, handleSubProcessError, requireDataSourceUrl, loadSchemaDocumentWithServices } from './action-utils';
import { syncEnums, syncRelation, syncTable, type Relation } from './pull';
import { providers } from './pull/provider';
import { getDatasource, getDbName, getRelationFkName } from './pull/utils';
import { config } from '@dotenvx/dotenvx';

type PushOptions = {
    schema?: string;
    acceptDataLoss?: boolean;
    forceReset?: boolean;
};

export type PullOptions = {
    schema?: string;
    excludeSchemas?: string[];
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
        const enums = allEnums.filter((e) => !options.excludeSchemas?.includes(e.schema_name));
        const tables = allTables.filter((t) => !options.excludeSchemas?.includes(t.schema));

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
            const simmilarRelations = resolvedRelations.filter((rr) => {
                return (
                    (rr.schema === relation.schema &&
                        rr.table === relation.table &&
                        rr.references.schema === relation.references.schema &&
                        rr.references.table === relation.references.table) ||
                    (rr.schema === relation.references.schema &&
                        rr.column === relation.references.column &&
                        rr.references.schema === relation.schema &&
                        rr.references.table === relation.table)
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

        const cwd = new URL(`file://${process.cwd()}`).pathname;
        const docs = services.shared.workspace.LangiumDocuments.all
            .filter(({ uri }) => uri.path.toLowerCase().startsWith(cwd.toLowerCase()))
            .toArray();
        const docsSet = new Set(docs.map((d) => d.uri.toString()));

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

        newModel.declarations
            .filter((d) => [DataModel, Enum].includes(d.$type))
            .forEach((_declaration) => {
                const declaration = _declaration as DataModel | Enum;
                const declarations = services.shared.workspace.IndexManager.allElements(
                    declaration.$type,
                    docsSet,
                ).toArray();
                const originalModel = declarations.find((d) => getDbName(d.node as any) === getDbName(declaration))
                    ?.node as DataModel | Enum | undefined;
                if (!originalModel) {
                    model.declarations.push(declaration);
                    (declaration as any).$container = model;
                    declaration.fields.forEach((f) => {
                        if (f.$type === 'DataField' && f.type.reference?.ref) {
                            const ref = declarations.find(
                                (d) => getDbName(d.node as any) === getDbName(f.type.reference!.ref as any),
                            )?.node;
                            if (ref) (f.type.reference.ref as any) = ref;
                        }
                    });
                    return;
                }

                declaration.fields.forEach((f) => {
                    const originalField = originalModel.fields.find(
                        (d) =>
                            getDbName(d) === getDbName(f) ||
                            (getRelationFkName(d as any) === getRelationFkName(f as any) &&
                                !!getRelationFkName(d as any) &&
                                !!getRelationFkName(f as any)),
                    );

                    if (!originalField) {
                        //console.log(`Added field ${f.name} to ${originalModel.name}`);
                        (f as any).$container = originalModel;
                        originalModel.fields.push(f as any);
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

                    if (originalField.$type === 'DataField') {
                        const field = f as DataField;
                        originalField.type = field.type;
                        if (field.type.reference) {
                            const ref = declarations.find(
                                (d) => getDbName(d.node as any) === getDbName(field.type.reference!.ref as any),
                            )?.node as DataModel | undefined;
                            if (ref) {
                                (field.type.reference.$refText as any) = ref.name;
                                (field.type.reference.ref as any) = ref;
                            }
                        }

                        (originalField.type.$container as any) = originalField;
                    }

                    f.attributes.forEach((attr) => {
                        const originalAttribute = originalField.attributes.find(
                            (d) => d.decl.$refText === attr.decl.$refText,
                        );

                        if (!originalAttribute) {
                            //console.log(`Added Attribute ${attr.decl.$refText} to ${f.name}`);
                            (f as any).$container = originalField;
                            originalField.attributes.push(attr as any);
                            return;
                        }

                        originalAttribute.args = attr.args;
                        attr.args.forEach((a) => {
                            (a.$container as any) = originalAttribute;
                        });
                    });

                    originalField.attributes
                        .filter((attr) => !f.attributes.find((d) => d.decl.$refText === attr.decl.$refText))
                        .forEach((attr) => {
                            const field = attr.$container;
                            const index = field.attributes.findIndex((d) => d === attr);
                            field.attributes.splice(index, 1);
                            //console.log(`Delete attribute from field:${field.name} ${attr.decl.$refText}`);
                        });
                });
                originalModel.fields
                    .filter(
                        (f) =>
                            !declaration.fields.find(
                                (d) =>
                                    getDbName(d) === getDbName(f) ||
                                    (getRelationFkName(d as any) === getRelationFkName(f as any) &&
                                        !!getRelationFkName(d as any) &&
                                        !!getRelationFkName(f as any)),
                            ),
                    )
                    .forEach((f) => {
                        const model = f.$container;
                        const index = model.fields.findIndex((d) => d === f);
                        model.fields.splice(index, 1);
                        //console.log(`Delete field ${f.name}`);
                    });
            });

        if (options.out && !fs.lstatSync(options.out).isFile()) {
            throw new Error(`Output path ${options.out} is not a file`);
        }

        const generator = new ZModelCodeGenerator({
            quote: options.quote,
            indent: options.indent,
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
