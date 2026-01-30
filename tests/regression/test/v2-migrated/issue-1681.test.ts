import { createTestClient } from '@zenstackhq/testtools';
import { describe, expect, it } from 'vitest';

describe('Regression for issue #1681', () => {
    it('verifies issue 1681', async () => {
        const db = await createTestClient(
            `
    model User {
        id Int @id @default(autoincrement())
        posts Post[]
        @@allow('all', true)
    }

    model Post {
        id Int @id @default(autoincrement())
        title String
        author User @relation(fields: [authorId], references: [id])
        authorId Int @default(auth().id)
        @@allow('all', true)
    }
                `,
        );

        const authDb = db.$setAuth({ id: 1 });
        const user = await db.user.create({ data: {} });
        await expect(authDb.post.createMany({ data: [{ title: 'Post1' }] })).resolves.toMatchObject({ count: 1 });

        if (db.$schema.provider.type !== 'mysql') {
            const r = await authDb.post.createManyAndReturn({ data: [{ title: 'Post2' }] });
            expect(r[0].authorId).toBe(user.id);
        }
    });
});
