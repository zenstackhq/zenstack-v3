import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createProject, runCli } from '../utils';

describe('Core plugins tests', () => {
    it('can automatically generate a TypeScript schema with default output', () => {
        const workDir = createProject(`
model User {
    id String @id @default(cuid())
}
`);
        runCli('generate', workDir);
        expect(fs.existsSync(path.join(workDir, 'zenstack/schema.ts'))).toBe(true);
    });

    it('can automatically generate a TypeScript schema with custom output', () => {
        const workDir = createProject(`
plugin typescript {
    provider = '@core/typescript'
    output = '../generated-schema'
}

model User {
    id String @id @default(cuid())
}
`);
        runCli('generate', workDir);
        expect(fs.existsSync(path.join(workDir, 'generated-schema/schema.ts'))).toBe(true);
    });

    it('can generate a Prisma schema with default output', () => {
        const workDir = createProject(`
plugin prisma {
    provider = '@core/prisma'
}

model User {
    id String @id @default(cuid())
}
`);
        runCli('generate', workDir);
        expect(fs.existsSync(path.join(workDir, 'zenstack/schema.prisma'))).toBe(true);
    });

    it('can generate a Prisma schema with custom output', () => {
        const workDir = createProject(`
plugin prisma {
    provider = '@core/prisma'
    output = './prisma'
}

model User {
    id String @id @default(cuid())
}
`);
        runCli('generate', workDir);
        expect(fs.existsSync(path.join(workDir, 'zenstack/prisma/schema.prisma'))).toBe(true);
    });
});
