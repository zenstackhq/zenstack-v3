import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import tmp from 'tmp';
import { TsSchemaGenerator } from '../src/zmodel/ts-schema-generator';
import type { SchemaDef } from '../../runtime/src/schema';

const ZMODEL_PRELUDE = `
datasource db {
    provider = 'sqlite'
    url = 'file:./dev.db'
}
`;

export async function generateTsSchema(schemaText: string) {
    const { name: workDir } = tmp.dirSync({ unsafeCleanup: true });
    console.log(`Working directory: ${workDir}`);
    const zmodelPath = path.join(workDir, 'schema.zmodel');
    fs.writeFileSync(zmodelPath, `${ZMODEL_PRELUDE}\n\n${schemaText}`);
    const generator = new TsSchemaGenerator();
    const tsPath = path.join(workDir, 'schema.ts');
    await generator.generate(zmodelPath, tsPath);

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
