import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ClientContract } from '@zenstackhq/orm';
import { schema } from '../schemas/basic';
import { createTestClient } from '@zenstackhq/testtools';
import { createUser } from './utils';

describe('Client undefined values tests ', () => {
    let client: ClientContract<typeof schema>;

    beforeEach(async () => {
        client = await createTestClient(schema);
    });

    afterEach(async () => {
        await client?.$disconnect();
    });

    it('works with toplevel undefined args', async () => {
        await expect(client.user.findMany(undefined)).toResolveTruthy();
    });

    it('ignored with undefined filter values', async () => {
        const user = await createUser(client, 'u1@test.com');
        await expect(
            client.user.findFirst({
                where: {
                    id: undefined,
                },
            }),
        ).resolves.toMatchObject(user);

        await expect(
            client.user.findFirst({
                where: {
                    email: undefined,
                },
            }),
        ).resolves.toMatchObject(user);
    });
});
