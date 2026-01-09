import { createTestProject, getTestDbProvider } from '@zenstackhq/testtools';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { expect } from 'vitest';

const TEST_PG_CONFIG = {
    host: process.env['TEST_PG_HOST'] ?? 'localhost',
    port: process.env['TEST_PG_PORT'] ? parseInt(process.env['TEST_PG_PORT']) : 5432,
    user: process.env['TEST_PG_USER'] ?? 'postgres',
    password: process.env['TEST_PG_PASSWORD'] ?? 'postgres',
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

export function getDefaultPrelude(options?: { provider?: 'sqlite' | 'postgresql' }) {
    const provider = (options?.provider || getTestDbProvider()) ?? 'sqlite';
    const dbName = getTestDbName(provider);
    const dbUrl =
        provider === 'sqlite'
            ? `file:${dbName}`
            : `postgres://${TEST_PG_CONFIG.user}:${TEST_PG_CONFIG.password}@${TEST_PG_CONFIG.host}:${TEST_PG_CONFIG.port}/${dbName}`;

    const ZMODEL_PRELUDE = `datasource db {
  provider = "${provider}"
  url      = "${dbUrl}"
}
`;
    return ZMODEL_PRELUDE;
}

export function createProject(
    zmodel: string,
    options?: { customPrelude?: boolean; provider?: 'sqlite' | 'postgresql' },
) {
    const workDir = createTestProject();
    fs.mkdirSync(path.join(workDir, 'zenstack'), { recursive: true });
    const schemaPath = path.join(workDir, 'zenstack/schema.zmodel');
    fs.writeFileSync(schemaPath, !options?.customPrelude ? `${getDefaultPrelude()}\n${zmodel}` : zmodel);
    return workDir;
}

export function runCli(command: string, cwd: string) {
    const cli = path.join(__dirname, '../dist/index.js');
    execSync(`node ${cli} ${command}`, { cwd, stdio: 'inherit' });
}
