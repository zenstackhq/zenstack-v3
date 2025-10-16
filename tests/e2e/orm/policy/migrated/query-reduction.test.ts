import { describe, expect, it } from 'vitest';
import { createPolicyTestClient } from '@zenstackhq/testtools';

describe('With Policy: query reduction', () => {
    it('test query reduction', async () => {
        const db = await createPolicyTestClient(
            `
        model User {
            id Int @id @default(autoincrement())
            role String @default("User")
            posts Post[]
            private Boolean @default(false)
            age Int

            @@allow('all', auth() == this)
            @@allow('read', !private)
        }

        model Post {
            id Int @id @default(autoincrement())
            user User @relation(fields: [userId], references: [id])
            userId Int
            title String
            published Boolean @default(false)
            viewCount Int @default(0)

            @@allow('all', auth() == user)
            @@allow('read', published)
        }
        `,
        );

        await db.$unuseAll().user.create({
            data: {
                id: 1,
                role: 'User',
                age: 18,
                posts: {
                    create: [
                        { id: 1, title: 'Post 1' },
                        { id: 2, title: 'Post 2', published: true },
                    ],
                },
            },
        });
        await db.$unuseAll().user.create({
            data: {
                id: 2,
                role: 'Admin',
                age: 28,
                private: true,
                posts: {
                    create: [{ id: 3, title: 'Post 3', viewCount: 100 }],
                },
            },
        });

        const dbUser1 = db.$setAuth({ id: 1 });
        const dbUser2 = db.$setAuth({ id: 2 });

        await expect(
            dbUser1.user.findMany({
                where: { id: 2, AND: { age: { gt: 20 } } },
            }),
        ).resolves.toHaveLength(0);

        await expect(
            dbUser2.user.findMany({
                where: { id: 2, AND: { age: { gt: 20 } } },
            }),
        ).resolves.toHaveLength(1);

        await expect(
            dbUser1.user.findMany({
                where: {
                    AND: { age: { gt: 10 } },
                    OR: [{ age: { gt: 25 } }, { age: { lt: 20 } }],
                    NOT: { private: true },
                },
            }),
        ).resolves.toHaveLength(1);

        await expect(
            dbUser2.user.findMany({
                where: {
                    AND: { age: { gt: 10 } },
                    OR: [{ age: { gt: 25 } }, { age: { lt: 20 } }],
                    NOT: { private: true },
                },
            }),
        ).resolves.toHaveLength(1);

        // to-many relation query
        await expect(
            dbUser1.user.findMany({
                where: { posts: { some: { published: true } } },
            }),
        ).resolves.toHaveLength(1);
        await expect(
            dbUser1.user.findMany({
                where: { posts: { some: { AND: [{ published: true }, { viewCount: { gt: 0 } }] } } },
            }),
        ).resolves.toHaveLength(0);
        await expect(
            dbUser2.user.findMany({
                where: { posts: { some: { AND: [{ published: false }, { viewCount: { gt: 0 } }] } } },
            }),
        ).resolves.toHaveLength(1);
        await expect(
            dbUser1.user.findMany({
                where: { posts: { every: { published: true } } },
            }),
        ).resolves.toHaveLength(0);
        await expect(
            dbUser1.user.findMany({
                where: { posts: { none: { published: true } } },
            }),
        ).resolves.toHaveLength(0);

        // to-one relation query
        await expect(
            dbUser1.post.findMany({
                where: { user: { role: 'Admin' } },
            }),
        ).resolves.toHaveLength(0);
        await expect(
            dbUser1.post.findMany({
                where: { user: { is: { role: 'Admin' } } },
            }),
        ).resolves.toHaveLength(0);
        await expect(
            dbUser1.post.findMany({
                where: { user: { isNot: { role: 'User' } } },
            }),
        ).resolves.toHaveLength(0);
    });
});
