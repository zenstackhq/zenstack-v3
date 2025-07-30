import { TsSchemaGenerator } from '@zenstackhq/sdk';
import type { SchemaDef } from '@zenstackhq/sdk/schema';
import { glob } from 'glob';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { match } from 'ts-pattern';
import { createTestProject } from './project';

function makePrelude(provider: 'sqlite' | 'postgresql', dbUrl?: string) {
    return match(provider)
        .with('sqlite', () => {
            return `
datasource db {
    provider = 'sqlite'
    url = '${dbUrl ?? 'file:./test.db'}'
}
`;
        })
        .with('postgresql', () => {
            return `
datasource db {
    provider = 'postgresql'
    url = '${dbUrl ?? 'postgres://postgres:postgres@localhost:5432/db'}'
}
`;
        })
        .exhaustive();
}

export async function generateTsSchema(
    schemaText: string,
    provider: 'sqlite' | 'postgresql' = 'sqlite',
    dbUrl?: string,
    extraSourceFiles?: Record<string, string>,
) {
    const workDir = createTestProject();

    const zmodelPath = path.join(workDir, 'schema.zmodel');
    const noPrelude = schemaText.includes('datasource ');
    fs.writeFileSync(zmodelPath, `${noPrelude ? '' : makePrelude(provider, dbUrl)}\n\n${schemaText}`);

    const pluginModelFiles = glob.sync(path.resolve(__dirname, '../../runtime/src/plugins/**/plugin.zmodel'));

    const generator = new TsSchemaGenerator();
    await generator.generate(zmodelPath, pluginModelFiles, workDir);

    if (extraSourceFiles) {
        for (const [fileName, content] of Object.entries(extraSourceFiles)) {
            const filePath = path.resolve(workDir, `${fileName}.ts`);
            fs.mkdirSync(path.dirname(filePath), { recursive: true });
            fs.writeFileSync(filePath, content);
        }
    }

    // compile the generated TS schema
    return compileAndLoad(workDir);
}

async function compileAndLoad(workDir: string) {
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

export async function generateTsSchemaInPlace(schemaPath: string) {
    const workDir = path.dirname(schemaPath);
    const pluginModelFiles = glob.sync(path.resolve(__dirname, '../../runtime/src/plugins/**/plugin.zmodel'));

    const generator = new TsSchemaGenerator();
    await generator.generate(schemaPath, pluginModelFiles, workDir);
    return compileAndLoad(workDir);
}
