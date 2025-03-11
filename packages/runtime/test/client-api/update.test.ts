import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Client, CreateArgs } from '../../src/client';
import { getSchema, pushSchema } from '../test-schema';
import { createClientSpecs } from './client-specs';
import { createUser } from './utils';

const PG_DB_NAME = 'client-api-update-tests';

describe.each(createClientSpecs(PG_DB_NAME, true))(
    'Client update tests',
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

        it('works with toplevel update', async () => {
            const user = await createUser(client, 'u1@test.com');

            // not found
            await expect(
                client.user.update({
                    where: { id: 'not-found' },
                    data: { name: 'Foo' },
                })
            ).toResolveNotFound();

            // empty data
            await expect(
                client.user.update({
                    where: { id: user.id },
                    data: {},
                })
            ).resolves.toEqual(user);

            // id as filter
            await expect(
                client.user.update({
                    where: { id: user.id },
                    data: { email: 'u2.test.com', name: 'Foo' },
                })
            ).resolves.toEqual({ ...user, email: 'u2.test.com', name: 'Foo' });

            // non-id unique as filter
            await expect(
                client.user.update({
                    where: { email: 'u2.test.com' },
                    data: { email: 'u2.test.com', name: 'Bar' },
                })
            ).resolves.toEqual({ ...user, email: 'u2.test.com', name: 'Bar' });

            // select
            await expect(
                client.user.update({
                    where: { id: user.id },
                    data: { email: 'u2.test.com', name: 'Bar1' },
                    select: { email: true, name: true },
                })
            ).resolves.toEqual({ email: 'u2.test.com', name: 'Bar1' });

            // include
            const r = await client.user.update({
                where: { id: user.id },
                data: { email: 'u2.test.com', name: 'Bar2' },
                include: { profile: true },
            });
            expect(r.profile).toBeTruthy();
            expect(r.email).toBeTruthy();

            // include + select
            await expect(
                client.user.update({
                    where: { id: user.id },
                    data: { email: 'u2.test.com', name: 'Bar3' },
                    include: { profile: true },
                    select: { email: true, name: true },
                } as any)
            ).rejects.toThrow('cannot be used together');

            // update with non-unique filter
            await expect(
                client.user.update({
                    // @ts-expect-error
                    where: { name: 'Foo' },
                    data: { name: 'Bar' },
                })
            ).rejects.toThrow(
                'At least one unique field or field set must be set'
            );
            await expect(
                client.user.update({
                    where: { id: undefined },
                    data: { name: 'Bar' },
                })
            ).rejects.toThrow(
                'At least one unique field or field set must be set'
            );

            // id update
            await expect(
                client.user.update({
                    where: { id: user.id },
                    data: { id: 'user2' },
                })
            ).resolves.toMatchObject({ id: 'user2' });
        });

        it('works with nested to-many relation create', async () => {
            const user = await createUser(client, 'u1@test.com');

            // create
            await expect(
                client.user.update({
                    where: { id: user.id },
                    data: { posts: { create: { id: '1', title: 'Post1' } } },
                    include: { posts: true },
                })
            ).resolves.toMatchObject({
                posts: [expect.objectContaining({ id: '1', title: 'Post1' })],
            });

            // create multiple
            await expect(
                client.user.update({
                    where: { id: user.id },
                    data: {
                        posts: {
                            create: [
                                { id: '2', title: 'Post2' },
                                { id: '3', title: 'Post3' },
                            ],
                        },
                    },
                    include: { posts: true },
                })
            ).resolves.toSatisfy((r) => r.posts.length === 3);
        });

        it('works with nested to-many relation set', async () => {
            const user = await createUser(client, 'u1@test.com');

            const post = await client.post.create({
                data: {
                    title: 'Post1',
                    author: { connect: { id: user.id } },
                    comments: {
                        create: [
                            { id: '1', content: 'Comment1' },
                            { id: '2', content: 'Comment2' },
                        ],
                    },
                },
            });

            // set empty
            await expect(
                client.post.update({
                    where: { id: post.id },
                    data: { comments: { set: [] } },
                    include: { comments: true },
                })
            ).resolves.toMatchObject({ comments: [] });

            // set single
            await expect(
                client.post.update({
                    where: { id: post.id },
                    data: { comments: { set: { id: '1' } } },
                    include: { comments: true },
                })
            ).resolves.toMatchObject({
                comments: [expect.objectContaining({ id: '1' })],
            });
            await client.post.update({
                where: { id: post.id },
                data: { comments: { set: [] } },
            });

            // set multiple
            await expect(
                client.post.update({
                    where: { id: post.id },
                    data: {
                        comments: {
                            set: [
                                { id: '1' },
                                { id: '2' },
                                { id: '3' }, // non-existing
                            ],
                        },
                    },
                    include: { comments: true },
                })
            ).resolves.toMatchObject({
                comments: [
                    expect.objectContaining({ id: '1' }),
                    expect.objectContaining({ id: '2' }),
                ],
            });
        });

        it('works with nested to-many relation set', async () => {
            const user = await createUser(client, 'u1@test.com');

            const post = await client.post.create({
                data: {
                    title: 'Post1',
                    author: { connect: { id: user.id } },
                    comments: {
                        create: [
                            { id: '1', content: 'Comment1' },
                            { id: '2', content: 'Comment2' },
                        ],
                    },
                },
            });

            // set empty
            await expect(
                client.post.update({
                    where: { id: post.id },
                    data: { comments: { set: [] } },
                    include: { comments: true },
                })
            ).resolves.toMatchObject({ comments: [] });

            // set single
            await expect(
                client.post.update({
                    where: { id: post.id },
                    data: { comments: { set: { id: '1' } } },
                    include: { comments: true },
                })
            ).resolves.toMatchObject({
                comments: [expect.objectContaining({ id: '1' })],
            });
            await client.post.update({
                where: { id: post.id },
                data: { comments: { set: [] } },
            });

            // set multiple
            await expect(
                client.post.update({
                    where: { id: post.id },
                    data: {
                        comments: {
                            set: [
                                { id: '1' },
                                { id: '2' },
                                { id: '3' }, // non-existing
                            ],
                        },
                    },
                    include: { comments: true },
                })
            ).resolves.toMatchObject({
                comments: [
                    expect.objectContaining({ id: '1' }),
                    expect.objectContaining({ id: '2' }),
                ],
            });
        });

        it('works with nested to-many relation simple connect', async () => {
            const user = await createUser(client, 'u1@test.com');
            const post = await client.post.create({
                data: {
                    title: 'Post1',
                    author: { connect: { id: user.id } },
                },
            });
            const comment1 = await client.comment.create({
                data: { id: '1', content: 'Comment1' },
            });
            const comment2 = await client.comment.create({
                data: { id: '2', content: 'Comment2' },
            });

            // connect single
            await expect(
                client.post.update({
                    where: { id: post.id },
                    data: { comments: { connect: { id: comment1.id } } },
                    include: { comments: true },
                })
            ).resolves.toMatchObject({
                comments: [expect.objectContaining({ id: comment1.id })],
            });

            // already  connected
            await expect(
                client.post.update({
                    where: { id: post.id },
                    data: { comments: { connect: { id: comment1.id } } },
                    include: { comments: true },
                })
            ).resolves.toMatchObject({
                comments: [expect.objectContaining({ id: comment1.id })],
            });

            // connect multiple
            await expect(
                client.post.update({
                    where: { id: post.id },
                    data: {
                        comments: {
                            connect: [
                                { id: comment1.id },
                                { id: comment2.id },
                                { id: '3' }, // non-existing
                            ],
                        },
                    },
                    include: { comments: true },
                })
            ).resolves.toMatchObject({
                comments: [
                    expect.objectContaining({ id: comment1.id }),
                    expect.objectContaining({ id: comment2.id }),
                ],
            });
        });

        it('works with nested to-many relation connectOrCreate', async () => {
            const user = await createUser(client, 'u1@test.com');
            const post = await client.post.create({
                data: {
                    title: 'Post1',
                    author: { connect: { id: user.id } },
                },
            });
            const comment1 = await client.comment.create({
                data: { id: '1', content: 'Comment1' },
            });
            const comment2 = await client.comment.create({
                data: { id: '2', content: 'Comment2' },
            });

            // single
            await expect(
                client.post.update({
                    where: { id: post.id },
                    data: {
                        comments: {
                            connectOrCreate: {
                                where: {
                                    id: comment1.id,
                                },
                                create: { content: 'Comment1' },
                            },
                        },
                    },
                    include: { comments: true },
                })
            ).resolves.toMatchObject({
                comments: [expect.objectContaining({ id: comment1.id })],
            });

            // multiple
            await expect(
                client.post.update({
                    where: { id: post.id },
                    data: {
                        comments: {
                            connectOrCreate: [
                                {
                                    // already connected
                                    where: { id: comment1.id },
                                    create: { content: 'Comment1' },
                                },
                                {
                                    // not connected
                                    where: { id: comment2.id },
                                    create: { content: 'Comment2' },
                                },
                                {
                                    // create
                                    where: { id: '3' },
                                    create: { id: '3', content: 'Comment3' },
                                },
                            ],
                        },
                    },
                    include: { comments: true },
                })
            ).resolves.toMatchObject({
                comments: [
                    expect.objectContaining({ id: comment1.id }),
                    expect.objectContaining({ id: comment2.id }),
                    expect.objectContaining({ id: '3' }),
                ],
            });
        });

        it('works with nested to-many relation disconnect', async () => {
            const user = await createUser(client, 'u1@test.com');
            const post = await client.post.create({
                data: {
                    title: 'Post1',
                    author: { connect: { id: user.id } },
                    comments: {
                        create: [
                            { id: '1', content: 'Comment1' },
                            { id: '2', content: 'Comment2' },
                            { id: '3', content: 'Comment3' },
                        ],
                    },
                },
            });

            // single
            await expect(
                client.post.update({
                    where: { id: post.id },
                    data: { comments: { disconnect: { id: '1' } } },
                    include: { comments: true },
                })
            ).resolves.toMatchObject({
                comments: [
                    expect.objectContaining({ id: '2' }),
                    expect.objectContaining({ id: '3' }),
                ],
            });

            // not connected
            await expect(
                client.post.update({
                    where: { id: post.id },
                    data: { comments: { disconnect: { id: '1' } } },
                    include: { comments: true },
                })
            ).resolves.toMatchObject({
                comments: [
                    expect.objectContaining({ id: '2' }),
                    expect.objectContaining({ id: '3' }),
                ],
            });

            // multiple
            await expect(
                client.post.update({
                    where: { id: post.id },
                    data: {
                        comments: {
                            disconnect: [
                                { id: '2' },
                                { id: '3' },
                                { id: '4' }, // non-existing
                            ],
                        },
                    },
                    include: { comments: true },
                })
            ).resolves.toMatchObject({ comments: [] });
        });
    }
);
