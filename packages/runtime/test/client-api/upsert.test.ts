import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ClientContract } from '../../src/client';
import { schema } from '../schemas/basic';
import { createTestClient } from '../utils';

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
        await expect(
            client.user.upsert({
                where: { id: '1' },
                create: {
                    id: '2',
                    email: 'u2@test.com',
                    name: 'New',
                },
                update: { name: 'Updated' },
                include: { profile: true },
            }),
        ).resolves.toMatchObject({
            id: '1',
            name: 'Updated',
            profile: { bio: 'My bio' },
        });

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
        });
    });
});
