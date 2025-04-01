import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Client } from '../../src/client';
import { QueryError } from '../../src/client/errors';
import { schema } from '../test-schema';
import { createClientSpecs } from './client-specs';

const PG_DB_NAME = 'client-api-create-tests';

describe.each(createClientSpecs(PG_DB_NAME))(
    'Client create tests',
    ({ createClient }) => {
        let client: Client<typeof schema>;

        beforeEach(async () => {
            client = await createClient();
            await client.$pushSchema();
        });

        afterEach(async () => {
            await client?.$disconnect();
        });

        it('works with toplevel create single', async () => {
            const user = await client.user.create({
                data: {
                    email: 'u1@test.com',
                    name: 'name',
                },
            });
            expect(user).toMatchObject({
                id: expect.any(String),
                email: 'u1@test.com',
                name: 'name',
            });
        });

        it('works with nested relation one-to-one, owner side', async () => {
            const user = await client.user.create({
                data: { email: 'u1@test.com' },
            });

            // Post owns the relation, user will be inline created
            const post1 = await client.post.create({
                data: {
                    title: 'Post1',
                    author: {
                        create: { email: 'u2@test.com' },
                    },
                },
                include: { author: true },
            });
            expect(post1.authorId).toBeTruthy();
            expect(post1.author).toMatchObject({ email: 'u2@test.com' });

            // create Post by connecting to existing User via FK
            const post2 = await client.post.create({
                data: { title: 'Post2', authorId: user.id },
            });
            expect(post2).toMatchObject({
                id: expect.any(String),
                title: 'Post2',
                authorId: user.id,
            });

            // create Post by connecting to existing User via relation
            const post3 = await client.post.create({
                data: {
                    title: 'Post3',
                    author: { connect: { id: user.id } },
                },
            });
            expect(post3).toMatchObject({
                id: expect.any(String),
                title: 'Post3',
                authorId: user.id,
            });

            // connectOrCreate - connect
            const post4 = await client.post.create({
                data: {
                    title: 'Post4',
                    author: {
                        connectOrCreate: {
                            where: { email: 'u1@test.com' },
                            create: { email: 'u1@test.com' },
                        },
                    },
                },
            });
            expect(post4).toMatchObject({
                authorId: user.id,
            });

            // connectOrCreate - create
            const post5 = await client.post.create({
                data: {
                    title: 'Post5',
                    author: {
                        connectOrCreate: {
                            where: { email: 'u3@test.com' },
                            create: { email: 'u3@test.com' },
                        },
                    },
                },
                include: { author: true },
            });
            expect(post5.author).toMatchObject({ email: 'u3@test.com' });

            // validate relation connection
            const u1Found = await client.user.findUniqueOrThrow({
                where: { id: user.id },
                include: { posts: true },
            });
            expect(u1Found.posts).toHaveLength(3);
        });

        it('works with nested relation one-to-one, non-owner side', async () => {
            const profile = await client.profile.create({
                data: { bio: 'My bio' },
            });

            // User doesn't own the "profile" relation, profile will be created after user
            const user1 = await client.user.create({
                data: {
                    email: 'u1@test.com',
                    profile: { create: { bio: 'My bio' } },
                },
                include: { profile: true },
            });
            expect(user1.profile?.bio).toBe('My bio');

            // connecting an existing profile
            const user2 = await client.user.create({
                data: {
                    email: 'u2@test.com',
                    name: null, // explicit null
                    profile: { connect: { id: profile.id } },
                },
                include: { profile: true },
            });
            expect(user2.profile?.id).toBe(profile.id);

            // connectOrCreate - connect
            const user3 = await client.user.create({
                data: {
                    email: 'u3@test.com',
                    profile: {
                        connectOrCreate: {
                            where: { id: profile.id },
                            create: { bio: 'My other bio' },
                        },
                    },
                },
                include: { profile: true },
            });
            expect(user3.profile).toMatchObject({
                id: profile.id,
                bio: 'My bio',
            });

            // connectOrCreate - create
            const user4 = await client.user.create({
                data: {
                    email: 'u4@test.com',
                    profile: {
                        connectOrCreate: {
                            where: { id: 'non-existing-id' },
                            create: { bio: 'My other bio' },
                        },
                    },
                },
                include: { profile: true },
            });
            expect(user4.profile).toMatchObject({
                bio: 'My other bio',
            });

            // validate relation connection
            const profileFound = await client.profile.findUniqueOrThrow({
                where: { id: profile.id },
            });
            expect(profileFound.userId).toBe(user3.id);
        });

        it('works with nested relation one-to-one multiple actions', async () => {
            const u1 = await client.user.create({
                data: { email: 'u1@test.com' },
            });

            const post = await client.post.create({
                data: {
                    title: 'Post1',
                    author: {
                        create: { email: 'u2@test.com' },
                        connectOrCreate: {
                            where: { email: 'u1@test.com' },
                            create: { email: 'u2@test.com' },
                        },
                    },
                },
            });

            expect(post.authorId).toBe(u1.id);
            await expect(client.user.findMany()).resolves.toHaveLength(2);
        });

        it('works with nested one to many single action', async () => {
            // singular
            const u1 = await client.user.create({
                data: {
                    email: 'u1@test.com',
                    name: 'name',
                    posts: {
                        create: {
                            title: 'Post1',
                            content: 'My post',
                        },
                    },
                },
                include: { posts: true },
            });
            expect(u1.posts).toHaveLength(1);

            // plural
            const u2 = await client.user.create({
                data: {
                    email: 'u2@test.com',
                    name: 'name',
                    posts: {
                        create: [
                            {
                                title: 'Post2',
                                content: 'My post',
                            },
                            {
                                title: 'Post3',
                                content: 'My post',
                            },
                        ],
                    },
                },
                include: { posts: true },
            });
            expect(u2.posts).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ title: 'Post2' }),
                    expect.objectContaining({ title: 'Post3' }),
                ])
            );

            // mixed create and connect
            const u3 = await client.user.create({
                data: {
                    email: 'u3@test.com',
                    posts: {
                        create: {
                            title: 'Post4',
                            content: 'My post',
                        },
                        connect: [
                            { id: u1.posts[0]!.id },
                            { id: u2.posts[0]!.id },
                        ],
                    },
                },
                include: { posts: true },
            });
            expect(u3.posts).toHaveLength(3);
            expect(u3.posts.map((p) => p.title)).toEqual(
                expect.arrayContaining(['Post1', 'Post2', 'Post4'])
            );
        });

        it('rejects empty relation payload', async () => {
            await expect(
                client.post.create({
                    data: { title: 'Post1', author: {} },
                })
            ).rejects.toThrow('At least one action is required');

            await expect(
                client.user.create({
                    data: {
                        email: 'u1@test.com',
                        posts: {},
                    },
                })
            ).rejects.toThrow(QueryError);
        });
    }
);
