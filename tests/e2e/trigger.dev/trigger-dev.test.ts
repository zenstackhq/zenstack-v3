import { generateTsSchema } from '@zenstackhq/testtools';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Trigger.dev e2e tests', () => {
    it('has a working schema', async () => {
        await expect(
            generateTsSchema(fs.readFileSync(path.join(__dirname, 'schema.zmodel'), 'utf8'), 'postgresql', 'cal-com'),
        ).resolves.toBeTruthy();
    });
});
