import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ClientContract } from '@zenstackhq/orm';
import { schema } from '../schemas/basic';
import { createTestClient } from '@zenstackhq/testtools';

describe('Client count tests', () => {
    let client: ClientContract<typeof schema>;

    beforeEach(async () => {
        client = await createTestClient(schema);
    });

    afterEach(async () => {
        await client?.$disconnect();
    });

    it('works with simple count', async () => {
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

        // without filter
        let r = await client.user.count();
        expect(r).toBe(2);
        expect(r).toBeTypeOf('number');

        r = await client.user.count({ select: true });
        expect(r).toBe(2);
        expect(r).toBeTypeOf('number');

        // with filter
        await expect(
            client.user.count({
                where: {
                    email: {
                        contains: 'u1',
                    },
                },
            }),
        ).resolves.toBe(1);

        // with skip and take
        await expect(
            client.user.count({
                skip: 1,
                take: 1,
            }),
        ).resolves.toBe(1);
        await expect(
            client.user.count({
                skip: 10,
            }),
        ).resolves.toBe(0);
    });

    it('works with field count', async () => {
        await client.user.create({
            data: {
                id: '1',
                email: 'u1@test.com',
                name: 'User1',
            },
        });

        await client.user.create({
            data: {
                id: '2',
                email: 'u2@test.com',
                name: null,
            },
        });

        const r = await client.user.count({
            select: { _all: true, name: true },
        });
        expect(r._all).toBe(2);
        expect(r.name).toBe(1);
    });
});
