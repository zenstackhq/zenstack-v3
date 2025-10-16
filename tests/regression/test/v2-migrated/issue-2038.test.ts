import { createTestClient } from '@zenstackhq/testtools';
import { describe, expect, it } from 'vitest';

describe('Regression for issue #2038', () => {
    it('verifies issue 2038', async () => {
        const db = await createTestClient(
            `
    model User {
        id Int @id @default(autoincrement())
        flag Boolean
        @@allow('all', true)
    }

    model Post {
        id Int @id @default(autoincrement())
        published Boolean @default(auth().flag)
        @@allow('all', true)
    }
                `,
        );

        const authDb = db.$setAuth({ id: 1, flag: true });
        await expect(authDb.post.create({ data: {} })).resolves.toMatchObject({
            published: true,
        });
    });
});
