import { describe, expect, it } from 'vitest';
import { createPolicyTestClient } from './utils';

describe('Reference Equality Tests', () => {
    it('works with auth equality', async () => {
        const db = await createPolicyTestClient(
            `
model User {
    id1 Int
    id2 Int
    posts Post[]
    @@id([id1, id2])
    @@allow('all', auth() == this)
}

model Post {
    id Int @id @default(autoincrement())
    title String
    authorId1 Int
    authorId2 Int
    author User @relation(fields: [authorId1, authorId2], references: [id1, id2])
    @@allow('all', auth() == author)
}
            `,
            { log: ['query'] },
        );

        await expect(
            db.user.create({
                data: { id1: 1, id2: 2 },
            }),
        ).toBeRejectedByPolicy();

        await expect(
            db.$setAuth({ id1: 1, id2: 2 }).user.create({
                data: { id1: 1, id2: 2 },
            }),
        ).resolves.toMatchObject({ id1: 1, id2: 2 });
    });
});
