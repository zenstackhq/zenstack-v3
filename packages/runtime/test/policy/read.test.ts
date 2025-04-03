import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type ClientContract } from '../../src/client';
import { createClientSpecs } from '../client-api/client-specs';
import { schema } from '../test-schema';
import { PolicyPlugin } from '../../src/plugins/policy/plugin';

const PG_DB_NAME = 'policy-read-tests';

describe.each(createClientSpecs(PG_DB_NAME, true))(
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
            const policyPlugin = new PolicyPlugin<typeof schema>();

            const anonClient = client.$use(policyPlugin);
            await expect(anonClient.user.findFirst()).toResolveNull();

            const authClient = client.$use(
                // switch auth context
                policyPlugin.setAuth({
                    id: user.id,
                })
            );
            await expect(authClient.user.findFirst()).resolves.toEqual(user);

            const authClient1 = client.$use(
                // set auth context when creating the plugin
                new PolicyPlugin({ auth: { id: user.id } })
            );
            await expect(authClient1.user.findFirst()).resolves.toEqual(user);
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

            const otherUserClient = client.$use(
                new PolicyPlugin({ auth: { id: '2' } })
            );
            const r = await otherUserClient.user.findFirst({
                include: { posts: true },
            });
            expect(r?.posts).toHaveLength(0);

            const authClient = client.$use(
                new PolicyPlugin({ auth: { id: '1' } })
            );
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

            const authClient = client.$use(
                new PolicyPlugin({ auth: { id: user.id } })
            );
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
