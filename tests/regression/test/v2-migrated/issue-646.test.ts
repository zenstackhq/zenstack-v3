import { loadSchema } from '@zenstackhq/testtools';
import { it } from 'vitest';

it('verifies issue 646', async () => {
    await loadSchema(`
model Example {
    id Int @id
    epsilon Decimal @default(0.00000001)
}
        `);
});
