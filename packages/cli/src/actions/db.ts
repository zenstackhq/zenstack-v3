import type { Model } from '@zenstackhq/language/ast';
import { ZModelCodeGenerator } from '@zenstackhq/sdk';
import fs from 'node:fs';
import path from 'node:path';
import { execPackage } from '../utils/exec-utils';
import {
    generateTempPrismaSchema,
    getSchemaFile,
    handleSubProcessError,
    loadSchemaDocumentWithServices,
} from './action-utils';
import { syncEnums, syncRelation, syncTable, type Relation } from './pull';
import { providers } from './pull/provider';
import { getDatasource } from './pull/utils';
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

    const { enums, tables } = await provider.introspect(datasource.url);

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

    //TODO: diff models and apply changes only

    const generator = new ZModelCodeGenerator();

    const zmodelSchema = generator.generate(newModel);

    console.log(options.out ? `Writing to ${options.out}` : schemaFile);

    const outPath = options.out ? path.resolve(options.out) : schemaFile;
    console.log(outPath);

    fs.writeFileSync(outPath, zmodelSchema);
}
