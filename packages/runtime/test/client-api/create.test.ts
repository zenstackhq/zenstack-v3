import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DBClient } from '../../src/client/types';
import { getSchema, pushSchema } from '../test-schema';
import { createClientSpecs } from './client-specs';

const PG_DB_NAME = 'client-api-create-tests';

describe.each(createClientSpecs(PG_DB_NAME))(
    'Client create tests',
    ({ makeClient, provider }) => {
        const schema = getSchema(provider);
        let client: DBClient<typeof schema>;

        beforeEach(async () => {
            client = await makeClient();
            await pushSchema(client.$db);
        });

        afterEach(async () => {
            await client.$disconnect();
        });

        it('works with simple create', async () => {
            const user = await client.user.create({
                data: {
                    email: 'a@b.com',
                    name: 'name',
                },
            });
            expect(user).toMatchObject({
                id: expect.any(String),
                email: 'a@b.com',
                name: 'name',
            });
        });

        it('works with nested create', async () => {
            // nested create without include
            let user = await client.user.create({
                data: {
                    email: 'a@b.com',
                    name: 'name',
                    posts: {
                        create: {
                            title: 'Post1',
                            content: 'My post',
                        },
                    },
                },
            });
            // console.log(user);
            expect(user).toMatchObject({
                id: expect.any(String),
                email: 'a@b.com',
                name: 'name',
            });
            expect((user as any).posts).toBeUndefined();

            // nested create with include
            user = await client.user.create({
                data: {
                    email: 'b@c.com',
                    name: 'name',
                    posts: {
                        create: {
                            title: 'Post2',
                            content: 'My post',
                        },
                    },
                },
                include: { posts: true },
            });
            // console.log(user);
            expect(user).toMatchObject({
                id: expect.any(String),
                email: 'b@c.com',
                name: 'name',
                posts: [{ title: 'Post2' }],
            });
        });
    }
);
