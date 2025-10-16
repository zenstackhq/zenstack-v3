import { createPolicyTestClient } from '@zenstackhq/testtools';
import { describe, expect, it } from 'vitest';

describe('Regression for issue #1507', () => {
    it('verifies issue 1507', async () => {
        const db = await createPolicyTestClient(
            `
model User {
    id Int @id @default(autoincrement())
    age Int
}

model Profile {
    id Int @id @default(autoincrement())
    age Int

    @@allow('read', auth().age == age)
}
            `,
        );

        await db.$unuseAll().profile.create({ data: { age: 18 } });
        await db.$unuseAll().profile.create({ data: { age: 20 } });
        await expect(db.$setAuth({ id: 1, age: 18 }).profile.findMany()).resolves.toHaveLength(1);
        await expect(db.$setAuth({ id: 1, age: 18 }).profile.count()).resolves.toBe(1);
    });
});
