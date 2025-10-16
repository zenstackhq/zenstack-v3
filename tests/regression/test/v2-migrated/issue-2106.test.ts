import { createTestClient } from '@zenstackhq/testtools';
import { expect, it } from 'vitest';

it('verifies issue 2106', async () => {
    const db = await createTestClient(
        `
model User {
    id Int @id
    age BigInt
    @@allow('all', true)
}
            `,
    );

    await expect(db.user.create({ data: { id: 1, age: 1n } })).toResolveTruthy();
});
