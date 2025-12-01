import { glob } from 'glob';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));

async function main() {
    const zmodelFiles = [...glob.sync(path.resolve(dir, '../schemas/*.zmodel'))];
    for (const file of zmodelFiles) {
        console.log(`Generating TS schema for: ${file}`);
        await generate(file);
    }
}

async function generate(schemaPath: string) {
    execSync('npx zen generate', { cwd: path.dirname(schemaPath) });
}

main();
