import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ClientContract } from '../../src/client';
import { schema } from '../schemas/basic';
import { createClientSpecs } from './client-specs';
import { createUser } from './utils';

const PG_DB_NAME = 'client-api-undefined-values-tests';

describe.each(createClientSpecs(PG_DB_NAME))('Client undefined values tests for $provider', ({ createClient }) => {
    let client: ClientContract<typeof schema>;

    beforeEach(async () => {
        client = await createClient();
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
