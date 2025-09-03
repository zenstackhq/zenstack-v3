import fs from 'node:fs';
import path from 'node:path';
import tmp from 'tmp';
import { describe, expect, it } from 'vitest';
import { runCli } from './utils';

// skipping due to timeout during CI
describe.skip('Cli init command tests', () => {
    it('should create a new project', () => {
        const { name: workDir } = tmp.dirSync({ unsafeCleanup: true });
        runCli('init', workDir);
        expect(fs.existsSync(path.join(workDir, 'zenstack/schema.zmodel'))).toBe(true);
    });
});
