import type { ClientContract } from '@zenstackhq/orm';
import { createTestClient } from '@zenstackhq/testtools';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { schema } from '../schemas/basic';

describe('Client upsert tests', () => {
    let client: ClientContract<typeof schema>;

    beforeEach(async () => {
        client = await createTestClient(schema);
    });

    afterEach(async () => {
        await client?.$disconnect();
    });

    it('works with toplevel upsert', async () => {
        // create
        await expect(
            client.user.upsert({
                where: { id: '1' },
                create: {
                    id: '1',
                    email: 'u1@test.com',
                    name: 'New',
                    profile: { create: { bio: 'My bio' } },
                },
                update: { name: 'Foo' },
                include: { profile: true },
            }),
        ).resolves.toMatchObject({
            id: '1',
            name: 'New',
            profile: { bio: 'My bio' },
        });

        // update
        const r = await client.user.upsert({
            where: { id: '1' },
            create: {
                id: '2',
                email: 'u2@test.com',
                name: 'New',
            },
            update: { name: 'Updated' },
            select: { id: true, name: true },
        });
        expect(r).toMatchObject({
            id: '1',
            name: 'Updated',
        });
        // @ts-expect-error
        expect(r.email).toBeUndefined();

        // id update
        await expect(
            client.user.upsert({
                where: { id: '1' },
                create: {
                    id: '2',
                    email: 'u2@test.com',
                    name: 'New',
                },
                update: { id: '3' },
            }),
        ).resolves.toMatchObject({
            id: '3',
            name: 'Updated',
            email: 'u1@test.com',
        });
    });
});
