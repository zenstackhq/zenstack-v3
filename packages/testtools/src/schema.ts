import { TsSchemaGenerator } from '@zenstackhq/sdk';
import type { SchemaDef } from '@zenstackhq/sdk/schema';
import { glob } from 'glob';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import tmp from 'tmp';
import { match } from 'ts-pattern';

function makePrelude(provider: 'sqlite' | 'postgresql', dbName?: string) {
    return match(provider)
        .with('sqlite', () => {
            return `
datasource db {
    provider = 'sqlite'
    url = '${dbName ?? ':memory:'}'
}
`;
        })
        .with('postgresql', () => {
            return `
datasource db {
    provider = 'postgresql'
    url = 'postgres://postgres:postgres@localhost:5432/${dbName}'
}
`;
        })
        .exhaustive();
}

export async function generateTsSchema(
    schemaText: string,
    provider: 'sqlite' | 'postgresql' = 'sqlite',
    dbName?: string
) {
    const { name: workDir } = tmp.dirSync({ unsafeCleanup: true });
    console.log(`Working directory: ${workDir}`);

    const zmodelPath = path.join(workDir, 'schema.zmodel');
    const noPrelude = schemaText.includes('datasource ');
    fs.writeFileSync(
        zmodelPath,
        `${noPrelude ? '' : makePrelude(provider, dbName)}\n\n${schemaText}`
    );

    const pluginModelFiles = glob.sync(
        path.resolve(__dirname, '../../runtime/src/plugins/**/plugin.zmodel')
    );

    const generator = new TsSchemaGenerator();
    const tsPath = path.join(workDir, 'schema.ts');
    await generator.generate(zmodelPath, pluginModelFiles, tsPath);

    fs.mkdirSync(path.join(workDir, 'node_modules'));

    // symlink all entries from "node_modules"
    const nodeModules = fs.readdirSync(path.join(__dirname, '../node_modules'));
    for (const entry of nodeModules) {
        if (entry.startsWith('@zenstackhq')) {
            continue;
        }
        fs.symlinkSync(
            path.join(__dirname, '../node_modules', entry),
            path.join(workDir, 'node_modules', entry),
            'dir'
        );
    }

    // in addition, symlink zenstack packages
    const zenstackPackages = ['language', 'sdk', 'runtime'];
    fs.mkdirSync(path.join(workDir, 'node_modules/@zenstackhq'));
    for (const pkg of zenstackPackages) {
        fs.symlinkSync(
            path.join(__dirname, `../../${pkg}/dist`),
            path.join(workDir, `node_modules/@zenstackhq/${pkg}`),
            'dir'
        );
    }

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
    return { workDir, schema: module.schema as SchemaDef };
}

export function generateTsSchemaFromFile(filePath: string) {
    const schemaText = fs.readFileSync(filePath, 'utf8');
    return generateTsSchema(schemaText);
}
