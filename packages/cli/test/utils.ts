import { createTestProject, getTestDbProvider } from '@zenstackhq/testtools';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { expect } from 'vitest';
import { formatDocument } from '@zenstackhq/language';

const TEST_PG_CONFIG = {
    host: process.env['TEST_PG_HOST'] ?? 'localhost',
    port: process.env['TEST_PG_PORT'] ? parseInt(process.env['TEST_PG_PORT']) : 5432,
    user: process.env['TEST_PG_USER'] ?? 'postgres',
    password: process.env['TEST_PG_PASSWORD'] ?? 'postgres',
};

const TEST_MYSQL_CONFIG = {
    host: process.env['TEST_MYSQL_HOST'] ?? 'localhost',
    port: process.env['TEST_MYSQL_PORT'] ? parseInt(process.env['TEST_MYSQL_PORT']) : 3306,
    user: process.env['TEST_MYSQL_USER'] ?? 'root',
    password: process.env['TEST_MYSQL_PASSWORD'] ?? 'mysql',
};

function getTestDbName(provider: string) {
    if (provider === 'sqlite') {
        return './test.db';
    }
    const testName = expect.getState().currentTestName ?? 'unnamed';
    const testPath = expect.getState().testPath ?? '';
    // digest test name
    const digest = createHash('md5')
        .update(testName + testPath)
        .digest('hex');
    // compute a database name based on test name
    return (
        'test_' +
        testName
            .toLowerCase()
            .replace(/[^a-z0-9_]/g, '_')
            .replace(/_+/g, '_')
            .substring(0, 30) +
        digest.slice(0, 6)
    );
}

export function getDefaultPrelude(options?: { provider?: 'sqlite' | 'postgresql' | 'mysql', extra?: Record<string, string | string[]> }) {
    const provider = (options?.provider || getTestDbProvider()) ?? 'sqlite';
    const dbName = getTestDbName(provider);
    let dbUrl: string;

    switch (provider) {
        case 'sqlite':
            dbUrl = `file:${dbName}`;
            break;
        case 'postgresql':
            dbUrl = `postgres://${TEST_PG_CONFIG.user}:${TEST_PG_CONFIG.password}@${TEST_PG_CONFIG.host}:${TEST_PG_CONFIG.port}/${dbName}`;
            break;
        case 'mysql':
            dbUrl = `mysql://${TEST_MYSQL_CONFIG.user}:${TEST_MYSQL_CONFIG.password}@${TEST_MYSQL_CONFIG.host}:${TEST_MYSQL_CONFIG.port}/${dbName}`;
            break;
        default:
            throw new Error(`Unsupported provider: ${provider}`);
    }
    // Build fields array for proper alignment (matching ZModelCodeGenerator)
    const fields: [string, string][] = [
        ['provider', `"${provider}"`],
        ['url', `"${dbUrl}"`],
        ...Object.entries(options?.extra || {}).map(([k, v]) => {
            const value = Array.isArray(v) ? `[${v.map(item => `"${item}"`).join(', ')}]` : `"${v}"`;
            return [k, value] as [string, string];
        }),
    ];

    // Calculate alignment padding based on longest field name
    const longestName = Math.max(...fields.map(([name]) => name.length));
    const formattedFields = fields.map(([name, value]) => {
        const padding = ' '.repeat(longestName - name.length + 1);
        return `    ${name}${padding}= ${value}`;
    }).join('\n');

    const ZMODEL_PRELUDE = `datasource db {\n${formattedFields}\n}`;
    return ZMODEL_PRELUDE;
}

export function createProject(
    zmodel: string,
    options?: { customPrelude?: boolean; provider?: 'sqlite' | 'postgresql' | 'mysql' },
) {
    const workDir = createTestProject();
    fs.mkdirSync(path.join(workDir, 'zenstack'), { recursive: true });
    const schemaPath = path.join(workDir, 'zenstack/schema.zmodel');
    fs.writeFileSync(schemaPath, !options?.customPrelude ? `${getDefaultPrelude({ provider: options?.provider })}\n\n${zmodel}` : zmodel);
    return workDir;
}

export async function createFormattedProject(
    zmodel: string,
    options?: { provider?: 'sqlite' | 'postgresql' | 'mysql', extra?: Record<string, string | string[]> },
) {
    const fullContent = `${getDefaultPrelude({ provider: options?.provider, extra: options?.extra })}\n\n${zmodel}`;
    const formatted = await formatDocument(fullContent);
    return createProject(formatted, { customPrelude: true, provider: options?.provider });
}

export function runCli(command: string, cwd: string) {
    const cli = path.join(__dirname, '../dist/index.js');
    execSync(`node ${cli} ${command}`, { cwd });
}
