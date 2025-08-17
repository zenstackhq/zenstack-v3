import { loadDocument } from '@zenstackhq/language';
import { TsSchemaGenerator } from '@zenstackhq/sdk';
import { glob } from 'glob';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));

async function main() {
    // glob all zmodel files in "e2e" directory
    const zmodelFiles = glob.sync(path.resolve(dir, '../schemas/**/*.zmodel'));
    for (const file of zmodelFiles) {
        console.log(`Generating TS schema for: ${file}`);
        await generate(file);
    }
}

async function generate(schemaPath: string) {
    const generator = new TsSchemaGenerator();
    const outputDir = path.dirname(schemaPath);
    const tsPath = path.join(outputDir, 'schema.ts');
    const pluginModelFiles = glob.sync(path.resolve(dir, '../../dist/**/plugin.zmodel'));
    const result = await loadDocument(schemaPath, pluginModelFiles);
    if (!result.success) {
        throw new Error(`Failed to load schema from ${schemaPath}: ${result.errors}`);
    }
    await generator.generate(result.model, outputDir);
    const content = fs.readFileSync(tsPath, 'utf-8');
    fs.writeFileSync(tsPath, content.replace(/@zenstackhq\/runtime/g, '../../../dist'));
    console.log('TS schema generated at:', outputDir);
}

main();
