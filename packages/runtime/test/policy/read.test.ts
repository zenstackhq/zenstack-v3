import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type Client, type PolicySettings } from '../../src/client';
import { createClientSpecs } from '../client-api/client-specs';
import { getSchema, pushSchema } from '../test-schema';

const PG_DB_NAME = 'policy-read-tests';

describe.each(createClientSpecs(PG_DB_NAME, true))(
    'Read policy tests',
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

        const policySettings: PolicySettings<typeof schema> = {
            externalRules: {
                User: {
                    emailFromDomain: (eb, domain) =>
                        eb('email', 'like', `%@${domain}`),
                },
            },
        };

        it('works with ORM API top-level', async () => {
            const user = await client.user.create({
                data: {
                    email: 'a@b.com',
                },
            });

            const anonClient = client.$withFeatures({
                policy: policySettings,
            });
            await expect(anonClient.user.findFirst()).resolves.toBeNull();

            const authClient = client.$withFeatures({
                policy: { ...policySettings, auth: { id: user.id } },
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

            const otherUserClient = client.$withFeatures({
                policy: { ...policySettings, auth: { id: '2' } },
            });
            const r = await otherUserClient.user.findFirst({
                include: { posts: true },
            });
            expect(r?.posts).toHaveLength(0);

            const authClient = client.$withFeatures({
                policy: { ...policySettings, auth: { id: '1' } },
            });
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

            const anonClient = client.$withFeatures({
                policy: policySettings,
            });
            await expect(
                anonClient.$qb.selectFrom('User').selectAll().executeTakeFirst()
            ).resolves.toBeUndefined();

            const authClient = client.$withFeatures({
                policy: { ...policySettings, auth: { id: user.id } },
            });
            await expect(
                authClient.$qb.selectFrom('User').selectAll().executeTakeFirst()
            ).resolves.toEqual(user);
        });
    }
);
