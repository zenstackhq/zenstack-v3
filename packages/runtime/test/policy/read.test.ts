import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type ClientContract } from '../../src/client';
import { PolicyPlugin } from '../../src/plugins/policy/plugin';
import { createClientSpecs } from '../client-api/client-specs';
import { schema } from '../test-schema';

const PG_DB_NAME = 'policy-read-tests';

describe.each(createClientSpecs(PG_DB_NAME))(
    'Read policy tests',
    ({ createClient }) => {
        let client: ClientContract<typeof schema>;

        beforeEach(async () => {
            client = await createClient();
            await client.$pushSchema();
        });

        afterEach(async () => {
            await client?.$disconnect();
        });

        it('works with ORM API top-level', async () => {
            const user = await client.user.create({
                data: {
                    email: 'a@b.com',
                },
            });

            // anonymous auth context by default
            const anonClient = client.$use(new PolicyPlugin());
            await expect(anonClient.user.findFirst()).toResolveNull();

            const authClient = anonClient.$setAuth({
                id: user.id,
            });
            await expect(authClient.user.findFirst()).resolves.toEqual(user);
        });

        it('works with ORM API nested', async () => {
            await client.user.create({
                data: {
                    id: '1',
                    email: 'a@b.com',
                    posts: {
                        create: {
                            title: 'Post1',
                            content: 'My post',
                            published: false,
                        },
                    },
                },
            });

            const anonClient = client.$use(new PolicyPlugin());
            const otherUserClient = anonClient.$setAuth({ id: '2' });
            const r = await otherUserClient.user.findFirst({
                include: { posts: true },
            });
            expect(r?.posts).toHaveLength(0);

            const authClient = anonClient.$setAuth({ id: '1' });
            const r1 = await authClient.user.findFirst({
                include: { posts: true },
            });
            expect(r1?.posts).toHaveLength(1);
        });

        it('works with query builder API', async () => {
            const user = await client.user.create({
                data: {
                    email: 'a@b.com',
                },
            });

            const anonClient = client.$use(new PolicyPlugin());
            await expect(
                anonClient.$qb.selectFrom('User').selectAll().executeTakeFirst()
            ).toResolveFalsy();

            const authClient = anonClient.$setAuth({ id: user.id });
            const foundUser = await authClient.$qb
                .selectFrom('User')
                .selectAll()
                .executeTakeFirstOrThrow();

            if (typeof foundUser.createdAt === 'string') {
                expect(Date.parse(foundUser.createdAt)).toEqual(
                    user.createdAt.getTime()
                );
            } else {
                expect(foundUser.createdAt).toEqual(user.createdAt);
            }
        });
    }
);
