import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Client } from '../../src/client';
import { getSchema, pushSchema } from '../test-schema';
import { createClientSpecs } from './client-specs';

const PG_DB_NAME = 'client-api-update-many-tests';

describe.each(createClientSpecs(PG_DB_NAME))(
    'Client updateMany tests',
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

        it('works with toplevel updateMany', async () => {
            // nothing to update
            await expect(
                client.user.updateMany({ data: {} })
            ).resolves.toMatchObject({
                count: 0,
            });

            // nothing to update
            await expect(
                client.user.updateMany({ data: { name: 'Foo' } })
            ).resolves.toMatchObject({
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
                })
            ).resolves.toMatchObject({ count: 0 });
            await expect(
                client.user.findUnique({ where: { id: '1' } })
            ).resolves.toMatchObject({ name: 'User1' });

            // match all
            await expect(
                client.user.updateMany({
                    data: { name: 'Foo' },
                })
            ).resolves.toMatchObject({ count: 2 });
            await expect(
                client.user.findUnique({ where: { id: '1' } })
            ).resolves.toMatchObject({ name: 'Foo' });
            await expect(
                client.user.findUnique({ where: { id: '2' } })
            ).resolves.toMatchObject({ name: 'Foo' });

            // match one
            await expect(
                client.user.updateMany({
                    where: { id: '1' },
                    data: { name: 'Bar' },
                })
            ).resolves.toMatchObject({ count: 1 });
            await expect(
                client.user.findUnique({ where: { id: '1' } })
            ).resolves.toMatchObject({ name: 'Bar' });
            await expect(
                client.user.findUnique({ where: { id: '2' } })
            ).resolves.toMatchObject({ name: 'Foo' });

            // limit
            await expect(
                client.user.updateMany({
                    data: { name: 'Baz' },
                    limit: 1,
                })
            ).resolves.toMatchObject({ count: 1 });
            await expect(
                client.user.findMany({ where: { name: 'Baz' } })
            ).toResolveWithLength(1);

            // limit with where
            await expect(
                client.user.updateMany({
                    where: { name: 'Zee' },
                    data: { name: 'Baz' },
                    limit: 1,
                })
            ).resolves.toMatchObject({ count: 0 });
        });
    }
);
