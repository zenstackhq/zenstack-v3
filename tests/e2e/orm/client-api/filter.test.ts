import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ClientContract } from '@zenstackhq/runtime';
import { schema } from '../schemas/basic';
import { createTestClient } from '@zenstackhq/testtools';

describe('Client filter tests ', () => {
    let client: ClientContract<typeof schema>;

    beforeEach(async () => {
        client = await createTestClient(schema);
    });

    afterEach(async () => {
        await client?.$disconnect();
    });

    async function createUser(
        email = 'u1@test.com',
        restFields: any = {
            name: 'User1',
            role: 'ADMIN',
            profile: { create: { bio: 'My bio' } },
        },
    ) {
        return client.user.create({
            data: {
                ...restFields,
                email,
            },
        });
    }

    async function createPosts(authorId: string) {
        return [
            await client.post.create({
                data: { title: 'Post1', published: true, authorId },
            }),
            await client.post.create({
                data: { title: 'Post2', published: false, authorId },
            }),
        ] as const;
    }

    it('supports string filters', async () => {
        const user1 = await createUser('u1@test.com');
        const user2 = await createUser('u2@test.com', { name: null });

        // equals
        await expect(client.user.findFirst({ where: { id: user1.id } })).toResolveTruthy();
        await expect(client.user.findFirst({ where: { id: { equals: user1.id } } })).toResolveTruthy();
        await expect(client.user.findFirst({ where: { id: { equals: '1' } } })).toResolveFalsy();
        await expect(
            client.user.findFirst({
                where: {
                    id: user1.id,
                    name: null,
                },
            }),
        ).toResolveFalsy();
        await expect(
            client.user.findFirst({
                where: {
                    id: user1.id,
                    name: { equals: null },
                },
            }),
        ).toResolveFalsy();
        await expect(
            client.user.findFirst({
                where: {
                    id: user2.id,
                    name: { equals: null },
                },
            }),
        ).toResolveTruthy();

        if (client.$schema.provider.type === 'sqlite') {
            // sqlite: equalities are case-sensitive, match is case-insensitive
            await expect(
                client.user.findFirst({
                    where: { email: { equals: 'u1@Test.com' } },
                }),
            ).toResolveFalsy();

            await expect(
                client.user.findFirst({
                    where: { email: { equals: 'u1@test.com' } },
                }),
            ).toResolveTruthy();

            await expect(
                client.user.findFirst({
                    where: { email: { contains: 'test' } },
                }),
            ).toResolveTruthy();
            await expect(
                client.user.findFirst({
                    where: { email: { contains: 'Test' } },
                }),
            ).toResolveTruthy();

            await expect(
                client.user.findFirst({
                    where: { email: { startsWith: 'u1' } },
                }),
            ).toResolveTruthy();
            await expect(
                client.user.findFirst({
                    where: { email: { startsWith: 'U1' } },
                }),
            ).toResolveTruthy();

            await expect(
                client.user.findFirst({
                    where: {
                        email: { in: ['u1@Test.com'] },
                    },
                }),
            ).toResolveFalsy();
            await expect(
                client.user.findFirst({
                    where: {
                        email: { in: ['u1@test.com'] },
                    },
                }),
            ).toResolveTruthy();
        } else if (client.$schema.provider.type === 'postgresql') {
            // postgresql: default is case-sensitive, but can be toggled with "mode"

            await expect(
                client.user.findFirst({
                    where: { email: { equals: 'u1@Test.com' } },
                }),
            ).toResolveFalsy();
            await expect(
                client.user.findFirst({
                    where: {
                        email: { equals: 'u1@Test.com', mode: 'insensitive' } as any,
                    },
                }),
            ).toResolveTruthy();

            await expect(
                client.user.findFirst({
                    where: {
                        email: { contains: 'u1@Test.com' },
                    },
                }),
            ).toResolveFalsy();
            await expect(
                client.user.findFirst({
                    where: {
                        email: { contains: 'u1@Test.com', mode: 'insensitive' } as any,
                    },
                }),
            ).toResolveTruthy();

            await expect(
                client.user.findFirst({
                    where: {
                        email: { endsWith: 'Test.com' },
                    },
                }),
            ).toResolveFalsy();
            await expect(
                client.user.findFirst({
                    where: {
                        email: { endsWith: 'Test.com', mode: 'insensitive' } as any,
                    },
                }),
            ).toResolveTruthy();

            await expect(
                client.user.findFirst({
                    where: {
                        email: { in: ['u1@Test.com'] },
                    },
                }),
            ).toResolveFalsy();
            await expect(
                client.user.findFirst({
                    where: {
                        email: { in: ['u1@Test.com'], mode: 'insensitive' } as any,
                    },
                }),
            ).toResolveTruthy();
        }

        // in
        await expect(
            client.user.findFirst({
                where: { email: { in: [] } },
            }),
        ).toResolveFalsy();
        await expect(
            client.user.findFirst({
                where: { email: { in: ['u1@test.com', 'u3@test.com'] } },
            }),
        ).toResolveTruthy();
        await expect(
            client.user.findFirst({
                where: { email: { in: ['u3@test.com'] } },
            }),
        ).toResolveFalsy();

        // notIn
        await expect(
            client.user.findFirst({
                where: { email: { notIn: [] } },
            }),
        ).toResolveTruthy();
        await expect(
            client.user.findFirst({
                where: { email: { notIn: ['u1@test.com', 'u2@test.com'] } },
            }),
        ).toResolveFalsy();
        await expect(
            client.user.findFirst({
                where: { email: { notIn: ['u2@test.com'] } },
            }),
        ).toResolveTruthy();

        // lt/gt/lte/gte
        await expect(
            client.user.findMany({
                where: { email: { lt: 'a@test.com' } },
            }),
        ).toResolveWithLength(0);
        await expect(
            client.user.findMany({
                where: { email: { lt: 'z@test.com' } },
            }),
        ).toResolveWithLength(2);
        await expect(
            client.user.findMany({
                where: { email: { lte: 'u1@test.com' } },
            }),
        ).toResolveWithLength(1);
        await expect(
            client.user.findMany({
                where: { email: { lte: 'u2@test.com' } },
            }),
        ).toResolveWithLength(2);
        await expect(
            client.user.findMany({
                where: { email: { gt: 'a@test.com' } },
            }),
        ).toResolveWithLength(2);
        await expect(
            client.user.findMany({
                where: { email: { gt: 'z@test.com' } },
            }),
        ).toResolveWithLength(0);
        await expect(
            client.user.findMany({
                where: { email: { gte: 'u1@test.com' } },
            }),
        ).toResolveWithLength(2);
        await expect(
            client.user.findMany({
                where: { email: { gte: 'u2@test.com' } },
            }),
        ).toResolveWithLength(1);

        // contains
        await expect(
            client.user.findFirst({
                where: { email: { contains: '1@' } },
            }),
        ).toResolveTruthy();
        await expect(
            client.user.findFirst({
                where: { email: { contains: '3@' } },
            }),
        ).toResolveFalsy();

        // startsWith
        await expect(
            client.user.findFirst({
                where: { email: { startsWith: 'u1@' } },
            }),
        ).toResolveTruthy();
        await expect(
            client.user.findFirst({
                where: { email: { startsWith: '1@' } },
            }),
        ).toResolveFalsy();

        // endsWith
        await expect(
            client.user.findFirst({
                where: { email: { endsWith: '@test.com' } },
            }),
        ).toResolveTruthy();
        await expect(
            client.user.findFirst({
                where: { email: { endsWith: '@test' } },
            }),
        ).toResolveFalsy();

        // not
        await expect(
            client.user.findFirst({
                where: { email: { not: { contains: 'test' } } },
            }),
        ).toResolveFalsy();
        await expect(
            client.user.findFirst({
                where: { email: { not: { not: { contains: 'test' } } } },
            }),
        ).toResolveTruthy();
    });

    it('supports numeric filters', async () => {
        await createUser('u1@test.com', {
            profile: { create: { id: '1', age: 20, bio: 'My bio' } },
        });
        await createUser('u2@test.com', {
            profile: { create: { id: '2', bio: 'My bio' } },
        });

        // equals
        await expect(client.profile.findFirst({ where: { age: 20 } })).resolves.toMatchObject({ id: '1' });
        await expect(client.profile.findFirst({ where: { age: { equals: 20 } } })).resolves.toMatchObject({
            id: '1',
        });
        await expect(client.profile.findFirst({ where: { age: { equals: 10 } } })).toResolveFalsy();
        await expect(client.profile.findFirst({ where: { age: null } })).resolves.toMatchObject({ id: '2' });
        await expect(client.profile.findFirst({ where: { age: { equals: null } } })).resolves.toMatchObject({
            id: '2',
        });

        // in
        await expect(client.profile.findFirst({ where: { age: { in: [] } } })).toResolveFalsy();
        await expect(client.profile.findFirst({ where: { age: { in: [20, 21] } } })).resolves.toMatchObject({
            id: '1',
        });
        await expect(client.profile.findFirst({ where: { age: { in: [21] } } })).toResolveFalsy();

        // notIn
        await expect(client.profile.findFirst({ where: { age: { notIn: [] } } })).toResolveTruthy();
        await expect(
            client.profile.findFirst({
                where: { age: { notIn: [20, 21] } },
            }),
        ).toResolveFalsy();
        await expect(client.profile.findFirst({ where: { age: { notIn: [21] } } })).toResolveTruthy();

        // lt/gt/lte/gte
        await expect(client.profile.findMany({ where: { age: { lt: 20 } } })).toResolveWithLength(0);
        await expect(client.profile.findMany({ where: { age: { lt: 21 } } })).toResolveWithLength(1);
        await expect(client.profile.findMany({ where: { age: { lte: 20 } } })).toResolveWithLength(1);
        await expect(client.profile.findMany({ where: { age: { lte: 19 } } })).toResolveWithLength(0);
        await expect(client.profile.findMany({ where: { age: { gt: 20 } } })).toResolveWithLength(0);
        await expect(client.profile.findMany({ where: { age: { gt: 19 } } })).toResolveWithLength(1);
        await expect(client.profile.findMany({ where: { age: { gte: 20 } } })).toResolveWithLength(1);
        await expect(client.profile.findMany({ where: { age: { gte: 21 } } })).toResolveWithLength(0);

        // not
        await expect(
            client.profile.findFirst({
                where: { age: { not: { equals: 20 } } },
            }),
        ).toResolveFalsy();
        await expect(
            client.profile.findFirst({
                where: { age: { not: { not: { equals: 20 } } } },
            }),
        ).toResolveTruthy();
        await expect(
            client.profile.findFirst({
                where: { age: { not: { equals: null } } },
            }),
        ).toResolveTruthy();
        await expect(
            client.profile.findFirst({
                where: { age: { not: { not: { equals: null } } } },
            }),
        ).toResolveTruthy();
    });

    it('supports boolean filters', async () => {
        const user = await createUser('u1@test.com', {
            profile: { create: { id: '1', age: 20, bio: 'My bio' } },
        });
        const [post1, post2] = await createPosts(user.id);

        // equals
        await expect(client.post.findFirst({ where: { published: true } })).resolves.toMatchObject(post1);
        await expect(
            client.post.findFirst({
                where: { published: { equals: false } },
            }),
        ).resolves.toMatchObject(post2);

        // not
        await expect(
            client.post.findFirst({
                where: { published: { not: { equals: true } } },
            }),
        ).resolves.toMatchObject(post2);
        await expect(
            client.post.findFirst({
                where: { published: { not: { not: { equals: true } } } },
            }),
        ).resolves.toMatchObject(post1);
    });

    it('supports date filters', async () => {
        const user1 = await createUser('u1@test.com', {
            createdAt: new Date(),
        });
        const user2 = await createUser('u2@test.com', {
            createdAt: new Date(Date.now() + 1000),
        });

        // equals
        await expect(
            client.user.findFirst({
                where: { createdAt: user2.createdAt },
            }),
        ).resolves.toMatchObject(user2);
        await expect(
            client.user.findFirst({
                where: { createdAt: user2.createdAt.toISOString() },
            }),
        ).resolves.toMatchObject(user2);
        await expect(
            client.user.findFirst({
                where: { createdAt: { equals: user2.createdAt } },
            }),
        ).resolves.toMatchObject(user2);
        await expect(
            client.user.findFirst({
                where: {
                    createdAt: { equals: user2.createdAt.toISOString() },
                },
            }),
        ).resolves.toMatchObject(user2);

        // in
        await expect(client.user.findFirst({ where: { createdAt: { in: [] } } })).toResolveFalsy();
        await expect(
            client.user.findFirst({
                where: { createdAt: { in: [user2.createdAt] } },
            }),
        ).resolves.toMatchObject(user2);
        await expect(
            client.user.findFirst({
                where: {
                    createdAt: { in: [user2.createdAt.toISOString()] },
                },
            }),
        ).resolves.toMatchObject(user2);
        await expect(
            client.user.findFirst({
                where: { createdAt: { in: [new Date()] } },
            }),
        ).toResolveFalsy();

        // notIn
        await expect(client.user.findFirst({ where: { createdAt: { notIn: [] } } })).toResolveTruthy();
        await expect(
            client.user.findFirst({
                where: { createdAt: { notIn: [user1.createdAt] } },
            }),
        ).resolves.toMatchObject(user2);
        await expect(
            client.user.findFirst({
                where: {
                    createdAt: { notIn: [user1.createdAt.toISOString()] },
                },
            }),
        ).resolves.toMatchObject(user2);
        await expect(
            client.user.findFirst({
                where: {
                    createdAt: {
                        notIn: [user1.createdAt, user2.createdAt],
                    },
                },
            }),
        ).toResolveFalsy();

        // lt/gt/lte/gte
        await expect(
            client.user.findFirst({
                where: { createdAt: { lt: user1.createdAt } },
            }),
        ).toResolveFalsy();
        await expect(
            client.user.findFirst({
                where: { createdAt: { lt: user2.createdAt } },
            }),
        ).resolves.toMatchObject(user1);
        await expect(
            client.user.findFirst({
                where: { createdAt: { lte: user1.createdAt } },
            }),
        ).resolves.toMatchObject(user1);
        await expect(
            client.user.findMany({
                where: { createdAt: { lte: user2.createdAt } },
            }),
        ).toResolveWithLength(2);
        await expect(
            client.user.findFirst({
                where: { createdAt: { gt: user2.createdAt } },
            }),
        ).toResolveFalsy();
        await expect(
            client.user.findFirst({
                where: { createdAt: { gt: user1.createdAt } },
            }),
        ).resolves.toMatchObject(user2);
        await expect(
            client.user.findMany({
                where: { createdAt: { gte: user1.createdAt } },
            }),
        ).toResolveWithLength(2);
        await expect(
            client.user.findFirst({
                where: { createdAt: { gte: user2.createdAt } },
            }),
        ).resolves.toMatchObject(user2);

        // not
        await expect(
            client.user.findFirst({
                where: { createdAt: { not: { equals: user1.createdAt } } },
            }),
        ).resolves.toMatchObject(user2);
        await expect(
            client.user.findFirst({
                where: {
                    createdAt: {
                        not: { not: { equals: user1.createdAt } },
                    },
                },
            }),
        ).resolves.toMatchObject(user1);
    });

    it('supports enum filters', async () => {
        await createUser();

        // equals
        await expect(client.user.findFirst({ where: { role: 'ADMIN' } })).toResolveTruthy();
        await expect(client.user.findFirst({ where: { role: 'USER' } })).toResolveFalsy();

        // in
        await expect(client.user.findFirst({ where: { role: { in: [] } } })).toResolveFalsy();
        await expect(client.user.findFirst({ where: { role: { in: ['ADMIN'] } } })).toResolveTruthy();
        await expect(client.user.findFirst({ where: { role: { in: ['USER'] } } })).toResolveFalsy();
        await expect(
            client.user.findFirst({
                where: { role: { in: ['ADMIN', 'USER'] } },
            }),
        ).toResolveTruthy();

        // notIn
        await expect(client.user.findFirst({ where: { role: { notIn: [] } } })).toResolveTruthy();
        await expect(
            client.user.findFirst({
                where: { role: { notIn: ['ADMIN'] } },
            }),
        ).toResolveFalsy();
        await expect(
            client.user.findFirst({
                where: { role: { notIn: ['USER'] } },
            }),
        ).toResolveTruthy();
        await expect(
            client.user.findFirst({
                where: { role: { notIn: ['ADMIN', 'USER'] } },
            }),
        ).toResolveFalsy();

        // not
        await expect(
            client.user.findFirst({
                where: { role: { not: { equals: 'ADMIN' } } },
            }),
        ).toResolveFalsy();
        await expect(
            client.user.findFirst({
                where: { role: { not: { not: { equals: 'ADMIN' } } } },
            }),
        ).toResolveTruthy();
    });

    it('ignores undefined filters', async () => {
        await createUser();
        await expect(client.user.findMany({ where: { id: undefined } })).toResolveWithLength(1);
    });

    // TODO: filter for bigint, decimal, bytes
});
