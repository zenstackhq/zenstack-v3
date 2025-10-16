import { afterEach, describe, expect, it } from 'vitest';
import { createTestClient } from '@zenstackhq/testtools';

describe('One-to-many relation tests ', () => {
    let client: any;

    afterEach(async () => {
        await client?.$disconnect();
    });

    it('works with unnamed one-to-many relation', async () => {
        client = await createTestClient(
            `
            model User {
                id Int @id @default(autoincrement())
                name String
                posts Post[]
            }

            model Post {
                id Int @id @default(autoincrement())
                title String
                user User @relation(fields: [userId], references: [id])
                userId Int
            }
        `,
        );

        await expect(
            client.user.create({
                data: {
                    name: 'User',
                    posts: {
                        create: [{ title: 'Post 1' }, { title: 'Post 2' }],
                    },
                },
                include: { posts: true },
            }),
        ).resolves.toMatchObject({
            name: 'User',
            posts: [expect.objectContaining({ title: 'Post 1' }), expect.objectContaining({ title: 'Post 2' })],
        });
    });

    it('works with named one-to-many relation', async () => {
        client = await createTestClient(
            `
            model User {
                id Int @id @default(autoincrement())
                name String
                posts1 Post[] @relation('userPosts1')
                posts2 Post[] @relation('userPosts2')
            }

            model Post {
                id Int @id @default(autoincrement())
                title String
                user1 User? @relation('userPosts1', fields: [userId1], references: [id])
                user2 User? @relation('userPosts2', fields: [userId2], references: [id])
                userId1 Int?
                userId2 Int?
            }
        `,
        );

        await expect(
            client.user.create({
                data: {
                    name: 'User',
                    posts1: {
                        create: [{ title: 'Post 1' }, { title: 'Post 2' }],
                    },
                    posts2: {
                        create: [{ title: 'Post 3' }, { title: 'Post 4' }],
                    },
                },
                include: { posts1: true, posts2: true },
            }),
        ).resolves.toMatchObject({
            name: 'User',
            posts1: [expect.objectContaining({ title: 'Post 1' }), expect.objectContaining({ title: 'Post 2' })],
            posts2: [expect.objectContaining({ title: 'Post 3' }), expect.objectContaining({ title: 'Post 4' })],
        });
    });
});
