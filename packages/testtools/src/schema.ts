import type { SchemaDef } from '@zenstackhq/runtime/schema';
import { TsSchemaGenerator } from '@zenstackhq/sdk';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import tmp from 'tmp';
import { glob } from 'glob';

const ZMODEL_PRELUDE = `
datasource db {
    provider = 'sqlite'
    url = 'file:./dev.db'
}
`;

export async function generateTsSchema(schemaText: string, noPrelude = false) {
    const { name: workDir } = tmp.dirSync({ unsafeCleanup: true });
    console.log(`Working directory: ${workDir}`);
    const zmodelPath = path.join(workDir, 'schema.zmodel');
    fs.writeFileSync(
        zmodelPath,
        `${noPrelude ? '' : ZMODEL_PRELUDE}\n\n${schemaText}`
    );

    const pluginModelFiles = glob.sync(
        path.resolve(__dirname, '../../runtime/src/plugins/**/plugin.zmodel')
    );

    const generator = new TsSchemaGenerator();
    const tsPath = path.join(workDir, 'schema.ts');
    await generator.generate(zmodelPath, pluginModelFiles, tsPath);

    fs.symlinkSync(
        path.join(__dirname, '../node_modules'),
        path.join(workDir, 'node_modules'),
        'dir'
    );

    fs.writeFileSync(
        path.join(workDir, 'package.json'),
        JSON.stringify({
            name: 'test',
            version: '1.0.0',
            type: 'module',
        })
    );

    fs.writeFileSync(
        path.join(workDir, 'tsconfig.json'),
        JSON.stringify({
            compilerOptions: {
                module: 'ESNext',
                target: 'ESNext',
                moduleResolution: 'Bundler',
                esModuleInterop: true,
                skipLibCheck: true,
            },
        })
    );

    // compile the generated TS schema
    execSync('npx tsc', {
        cwd: workDir,
        stdio: 'inherit',
    });

    // load the schema module
    const module = await import(path.join(workDir, 'schema.js'));
    return module.schema as SchemaDef;
}

export function generateTsSchemaFromFile(filePath: string) {
    const schemaText = fs.readFileSync(filePath, 'utf8');
    return generateTsSchema(schemaText, true);
}
