import { TsSchemaGenerator } from '@zenstackhq/sdk';
import type { SchemaDef } from '@zenstackhq/sdk/schema';
import { glob } from 'glob';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { match } from 'ts-pattern';
import { createTestProject } from './project';

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
    dbName?: string,
    extraSourceFiles?: Record<string, string>,
) {
    const workDir = createTestProject();
    console.log(`Work directory: ${workDir}`);

    const zmodelPath = path.join(workDir, 'schema.zmodel');
    const noPrelude = schemaText.includes('datasource ');
    fs.writeFileSync(zmodelPath, `${noPrelude ? '' : makePrelude(provider, dbName)}\n\n${schemaText}`);

    const pluginModelFiles = glob.sync(path.resolve(__dirname, '../../runtime/src/plugins/**/plugin.zmodel'));

    const generator = new TsSchemaGenerator();
    const tsPath = path.join(workDir, 'schema.ts');
    await generator.generate(zmodelPath, pluginModelFiles, tsPath);

    if (extraSourceFiles) {
        for (const [fileName, content] of Object.entries(extraSourceFiles)) {
            const filePath = path.resolve(workDir, `${fileName}.ts`);
            fs.mkdirSync(path.dirname(filePath), { recursive: true });
            fs.writeFileSync(filePath, content);
        }
    }

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
