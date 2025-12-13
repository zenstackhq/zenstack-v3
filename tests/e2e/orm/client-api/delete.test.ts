import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ClientContract } from '@zenstackhq/orm';
import { schema } from '../schemas/basic';
import { createTestClient } from '@zenstackhq/testtools';

describe('Client delete tests', () => {
    let client: ClientContract<typeof schema>;

    beforeEach(async () => {
        client = await createTestClient(schema);
    });

    afterEach(async () => {
        await client?.$disconnect();
    });

    it('works with toplevel delete', async () => {
        let user = await client.user.create({
            data: {
                id: '1',
                email: 'u1@test.com',
            },
        });

        // not found
        await expect(
            client.user.delete({
                where: { id: '2' },
            }),
        ).toBeRejectedNotFound();

        // found
        await expect(
            client.user.delete({
                where: { id: user.id },
            }),
        ).resolves.toMatchObject(user);

        // include relations
        user = await client.user.create({
            data: {
                id: '1',
                email: 'u1@test.com',
                profile: {
                    create: { bio: 'Bio' },
                },
            },
        });
        await expect(
            client.user.delete({
                where: { id: user.id },
                include: { profile: true },
            }),
        ).resolves.toMatchObject({
            profile: expect.objectContaining({ bio: 'Bio' }),
        });
    });
});
