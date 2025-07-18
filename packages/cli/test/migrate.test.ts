import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createProject, runCli } from './utils';

const model = `
model User {
    id String @id @default(cuid())
}
`;

describe('CLI migrate commands test', () => {
    it('should generate a database with migrate dev', () => {
        const workDir = createProject(model);
        runCli('migrate dev --name init', workDir);
        expect(fs.existsSync(path.join(workDir, 'zenstack/dev.db'))).toBe(true);
        expect(fs.existsSync(path.join(workDir, 'zenstack/migrations'))).toBe(true);
    });

    it('should reset the database with migrate reset', () => {
        const workDir = createProject(model);
        runCli('db push', workDir);
        expect(fs.existsSync(path.join(workDir, 'zenstack/dev.db'))).toBe(true);
        runCli('migrate reset --force', workDir);
        expect(fs.existsSync(path.join(workDir, 'zenstack/dev.db'))).toBe(true);
    });

    it('should reset the database with migrate deploy', () => {
        const workDir = createProject(model);
        runCli('migrate dev --name init', workDir);
        fs.rmSync(path.join(workDir, 'zenstack/dev.db'));
        runCli('migrate deploy', workDir);
        expect(fs.existsSync(path.join(workDir, 'zenstack/dev.db'))).toBe(true);
    });

    it('supports migrate status', () => {
        const workDir = createProject(model);
        runCli('migrate dev --name init', workDir);
        runCli('migrate status', workDir);
    });
});
