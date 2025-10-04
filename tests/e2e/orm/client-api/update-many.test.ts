import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ClientContract } from '@zenstackhq/runtime';
import { schema } from '../schemas/basic';
import { createTestClient } from '@zenstackhq/testtools';

describe('Client updateMany tests', () => {
    let client: ClientContract<typeof schema>;

    beforeEach(async () => {
        client = await createTestClient(schema);
    });

    afterEach(async () => {
        await client?.$disconnect();
    });

    it('works with toplevel updateMany', async () => {
        // nothing to update
        await expect(client.user.updateMany({ data: {} })).resolves.toMatchObject({
            count: 0,
        });

        // nothing to update
        await expect(client.user.updateMany({ data: { name: 'Foo' } })).resolves.toMatchObject({
            count: 0,
        });

        await client.user.create({
            data: { id: '1', email: 'u1@test.com', name: 'User1' },
        });
        await client.user.create({
            data: { id: '2', email: 'u2@test.com', name: 'User2' },
        });

        // no matching
        await expect(
            client.user.updateMany({
                where: { email: 'foo' },
                data: { name: 'Foo' },
            }),
        ).resolves.toMatchObject({ count: 0 });
        await expect(client.user.findUnique({ where: { id: '1' } })).resolves.toMatchObject({ name: 'User1' });

        // match all
        await expect(
            client.user.updateMany({
                data: { name: 'Foo' },
            }),
        ).resolves.toMatchObject({ count: 2 });
        await expect(client.user.findUnique({ where: { id: '1' } })).resolves.toMatchObject({ name: 'Foo' });
        await expect(client.user.findUnique({ where: { id: '2' } })).resolves.toMatchObject({ name: 'Foo' });

        // match one
        await expect(
            client.user.updateMany({
                where: { id: '1' },
                data: { name: 'Bar' },
            }),
        ).resolves.toMatchObject({ count: 1 });
        await expect(client.user.findUnique({ where: { id: '1' } })).resolves.toMatchObject({ name: 'Bar' });
        await expect(client.user.findUnique({ where: { id: '2' } })).resolves.toMatchObject({ name: 'Foo' });

        // limit
        await expect(
            client.user.updateMany({
                data: { name: 'Baz' },
                limit: 1,
            }),
        ).resolves.toMatchObject({ count: 1 });
        await expect(client.user.findMany({ where: { name: 'Baz' } })).toResolveWithLength(1);

        // limit with where
        await expect(
            client.user.updateMany({
                where: { name: 'Zee' },
                data: { name: 'Baz' },
                limit: 1,
            }),
        ).resolves.toMatchObject({ count: 0 });
    });

    it('works with updateManyAndReturn', async () => {
        await client.user.create({
            data: { id: '1', email: 'u1@test.com', name: 'User1' },
        });
        await client.user.create({
            data: { id: '2', email: 'u2@test.com', name: 'User2' },
        });

        const r = await client.user.updateManyAndReturn({
            where: { email: 'u1@test.com' },
            data: { name: 'User1-new' },
            select: { id: true, name: true },
        });
        expect(r).toMatchObject([{ id: '1', name: 'User1-new' }]);
        // @ts-expect-error
        expect(r[0]!.email).toBeUndefined();
    });
});
