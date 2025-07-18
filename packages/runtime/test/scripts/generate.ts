import { glob } from 'glob';
import { TsSchemaGenerator } from '@zenstackhq/sdk';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));

async function main() {
    await generate(path.resolve(dir, '../typing/typing-test.zmodel'));
    await generate(path.resolve(dir, '../test-schema/schema.zmodel'));
}

async function generate(schemaPath: string) {
    const generator = new TsSchemaGenerator();
    const outputDir = path.dirname(schemaPath);
    const tsPath = path.join(outputDir, 'schema.ts');
    const pluginModelFiles = glob.sync(path.resolve(dir, '../../dist/**/plugin.zmodel'));
    await generator.generate(schemaPath, pluginModelFiles, outputDir);
    const content = fs.readFileSync(tsPath, 'utf-8');
    fs.writeFileSync(tsPath, content.replace(/@zenstackhq\/runtime/g, '../../dist'));
    console.log('TS schema generated at:', outputDir);
}

main();
