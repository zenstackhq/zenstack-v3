import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ClientContract } from '../../src/client';
import { schema } from '../test-schema';
import { createClientSpecs } from './client-specs';
import { createUser } from './utils';

describe.each(createClientSpecs(__filename, true))(
    'Client groupBy tests',
    ({ createClient }) => {
        let client: ClientContract<typeof schema>;

        beforeEach(async () => {
            client = await createClient();
            await client.$pushSchema();
        });

        afterEach(async () => {
            await client?.$disconnect();
        });

        it('works with single by', async () => {
            await createUser(client, 'u1@test.com', {
                name: 'Admin',
                role: 'ADMIN',
            });
            await createUser(client, 'u2@test.com', {
                name: 'User',
                role: 'USER',
            });
            await createUser(client, 'u3@test.com', {
                name: 'User',
                role: 'USER',
            });

            await expect(
                client.user.groupBy({
                    by: ['name'],
                    _count: {
                        role: true,
                    },
                })
            ).resolves.toEqual(
                expect.arrayContaining([
                    { name: 'User', _count: { role: 2 } },
                    { name: 'Admin', _count: { role: 1 } },
                ])
            );

            await expect(
                client.user.groupBy({
                    by: ['email'],
                    where: {
                        email: { not: 'u2@test.com' },
                    },
                    orderBy: { email: 'desc' },
                })
            ).resolves.toEqual(
                expect.arrayContaining([
                    { email: 'u3@test.com' },
                    { email: 'u1@test.com' },
                ])
            );

            await expect(
                client.user.groupBy({
                    by: ['name'],
                    _count: true,
                    having: {
                        name: 'User',
                    },
                })
            ).resolves.toEqual(
                expect.arrayContaining([{ name: 'User', _count: 2 }])
            );

            await expect(
                client.user.groupBy({
                    by: ['name'],
                    orderBy: {
                        _count: {
                            role: 'desc',
                        },
                    },
                    _count: true,
                })
            ).resolves.toEqual([
                { name: 'User', _count: 2 },
                { name: 'Admin', _count: 1 },
            ]);
        });
    }
);
