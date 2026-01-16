import { PolicyPlugin } from '@zenstackhq/plugin-policy';
import { type ClientContract } from '@zenstackhq/orm';
import { createTestClient } from '@zenstackhq/testtools';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { schema } from '../schemas/basic';

describe('Read policy tests', () => {
    let client: ClientContract<typeof schema>;

    beforeEach(async () => {
        client = await createTestClient(schema);
    });

    afterEach(async () => {
        await client?.$disconnect();
    });

    it('works with ORM API top-level', async () => {
        const user = await client.user.create({
            data: {
                email: 'a@b.com',
            },
        });

        // anonymous auth context by default
        const anonClient = client.$use(new PolicyPlugin());
        await expect(anonClient.user.findFirst()).toResolveNull();

        const authClient = anonClient.$setAuth({
            id: user.id,
        });
        await expect(authClient.user.findFirst()).resolves.toEqual(user);
    });

    it('works with ORM API nested', async () => {
        await client.user.create({
            data: {
                id: '1',
                email: 'a@b.com',
                posts: {
                    create: {
                        title: 'Post1',
                        content: 'My post',
                        published: false,
                    },
                },
            },
        });

        const anonClient = client.$use(new PolicyPlugin());
        const otherUserClient = anonClient.$setAuth({ id: '2' });
        const r = await otherUserClient.user.findFirst({
            include: { posts: true },
        });
        expect(r?.posts).toHaveLength(0);

        const authClient = anonClient.$setAuth({ id: '1' });
        const r1 = await authClient.user.findFirst({
            include: { posts: true },
        });
        expect(r1?.posts).toHaveLength(1);
    });

    it('works with query builder API', async () => {
        const user = await client.user.create({
            data: {
                email: 'a@b.com',
            },
        });

        const anonClient = client.$use(new PolicyPlugin());
        await expect(anonClient.$qb.selectFrom('User').selectAll().executeTakeFirst()).toResolveFalsy();

        const authClient = anonClient.$setAuth({ id: user.id });
        await expect(authClient.$qb.selectFrom('User').selectAll().executeTakeFirstOrThrow()).toResolveTruthy();
    });
});
