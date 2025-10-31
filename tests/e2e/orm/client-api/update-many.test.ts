import type { ClientContract } from '@zenstackhq/orm';
import { createTestClient } from '@zenstackhq/testtools';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { schema } from '../schemas/basic';

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

        await expect(
            client.user.updateManyAndReturn({
                where: { email: 'u1@test.com' },
                data: { name: 'User1-new' },
            }),
        ).resolves.toMatchObject([{ id: '1', name: 'User1-new', email: 'u1@test.com' }]);

        const r1 = await client.user.updateManyAndReturn({
            where: { email: 'u1@test.com' },
            data: { name: 'User1-new1' },
            select: { id: true, name: true },
        });
        expect(r1).toMatchObject([{ id: '1', name: 'User1-new1' }]);
        // @ts-expect-error
        expect(r1[0]!.email).toBeUndefined();
    });
});
