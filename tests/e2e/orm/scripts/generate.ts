import { loadDocument } from '@zenstackhq/language';
import type { Model } from '@zenstackhq/language/ast';
import { TsSchemaGenerator } from '@zenstackhq/sdk';
import { glob } from 'glob';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));

async function main() {
    const zmodelFiles = glob.sync(path.resolve(dir, '../schemas/**/*.zmodel'));
    for (const file of zmodelFiles) {
        console.log(`Generating TS schema for: ${file}`);
        await generate(file);
    }
}

async function generate(schemaPath: string) {
    const generator = new TsSchemaGenerator();
    const outputDir = path.dirname(schemaPath);

    // isomorphic __dirname
    const _dirname = typeof __dirname !== 'undefined' ? __dirname : path.dirname(fileURLToPath(import.meta.url));

    // plugin models
    const pluginDocs = [path.resolve(_dirname, '../../node_modules/@zenstackhq/plugin-policy/plugin.zmodel')];

    const result = await loadDocument(schemaPath, pluginDocs);
    if (!result.success) {
        throw new Error(`Failed to load schema from ${schemaPath}: ${result.errors}`);
    }
    await generator.generate(result.model as Model, outputDir);
}

main();
