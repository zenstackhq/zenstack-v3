import { loadDocument } from '@zenstackhq/language';
import type { Model } from '@zenstackhq/language/ast';
import { TsSchemaGenerator } from '@zenstackhq/sdk';
import { glob } from 'glob';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));

/**
 * Discovers project .zmodel schema files and generates TypeScript schemas for each.
 *
 * Searches the repository's ORM and app schema locations for `.zmodel` files, logs each file being processed, and invokes `generate` for every discovered file.
 */
async function main() {
    const zmodelFiles = [
        ...glob.sync(path.resolve(dir, '../orm/schemas/**/*.zmodel')),
        ...glob.sync(path.resolve(dir, '../apps/**/schema.zmodel')),
    ];
    for (const file of zmodelFiles) {
        console.log(`Generating TS schema for: ${file}`);
        await generate(file);
    }
}

/**
 * Generates TypeScript schema files from a .zmodel file and writes them to the schema's directory.
 *
 * @param schemaPath - Filesystem path to the source `.zmodel` schema file
 * @throws Error if the schema document fails to load; the error message includes the schema path and load errors
 */
async function generate(schemaPath: string) {
    const generator = new TsSchemaGenerator();
    const outDir = path.dirname(schemaPath);

    // isomorphic __dirname
    const _dirname = typeof __dirname !== 'undefined' ? __dirname : path.dirname(fileURLToPath(import.meta.url));

    // plugin models
    const pluginDocs = [path.resolve(_dirname, '../node_modules/@zenstackhq/plugin-policy/plugin.zmodel')];

    const result = await loadDocument(schemaPath, pluginDocs);
    if (!result.success) {
        throw new Error(`Failed to load schema from ${schemaPath}: ${result.errors}`);
    }
    await generator.generate(result.model as Model, { outDir });
}

main();