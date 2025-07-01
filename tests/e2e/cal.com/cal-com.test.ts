import { generateTsSchema } from '@zenstackhq/testtools';
import { describe, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('Cal.com e2e tests', () => {
    it('has a working schema', async () => {
        const generated = await generateTsSchema(
            fs.readFileSync(path.join(__dirname, 'schema.zmodel'), 'utf8'),
            'postgresql',
            'cal-com',
        );
        console.log(generated);
    });
});
