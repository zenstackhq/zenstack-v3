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

describe('CLI db commands test', () => {
    it('should generate a database with db push', () => {
        const workDir = createProject(model);
        execSync('node node_modules/@zenstackhq/cli/bin/cli db push');
        expect(fs.existsSync(path.join(workDir, 'zenstack/dev.db'))).toBe(true);
    });
});
