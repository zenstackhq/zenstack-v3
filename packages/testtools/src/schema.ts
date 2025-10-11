import { invariant } from '@zenstackhq/common-helpers';
import { loadDocument } from '@zenstackhq/language';
import { TsSchemaGenerator } from '@zenstackhq/sdk';
import type { SchemaDef } from '@zenstackhq/sdk/schema';
import { execSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { match } from 'ts-pattern';
import { expect } from 'vitest';
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

    const result = await loadDocument(zmodelPath);
    if (!result.success) {
        throw new Error(`Failed to load schema from ${zmodelPath}: ${result.errors}`);
    }

    const generator = new TsSchemaGenerator();
    await generator.generate(result.model, workDir);

    if (extraSourceFiles) {
        for (const [fileName, content] of Object.entries(extraSourceFiles)) {
            const filePath = path.resolve(workDir, `${fileName}.ts`);
            fs.mkdirSync(path.dirname(filePath), { recursive: true });
            fs.writeFileSync(filePath, content);
        }
    }

    // compile the generated TS schema
    return { ...(await compileAndLoad(workDir)), model: result.model };
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
    const result = await loadDocument(schemaPath);
    if (!result.success) {
        throw new Error(`Failed to load schema from ${schemaPath}: ${result.errors}`);
    }
    const generator = new TsSchemaGenerator();
    await generator.generate(result.model, workDir);
    return compileAndLoad(workDir);
}

export async function loadSchema(schema: string, additionalSchemas?: Record<string, string>) {
    if (!schema.includes('datasource ')) {
        schema = `${makePrelude('sqlite')}\n\n${schema}`;
    }

    // create a temp folder
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zenstack-schema'));

    // create a temp file
    const tempFile = path.join(tempDir, `schema.zmodel`);
    fs.writeFileSync(tempFile, schema);

    if (additionalSchemas) {
        for (const [fileName, content] of Object.entries(additionalSchemas)) {
            let name = fileName;
            if (!name.endsWith('.zmodel')) {
                name += '.zmodel';
            }
            const filePath = path.join(tempDir, name);
            fs.writeFileSync(filePath, content);
        }
    }

    const r = await loadDocument(tempFile);
    expect(r).toSatisfy(
        (r) => r.success,
        `Failed to load schema: ${(r as any).errors?.map((e: any) => e.toString()).join(', ')}`,
    );
    invariant(r.success);
    return r.model;
}

export async function loadSchemaWithError(schema: string, error: string | RegExp) {
    if (!schema.includes('datasource ')) {
        schema = `${makePrelude('sqlite')}\n\n${schema}`;
    }

    // create a temp file
    const tempFile = path.join(os.tmpdir(), `zenstack-schema-${crypto.randomUUID()}.zmodel`);
    fs.writeFileSync(tempFile, schema);
    const r = await loadDocument(tempFile);
    expect(r.success).toBe(false);
    invariant(!r.success);
    if (typeof error === 'string') {
        expect(r).toSatisfy(
            (r) => r.errors.some((e: any) => e.toString().toLowerCase().includes(error.toLowerCase())),
            `Expected error message to include "${error}" but got: ${r.errors.map((e: any) => e.toString()).join(', ')}`,
        );
    } else {
        expect(r).toSatisfy(
            (r) => r.errors.some((e: any) => error.test(e)),
            `Expected error message to match "${error}" but got: ${r.errors.map((e: any) => e.toString()).join(', ')}`,
        );
    }
}
