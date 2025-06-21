import { TsSchemaGenerator } from '@zenstackhq/sdk';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

async function main() {
    const generator = new TsSchemaGenerator();
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const zmodelPath = path.join(dir, 'typing-test.zmodel');
    const tsPath = path.join(dir, 'schema.ts');
    await generator.generate(zmodelPath, [], tsPath);

    const content = fs.readFileSync(tsPath, 'utf-8');
    fs.writeFileSync(tsPath, content.replace(/@zenstackhq\/runtime/g, '../../dist'));

    console.log('TS schema generated at:', tsPath);
}

main();
