import { loadDocument } from '@zenstackhq/language';
import { TsSchemaGenerator } from '@zenstackhq/sdk';
import { glob } from 'glob';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));

async function main() {
    const zmodelFiles = glob.sync(path.resolve(dir, '../test/**/*.zmodel'));
    for (const file of zmodelFiles) {
        console.log(`Generating TS schema for: ${file}`);
        await generate(file);
    }
}

async function generate(schemaPath: string) {
    const generator = new TsSchemaGenerator();
    const outDir = path.dirname(schemaPath);
    const result = await loadDocument(schemaPath);
    if (!result.success) {
        throw new Error(`Failed to load schema from ${schemaPath}: ${result.errors}`);
    }
    await generator.generate(result.model, { outDir, liteOnly: true });
}

main();
