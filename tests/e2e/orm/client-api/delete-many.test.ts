import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ClientContract } from '@zenstackhq/orm';
import { schema } from '../schemas/basic';
import { createTestClient } from '@zenstackhq/testtools';

describe('Client deleteMany tests', () => {
    let client: ClientContract<typeof schema>;

    beforeEach(async () => {
        client = await createTestClient(schema);
    });

    afterEach(async () => {
        await client?.$disconnect();
    });

    it('works with toplevel deleteMany', async () => {
        await client.user.create({
            data: {
                id: '1',
                email: 'u1@test.com',
            },
        });
        await client.user.create({
            data: {
                id: '2',
                email: 'u2@test.com',
            },
        });

        // delete not found
        await expect(
            client.user.deleteMany({
                where: { email: 'u3@test.com' },
            }),
        ).resolves.toMatchObject({ count: 0 });
        await expect(client.user.findMany()).toResolveWithLength(2);

        // delete one
        await expect(
            client.user.deleteMany({
                where: { email: 'u1@test.com' },
            }),
        ).resolves.toMatchObject({ count: 1 });
        await expect(client.user.findMany()).toResolveWithLength(1);

        // delete all
        await expect(client.user.deleteMany()).resolves.toMatchObject({
            count: 1,
        });
        await expect(client.user.findMany()).toResolveWithLength(0);
    });

    it('works with deleteMany with limit', async () => {
        await client.user.create({
            data: { id: '1', email: 'u1@test.com' },
        });
        await client.user.create({
            data: { id: '2', email: 'u2@test.com' },
        });

        await expect(
            client.user.deleteMany({
                where: { email: 'u3@test.com' },
                limit: 1,
            }),
        ).resolves.toMatchObject({ count: 0 });
        await expect(client.user.findMany()).toResolveWithLength(2);

        await expect(
            client.user.deleteMany({
                limit: 1,
            }),
        ).resolves.toMatchObject({ count: 1 });
        await expect(client.user.findMany()).toResolveWithLength(1);
    });
});
