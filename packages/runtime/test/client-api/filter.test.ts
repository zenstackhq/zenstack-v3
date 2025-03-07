import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Client } from '../../src/client';
import { getSchema, pushSchema } from '../test-schema';
import { createClientSpecs } from './client-specs';

const PG_DB_NAME = 'client-api-filter-tests';

describe.each(createClientSpecs(PG_DB_NAME, true))(
    'Client filter tests for $provider',
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

        async function createUser(
            email = 'u1@test.com',
            restFields: any = {
                name: 'User1',
                role: 'ADMIN',
                profile: { create: { bio: 'My bio' } },
            }
        ) {
            return client.user.create({
                data: {
                    ...restFields,
                    email,
                },
            });
        }

        it('supports string filters', async () => {
            const user1 = await createUser('u1@test.com');
            const user2 = await createUser('u2@test.com', { name: null });

            // equals
            await expect(
                client.user.findFirst({ where: { id: user1.id } })
            ).toResolveTruthy();
            await expect(
                client.user.findFirst({ where: { id: { equals: user1.id } } })
            ).toResolveTruthy();
            await expect(
                client.user.findFirst({ where: { id: { equals: '1' } } })
            ).toResolveFalsy();
            await expect(
                client.user.findFirst({
                    where: {
                        id: user1.id,
                        name: null,
                    },
                })
            ).toResolveFalsy();
            await expect(
                client.user.findFirst({
                    where: {
                        id: user1.id,
                        name: { equals: null },
                    },
                })
            ).toResolveFalsy();
            await expect(
                client.user.findFirst({
                    where: {
                        id: user2.id,
                        name: { equals: null },
                    },
                })
            ).toResolveTruthy();

            // case-insensitive
            await expect(
                client.user.findFirst({
                    where: { email: { equals: 'u1@Test.com' } },
                })
            ).toResolveFalsy();
            await expect(
                client.user.findFirst({
                    where: {
                        email: { equals: 'u1@Test.com', mode: 'insensitive' },
                    },
                })
            ).toResolveTruthy();

            // in
            await expect(
                client.user.findFirst({
                    where: { email: { in: [] } },
                })
            ).toResolveFalsy();
            await expect(
                client.user.findFirst({
                    where: { email: { in: ['u1@test.com', 'u3@test.com'] } },
                })
            ).toResolveTruthy();
            await expect(
                client.user.findFirst({
                    where: { email: { in: ['u3@test.com'] } },
                })
            ).toResolveFalsy();

            // notIn
            await expect(
                client.user.findFirst({
                    where: { email: { notIn: [] } },
                })
            ).toResolveTruthy();
            await expect(
                client.user.findFirst({
                    where: { email: { notIn: ['u1@test.com', 'u2@test.com'] } },
                })
            ).toResolveFalsy();
            await expect(
                client.user.findFirst({
                    where: { email: { notIn: ['u2@test.com'] } },
                })
            ).toResolveTruthy();

            // lt/gt/lte/gte
            await expect(
                client.user.findMany({
                    where: { email: { lt: 'a@test.com' } },
                })
            ).toResolveWithLength(0);
            await expect(
                client.user.findMany({
                    where: { email: { lt: 'z@test.com' } },
                })
            ).toResolveWithLength(2);
            await expect(
                client.user.findMany({
                    where: { email: { lte: 'u1@test.com' } },
                })
            ).toResolveWithLength(1);
            await expect(
                client.user.findMany({
                    where: { email: { lte: 'u2@test.com' } },
                })
            ).toResolveWithLength(2);
            await expect(
                client.user.findMany({
                    where: { email: { gt: 'a@test.com' } },
                })
            ).toResolveWithLength(2);
            await expect(
                client.user.findMany({
                    where: { email: { gt: 'z@test.com' } },
                })
            ).toResolveWithLength(0);
            await expect(
                client.user.findMany({
                    where: { email: { gte: 'u1@test.com' } },
                })
            ).toResolveWithLength(2);
            await expect(
                client.user.findMany({
                    where: { email: { gte: 'u2@test.com' } },
                })
            ).toResolveWithLength(1);

            // contains
            await expect(
                client.user.findFirst({
                    where: { email: { contains: '1@' } },
                })
            ).toResolveTruthy();
            await expect(
                client.user.findFirst({
                    where: { email: { contains: '3@' } },
                })
            ).toResolveFalsy();

            // startsWith
            await expect(
                client.user.findFirst({
                    where: { email: { startsWith: 'u1@' } },
                })
            ).toResolveTruthy();
            await expect(
                client.user.findFirst({
                    where: { email: { startsWith: '1@' } },
                })
            ).toResolveFalsy();

            // endsWith
            await expect(
                client.user.findFirst({
                    where: { email: { endsWith: '@test.com' } },
                })
            ).toResolveTruthy();
            await expect(
                client.user.findFirst({
                    where: { email: { endsWith: '@test' } },
                })
            ).toResolveFalsy();

            // not
            await expect(
                client.user.findFirst({
                    where: { email: { not: { contains: 'test' } } },
                })
            ).toResolveFalsy();
            await expect(
                client.user.findFirst({
                    where: { email: { not: { not: { contains: 'test' } } } },
                })
            ).toResolveTruthy();
        });

        it('supports number filters', async () => {
            await createUser('u1@test.com', {
                profile: { create: { id: '1', age: 20, bio: 'My bio' } },
            });
            await createUser('u2@test.com', {
                profile: { create: { id: '2', bio: 'My bio' } },
            });

            // equals
            await expect(
                client.profile.findFirst({ where: { age: 20 } })
            ).resolves.toMatchObject({ id: '1' });
            await expect(
                client.profile.findFirst({ where: { age: { equals: 20 } } })
            ).resolves.toMatchObject({ id: '1' });
            await expect(
                client.profile.findFirst({ where: { age: { equals: 10 } } })
            ).toResolveFalsy();
            await expect(
                client.profile.findFirst({ where: { age: null } })
            ).resolves.toMatchObject({ id: '2' });
            await expect(
                client.profile.findFirst({ where: { age: { equals: null } } })
            ).resolves.toMatchObject({ id: '2' });

            // in
            await expect(
                client.profile.findFirst({ where: { age: { in: [] } } })
            ).toResolveFalsy();
            await expect(
                client.profile.findFirst({ where: { age: { in: [20, 21] } } })
            ).resolves.toMatchObject({ id: '1' });
            await expect(
                client.profile.findFirst({ where: { age: { in: [21] } } })
            ).toResolveFalsy();

            // notIn
            await expect(
                client.profile.findFirst({ where: { age: { notIn: [] } } })
            ).toResolveTruthy();
            await expect(
                client.profile.findFirst({
                    where: { age: { notIn: [20, 21] } },
                })
            ).toResolveFalsy();
            await expect(
                client.profile.findFirst({ where: { age: { notIn: [21] } } })
            ).toResolveTruthy();

            // lt/gt/lte/gte
            await expect(
                client.profile.findMany({ where: { age: { lt: 20 } } })
            ).toResolveWithLength(0);
            await expect(
                client.profile.findMany({ where: { age: { lt: 21 } } })
            ).toResolveWithLength(1);
            await expect(
                client.profile.findMany({ where: { age: { lte: 20 } } })
            ).toResolveWithLength(1);
            await expect(
                client.profile.findMany({ where: { age: { lte: 19 } } })
            ).toResolveWithLength(0);
            await expect(
                client.profile.findMany({ where: { age: { gt: 20 } } })
            ).toResolveWithLength(0);
            await expect(
                client.profile.findMany({ where: { age: { gt: 19 } } })
            ).toResolveWithLength(1);
            await expect(
                client.profile.findMany({ where: { age: { gte: 20 } } })
            ).toResolveWithLength(1);
            await expect(
                client.profile.findMany({ where: { age: { gte: 21 } } })
            ).toResolveWithLength(0);

            // not
            await expect(
                client.profile.findFirst({
                    where: { age: { not: { equals: 20 } } },
                })
            ).toResolveFalsy();
            await expect(
                client.profile.findFirst({
                    where: { age: { not: { not: { equals: 20 } } } },
                })
            ).toResolveTruthy();
            await expect(
                client.profile.findFirst({
                    where: { age: { not: { equals: null } } },
                })
            ).toResolveTruthy();
            await expect(
                client.profile.findFirst({
                    where: { age: { not: { not: { equals: null } } } },
                })
            ).toResolveTruthy();
        });
    }
);
