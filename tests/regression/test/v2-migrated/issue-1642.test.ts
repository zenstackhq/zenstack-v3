import { createPolicyTestClient } from '@zenstackhq/testtools';
import { describe, expect, it } from 'vitest';

describe('Regression for issue #1642', () => {
    it('verifies issue 1642', async () => {
        const db = await createPolicyTestClient(
            `
    model User {
        id Int @id
        name String
        posts Post[]

        @@allow('read', true)
        @@allow('all', auth().id == 1)
    }

    model Post {
        id Int @id
        title String
        description String
        author User @relation(fields: [authorId], references: [id])
        authorId Int

        // delegate all access policies to the author:
        @@allow('all', check(author))
        @@allow('update', true)
        @@allow('post-update', title == 'hello')
    }
                `,
        );

        await db.$unuseAll().user.create({ data: { id: 1, name: 'User1' } });
        await db.$unuseAll().post.create({ data: { id: 1, title: 'hello', description: 'desc1', authorId: 1 } });

        const authDb = db.$setAuth({ id: 2 });
        await expect(
            authDb.post.update({ where: { id: 1 }, data: { title: 'world', description: 'desc2' } }),
        ).toBeRejectedByPolicy();

        await expect(authDb.post.update({ where: { id: 1 }, data: { description: 'desc2' } })).toResolveTruthy();
    });
});
