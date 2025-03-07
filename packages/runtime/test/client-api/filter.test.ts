import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Client } from '../../src/client';
import { getSchema, pushSchema } from '../test-schema';
import { createClientSpecs } from './client-specs';

const PG_DB_NAME = 'client-api-find-tests';

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

        async function createPosts(authorId: string) {
            await client.post.create({
                data: { title: 'Post1', published: true, authorId },
            });
            await client.post.create({
                data: { title: 'Post2', published: false, authorId },
            });
        }

        it('string filters', async () => {
            const user = await createUser('u1@test.com');
            await createUser('u2@test.com');

            // equals
            await expect(
                client.user.findFirst({ where: { id: { equals: user.id } } })
            ).toResolveTruthy();
            await expect(
                client.user.findFirst({ where: { id: { equals: '1' } } })
            ).toResolveFalsy();

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
    }
);
