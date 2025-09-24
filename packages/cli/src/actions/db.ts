import { ZModelCodeGenerator } from '@zenstackhq/sdk';
import fs from 'node:fs';
import path from 'node:path';
import { execPackage } from '../utils/exec-utils';
import { generateTempPrismaSchema, getSchemaFile, handleSubProcessError, loadSchemaDocumentWithServices } from './action-utils';
import { syncEnums, syncRelation, syncTable, type Relation } from './pull';
import { providers } from './pull/provider';
import { getDatasource, getDbName } from './pull/utils';

type PushOptions = {
    schema?: string;
    acceptDataLoss?: boolean;
    forceReset?: boolean;
};

type PullOptions = {
    schema?: string;
    out?: string;
};

/**
 * CLI action for db related commands
 */
export async function run(command: string, options: PushOptions) {
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
    // generate a temp prisma schema file
    const schemaFile = getSchemaFile(options.schema);
    const prismaSchemaFile = await generateTempPrismaSchema(schemaFile);

    try {
        // run prisma db push
        const cmd = [
            'prisma db push',
            ` --schema "${prismaSchemaFile}"`,
            options.acceptDataLoss ? ' --accept-data-loss' : '',
            options.forceReset ? ' --force-reset' : '',
            ' --skip-generate',
        ].join('');

        try {
            await execPackage(cmd);
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
    const schemaFile = getSchemaFile(options.schema);
    const { model, services } = await loadSchemaDocumentWithServices(schemaFile);
    await import("@dotenvx/dotenvx/config")
    const SUPPORTED_PROVIDERS = ['sqlite', 'postgresql']
    const datasource = getDatasource(model)

    if (!datasource) {
        throw new Error('No datasource found in the schema.')
    }

    if (!SUPPORTED_PROVIDERS.includes(datasource.provider)) {
        throw new Error(`Unsupported datasource provider: ${datasource.provider}`)
    }

    const provider = providers[datasource.provider];

    if (!provider) {
        throw new Error(
            `No introspection provider found for: ${datasource.provider}`
        )
    }

    const { enums, tables } = await provider.introspect(datasource.url)

    syncEnums({ dbEnums: enums, model, services })

    const resolveRelations: Relation[] = []
    for (const table of tables) {
        const relations = syncTable({ table, model, provider, services })
        resolveRelations.push(...relations)
    }

    for (const relation of resolveRelations) {
        syncRelation({ model, relation, services });
    }

    for (const d of model.declarations) {
        if (d.$type !== 'DataModel') continue
        const found = tables.find((t) => getDbName(d) === t.name)
        if (!found) {
            delete (d.$container as any)[d.$containerProperty!][d.$containerIndex!]
        }
    }

    model.declarations = model.declarations.filter((d) => d !== undefined)

    const generator = await new ZModelCodeGenerator();

    const zmodelSchema = await generator.generate(model)

    console.log(options.out ? `Writing to ${options.out}` : schemaFile);

    const outPath = options.out ? path.resolve(options.out) : schemaFile;
    console.log(outPath);

    fs.writeFileSync(outPath, zmodelSchema)
}
