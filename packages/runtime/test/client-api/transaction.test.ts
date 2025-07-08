import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ClientContract } from '../../src/client';
import { schema } from '../test-schema';
import { createClientSpecs } from './client-specs';

const PG_DB_NAME = 'client-api-transaction-tests';

describe.each(createClientSpecs(PG_DB_NAME))('Client raw query tests', ({ createClient }) => {
    let client: ClientContract<typeof schema>;

    beforeEach(async () => {
        client = await createClient();
    });

    afterEach(async () => {
        await client?.$disconnect();
    });

    it('works with simple successful transaction', async () => {
        const users = await client.$transaction(async (tx) => {
            const u1 = await tx.user.create({
                data: {
                    email: 'u1@test.com',
                },
            });
            const u2 = await tx.user.create({
                data: {
                    email: 'u2@test.com',
                },
            });
            return [u1, u2];
        });

        expect(users).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ email: 'u1@test.com' }),
                expect.objectContaining({ email: 'u2@test.com' }),
            ]),
        );

        await expect(client.user.findMany()).toResolveWithLength(2);
    });

    it('works with simple failed transaction', async () => {
        await expect(
            client.$transaction(async (tx) => {
                const u1 = await tx.user.create({
                    data: {
                        email: 'u1@test.com',
                    },
                });
                const u2 = await tx.user.create({
                    data: {
                        email: 'u1@test.com',
                    },
                });
                return [u1, u2];
            }),
        ).rejects.toThrow();

        await expect(client.user.findMany()).toResolveWithLength(0);
    });

    it('works with nested successful transactions', async () => {
        await client.$transaction(async (tx) => {
            const u1 = await tx.user.create({
                data: {
                    email: 'u1@test.com',
                },
            });
            const u2 = await tx.$transaction((tx2) =>
                tx2.user.create({
                    data: {
                        email: 'u2@test.com',
                    },
                }),
            );
            return [u1, u2];
        });

        await expect(client.user.findMany()).toResolveWithLength(2);
    });

    it('works with nested failed transaction', async () => {
        await expect(
            client.$transaction(async (tx) => {
                const u1 = await tx.user.create({
                    data: {
                        email: 'u1@test.com',
                    },
                });
                const u2 = await tx.$transaction((tx2) =>
                    tx2.user.create({
                        data: {
                            email: 'u1@test.com',
                        },
                    }),
                );
                return [u1, u2];
            }),
        ).rejects.toThrow();

        await expect(client.user.findMany()).toResolveWithLength(0);
    });
});
