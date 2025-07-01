import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import tmp from 'tmp';
import { describe, expect, it } from 'vitest';

describe('Cli init command tests', () => {
    it('should create a new project', () => {
        const { name: workDir } = tmp.dirSync({ unsafeCleanup: true });
        process.chdir(workDir);
        execSync('npm init -y');
        const cli = path.join(__dirname, '../dist/index.js');
        execSync(`node ${cli} init`);
        expect(fs.existsSync('zenstack/schema.zmodel')).toBe(true);
    });
});
