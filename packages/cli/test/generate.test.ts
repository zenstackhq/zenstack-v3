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

describe('CLI generate command test', () => {
    it('should generate a TypeScript schema', () => {
        const workDir = createProject(model);
        execSync('node node_modules/@zenstackhq/cli/bin/cli generate');
        expect(fs.existsSync(path.join(workDir, 'zenstack/schema.ts'))).toBe(true);
        expect(fs.existsSync(path.join(workDir, 'zenstack/schema.prisma'))).toBe(false);
    });

    it('should respect custom output directory', () => {
        const workDir = createProject(model);
        execSync('node node_modules/@zenstackhq/cli/bin/cli generate --output ./zen');
        expect(fs.existsSync(path.join(workDir, 'zen/schema.ts'))).toBe(true);
    });

    it('should respect custom schema location', () => {
        const workDir = createProject(model);
        fs.renameSync(path.join(workDir, 'zenstack/schema.zmodel'), path.join(workDir, 'zenstack/foo.zmodel'));
        execSync('node node_modules/@zenstackhq/cli/bin/cli generate --schema ./zenstack/foo.zmodel');
        expect(fs.existsSync(path.join(workDir, 'zenstack/schema.ts'))).toBe(true);
    });

    it('should respect save prisma schema option', () => {
        const workDir = createProject(model);
        execSync('node node_modules/@zenstackhq/cli/bin/cli generate --save-prisma-schema');
        expect(fs.existsSync(path.join(workDir, 'zenstack/schema.prisma'))).toBe(true);
    });

    it('should respect save prisma schema custom path option', () => {
        const workDir = createProject(model);
        execSync('node node_modules/@zenstackhq/cli/bin/cli generate --save-prisma-schema "../prisma/schema.prisma"');
        expect(fs.existsSync(path.join(workDir, 'prisma/schema.prisma'))).toBe(true);
    });
});
