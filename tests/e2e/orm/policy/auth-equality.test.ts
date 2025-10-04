import { createPolicyTestClient } from '@zenstackhq/testtools';
import { describe, expect, it } from 'vitest';

describe('Reference Equality Tests', () => {
    it('works with create and auth equality', async () => {
        const db = await createPolicyTestClient(
            `
model User {
    id1 Int
    id2 Int
    posts Post[]
    @@id([id1, id2])
    @@allow('all', auth() == this)
    @@allow('read', true)
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

        await expect(
            db.post.create({
                data: { authorId1: 1, authorId2: 2, title: 'Post 1' },
            }),
        ).toBeRejectedByPolicy();
        await expect(
            db.post.create({
                data: { author: { connect: { id1_id2: { id1: 1, id2: 2 } } }, title: 'Post 1' },
            }),
        ).toBeRejectedByPolicy();

        await expect(
            db.$setAuth({ id1: 1, id2: 2 }).post.create({
                data: { authorId1: 1, authorId2: 2, title: 'Post 1' },
            }),
        ).resolves.toMatchObject({ title: 'Post 1' });
        await expect(
            db.$setAuth({ id1: 1, id2: 2 }).post.create({
                data: { author: { connect: { id1_id2: { id1: 1, id2: 2 } } }, title: 'Post 2' },
            }),
        ).resolves.toMatchObject({ title: 'Post 2' });
    });

    it('works with create and auth inequality', async () => {
        const db = await createPolicyTestClient(
            `
model User {
    id1 Int
    id2 Int
    posts Post[]
    @@id([id1, id2])
    @@allow('all', auth() != this)
    @@allow('read', true)
}

model Post {
    id Int @id @default(autoincrement())
    title String
    authorId1 Int
    authorId2 Int
    author User @relation(fields: [authorId1, authorId2], references: [id1, id2])
    @@allow('all', auth() != author)
    @@allow('read', true)
}
            `,
        );

        await expect(
            db.$setAuth({ id1: 1, id2: 2 }).user.create({
                data: { id1: 1, id2: 2 },
            }),
        ).toBeRejectedByPolicy();
        await expect(
            db.$setAuth({ id1: 2, id2: 2 }).user.create({
                data: { id1: 1, id2: 2 },
            }),
        ).toResolveTruthy();

        await expect(
            db.$setAuth({ id1: 1, id2: 2 }).post.create({
                data: { authorId1: 1, authorId2: 2, title: 'Post 1' },
            }),
        ).toBeRejectedByPolicy();
        await expect(
            db.$setAuth({ id1: 2, id2: 2 }).post.create({
                data: { authorId1: 1, authorId2: 2, title: 'Post 1' },
            }),
        ).resolves.toMatchObject({ title: 'Post 1' });
    });
});
