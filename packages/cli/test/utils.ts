import { createTestProject } from '@zenstackhq/testtools';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ZMODEL_PRELUDE = `datasource db {
    provider = "sqlite"
    url = "file:./dev.db"
}
`;

export function createProject(zmodel: string, addPrelude = true) {
    const workDir = createTestProject();
    fs.mkdirSync(path.join(workDir, 'zenstack'), { recursive: true });
    const schemaPath = path.join(workDir, 'zenstack/schema.zmodel');
    fs.writeFileSync(schemaPath, addPrelude ? `${ZMODEL_PRELUDE}\n\n${zmodel}` : zmodel);
    return workDir;
}

export function runCli(command: string, cwd: string) {
    const cli = path.join(__dirname, '../dist/index.js');
    execSync(`node ${cli} ${command}`, { cwd });
}
