import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createProject } from './utils';

const model = `
model User {
    id String @id @default(cuid())
}
`;

describe('CLI migrate commands test', () => {
    it('should generate a database with migrate dev', () => {
        const workDir = createProject(model);
        execSync('node node_modules/@zenstackhq/cli/bin/cli migrate dev --name init');
        expect(fs.existsSync(path.join(workDir, 'zenstack/dev.db'))).toBe(true);
        expect(fs.existsSync(path.join(workDir, 'zenstack/migrations'))).toBe(true);
    });

    it('should reset the database with migrate reset', () => {
        const workDir = createProject(model);
        execSync('node node_modules/@zenstackhq/cli/bin/cli db push');
        expect(fs.existsSync(path.join(workDir, 'zenstack/dev.db'))).toBe(true);
        execSync('node node_modules/@zenstackhq/cli/bin/cli migrate reset --force');
        expect(fs.existsSync(path.join(workDir, 'zenstack/dev.db'))).toBe(true);
    });

    it('should reset the database with migrate deploy', () => {
        const workDir = createProject(model);
        execSync('node node_modules/@zenstackhq/cli/bin/cli migrate dev --name init');
        fs.rmSync(path.join(workDir, 'zenstack/dev.db'));
        execSync('node node_modules/@zenstackhq/cli/bin/cli migrate deploy');
        expect(fs.existsSync(path.join(workDir, 'zenstack/dev.db'))).toBe(true);
    });

    it('supports migrate status', () => {
        createProject(model);
        execSync('node node_modules/@zenstackhq/cli/bin/cli migrate dev --name init');
        execSync('node node_modules/@zenstackhq/cli/bin/cli migrate status');
    });
});
