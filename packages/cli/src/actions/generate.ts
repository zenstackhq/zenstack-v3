import { invariant } from '@zenstackhq/common-helpers';
import { isPlugin, LiteralExpr, type Model } from '@zenstackhq/language/ast';
import { PrismaSchemaGenerator, TsSchemaGenerator, type CliGenerator } from '@zenstackhq/sdk';
import colors from 'colors';
import fs from 'node:fs';
import path from 'node:path';
import { getPkgJsonConfig, getSchemaFile, loadSchemaDocument } from './action-utils';

type Options = {
    schema?: string;
    output?: string;
    silent?: boolean;
    savePrismaSchema?: string | boolean;
};

/**
 * CLI action for generating code from schema
 */
export async function run(options: Options) {
    const start = Date.now();

    const schemaFile = getSchemaFile(options.schema);

    const model = await loadSchemaDocument(schemaFile);
    const outputPath = getOutputPath(options, schemaFile);

    // generate TS schema
    const tsSchemaFile = path.join(outputPath, 'schema.ts');
    await new TsSchemaGenerator().generate(schemaFile, [], outputPath);

    await runPlugins(model, outputPath, tsSchemaFile);

    // generate Prisma schema
    if (options.savePrismaSchema) {
        const prismaSchema = await new PrismaSchemaGenerator(model).generate();
        let prismaSchemaFile = path.join(outputPath, 'schema.prisma');
        if (typeof options.savePrismaSchema === 'string') {
            prismaSchemaFile = path.resolve(outputPath, options.savePrismaSchema);
            fs.mkdirSync(path.dirname(prismaSchemaFile), { recursive: true });
        }
        fs.writeFileSync(prismaSchemaFile, prismaSchema);
    }

    if (!options.silent) {
        console.log(colors.green(`Generation completed successfully in ${Date.now() - start}ms.`));
        console.log(`You can now create a ZenStack client with it.

\`\`\`ts
import { ZenStackClient } from '@zenstackhq/runtime';
import { schema } from '${outputPath}/schema';

const client = new ZenStackClient(schema, {
    dialectConfig: { ... }
});
\`\`\`
`);
    }
}

function getOutputPath(options: Options, schemaFile: string) {
    if (options.output) {
        return options.output;
    }
    const pkgJsonConfig = getPkgJsonConfig(process.cwd());
    if (pkgJsonConfig.output) {
        return pkgJsonConfig.output;
    } else {
        return path.dirname(schemaFile);
    }
}

async function runPlugins(model: Model, outputPath: string, tsSchemaFile: string) {
    const plugins = model.declarations.filter(isPlugin);
    for (const plugin of plugins) {
        const providerField = plugin.fields.find((f) => f.name === 'provider');
        invariant(providerField, `Plugin ${plugin.name} does not have a provider field`);
        const provider = (providerField.value as LiteralExpr).value as string;
        let useProvider = provider;
        if (useProvider.startsWith('@core/')) {
            useProvider = `@zenstackhq/runtime/plugins/${useProvider.slice(6)}`;
        }
        const generator = (await import(useProvider)).default as CliGenerator;
        console.log('Running generator:', provider);
        await generator({ model, outputPath, tsSchemaFile });
    }
}
