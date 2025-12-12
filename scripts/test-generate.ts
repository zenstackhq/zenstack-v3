import { glob } from 'glob';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const _dirname = typeof __dirname !== 'undefined' ? __dirname : path.dirname(fileURLToPath(import.meta.url));

async function main() {
    const baseDir = process.argv[2] || '.';

    const zmodelFiles = [...glob.sync(path.resolve(baseDir, '**/schema.zmodel'), { ignore: '**/node_modules/**' })];
    for (const file of zmodelFiles) {
        console.log(`Generating TS schema for: ${file}`);
        await generate(file);
    }
}

async function generate(schemaPath: string) {
    const cliPath = path.join(_dirname, '../packages/cli/dist/index.js');
    const RUNTIME = process.env.RUNTIME ?? 'node';
    execSync(`${RUNTIME} ${cliPath} generate --schema ${schemaPath}`, { cwd: path.dirname(schemaPath) });
}

main();
