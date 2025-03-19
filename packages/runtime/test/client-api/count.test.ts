import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Client } from '../../src/client';
import { getSchema, pushSchema } from '../test-schema';
import { createClientSpecs } from './client-specs';

const PG_DB_NAME = 'client-api-count-tests';

describe.each(createClientSpecs(PG_DB_NAME, true))(
    'Client count tests',
    ({ createClient, provider }) => {
        const schema = getSchema(provider);
        let client: Client<typeof schema>;

        beforeEach(async () => {
            client = await createClient();
            await pushSchema(client);
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
                })
            ).resolves.toBe(1);

            // with skip and take
            await expect(
                client.user.count({
                    skip: 1,
                    take: 1,
                })
            ).resolves.toBe(1);
            await expect(
                client.user.count({
                    skip: 10,
                })
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
    }
);
