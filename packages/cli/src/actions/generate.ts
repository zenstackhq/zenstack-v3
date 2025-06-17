import { isPlugin, LiteralExpr, type Model } from '@zenstackhq/language/ast';
import type { CliGenerator } from '@zenstackhq/runtime/client';
import { PrismaSchemaGenerator, TsSchemaGenerator } from '@zenstackhq/sdk';
import colors from 'colors';
import fs from 'node:fs';
import path from 'node:path';
import invariant from 'tiny-invariant';
import { getSchemaFile, loadSchemaDocument } from './action-utils';

type Options = {
    schema?: string;
    output?: string;
    silent?: boolean;
};

/**
 * CLI action for generating code from schema
 */
export async function run(options: Options) {
    const schemaFile = getSchemaFile(options.schema);

    const model = await loadSchemaDocument(schemaFile);
    const outputPath = options.output ?? path.dirname(schemaFile);

    // generate TS schema
    const tsSchemaFile = path.join(outputPath, 'schema.ts');
    await new TsSchemaGenerator().generate(schemaFile, [], tsSchemaFile);

    await runPlugins(model, outputPath, tsSchemaFile);

    // generate Prisma schema
    const prismaSchema = await new PrismaSchemaGenerator(model).generate();
    fs.writeFileSync(path.join(outputPath, 'schema.prisma'), prismaSchema);

    if (!options.silent) {
        console.log(colors.green('Generation completed successfully.'));
        console.log(`You can now create a ZenStack client with it.

\`\`\`ts
import { ZenStackClient } from '@zenstackhq/runtime';
import { schema } from '${outputPath}/schema';

const client = new ZenStackClient(schema);
\`\`\`
`);
    }
}

async function runPlugins(
    model: Model,
    outputPath: string,
    tsSchemaFile: string
) {
    const plugins = model.declarations.filter(isPlugin);
    for (const plugin of plugins) {
        const providerField = plugin.fields.find((f) => f.name === 'provider');
        invariant(
            providerField,
            `Plugin ${plugin.name} does not have a provider field`
        );
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
