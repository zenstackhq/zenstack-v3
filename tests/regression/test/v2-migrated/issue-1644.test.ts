import { createTestClient } from '@zenstackhq/testtools';
import { expect, it } from 'vitest';

// TODO: field-level policy support
it.skip('verifies issue 1644', async () => {
    const db = await createTestClient(
        `
model User {
    id       Int    @id @default(autoincrement())
    email    String @unique @email @length(6, 32) @allow('read', auth() == this)

    // full access to all
    @@allow('all', true)
}
            `,
    );

    await db.$unuseAll().user.create({ data: { id: 1, email: 'a@example.com' } });
    await db.$unuseAll().user.create({ data: { id: 2, email: 'b@example.com' } });

    const authDb = db.$setAuth({ id: 1 });
    await expect(authDb.user.count({ where: { email: { contains: 'example.com' } } })).resolves.toBe(1);
    await expect(authDb.user.findMany({ where: { email: { contains: 'example.com' } } })).resolves.toHaveLength(1);
});
