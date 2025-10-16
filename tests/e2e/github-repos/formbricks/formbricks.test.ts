import { generateTsSchema } from '@zenstackhq/testtools';
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('Formbricks e2e tests', () => {
    it('has a working schema', async () => {
        await expect(
            generateTsSchema(fs.readFileSync(path.join(__dirname, 'schema.zmodel'), 'utf8'), 'postgresql'),
        ).resolves.toBeTruthy();
    });
});
