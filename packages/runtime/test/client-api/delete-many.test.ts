import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Client } from '../../src/client';
import { getSchema, pushSchema } from '../test-schema';
import { createClientSpecs } from './client-specs';

const PG_DB_NAME = 'client-api-delete-many-tests';

describe.each(createClientSpecs(PG_DB_NAME))(
    'Client deleteMany tests',
    ({ makeClient, provider }) => {
        const schema = getSchema(provider);
        let client: Client<typeof schema>;

        beforeEach(async () => {
            client = await makeClient();
            await pushSchema(client);
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
                })
            ).resolves.toMatchObject({ count: 0 });
            await expect(client.user.findMany()).toResolveWithLength(2);

            // delete one
            await expect(
                client.user.deleteMany({
                    where: { email: 'u1@test.com' },
                })
            ).resolves.toMatchObject({ count: 1 });
            await expect(client.user.findMany()).toResolveWithLength(1);

            // delete all
            await expect(client.user.deleteMany({})).resolves.toMatchObject({
                count: 1,
            });
            await expect(client.user.findMany()).toResolveWithLength(0);
        });
    }
);
