import { describe, expect, it } from 'vitest';
import { createProject, runCli } from './utils';
import fs from 'node:fs';

const model = `
model User {
  id String @id @default(cuid())
    email String @unique
}
`;

describe('CLI format command test', () => {
    it('should format a valid schema successfully', () => {
        const workDir = createProject(model);
        expect(() => runCli('format', workDir)).not.toThrow();
        const updatedContent = fs.readFileSync(`${workDir}/zenstack/schema.zmodel`, 'utf-8');
        expect(
            updatedContent.includes(`model User {
    id    String @id @default(cuid())
    email String @unique
}`),
        ).toBeTruthy();
    });

    it('should silently ignore invalid schema', () => {
        const invalidModel = `
model User {
  id String @id @default(cuid())
`;
        const workDir = createProject(invalidModel);
        expect(() => runCli('format', workDir)).not.toThrow();
    });
});
