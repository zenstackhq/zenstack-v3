import { createTestProject } from '@zenstackhq/testtools';
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
    process.chdir(workDir);
    return workDir;
}
