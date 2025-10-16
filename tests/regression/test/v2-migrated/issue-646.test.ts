import { loadSchema } from '@zenstackhq/testtools';
import { describe, it } from 'vitest';

describe('Regression for issue #646', () => {
    it('verifies issue 646', async () => {
        await loadSchema(`
model Example {
    id Int @id
    epsilon Decimal @default(0.00000001)
}
        `);
    });
});
