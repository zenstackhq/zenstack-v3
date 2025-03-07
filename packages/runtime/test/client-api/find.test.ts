import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Client } from '../../src/client';
import { NotFoundError } from '../../src/client/errors';
import { getSchema, pushSchema } from '../test-schema';
import { createClientSpecs } from './client-specs';

const PG_DB_NAME = 'client-api-find-tests';

describe.each(createClientSpecs(PG_DB_NAME, true))(
    'Client find tests for $provider',
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

        it('returns correct data rows', async () => {
            let r = await client.user.findMany();
            expect(r).toHaveLength(0);

            const user = await createUser('u1@test.com');
            await createPosts(user.id);

            r = await client.user.findMany();
            expect(r).toHaveLength(1);
            expect(r[0]?.createdAt).toBeInstanceOf(Date);
            r = await client.user.findMany({ where: { id: user.id } });
            expect(r).toHaveLength(1);

            const post = await client.post.findFirst();
            expect(post?.published).toBeTypeOf('boolean');

            r = await client.user.findMany({ where: { id: 'none' } });
            expect(r).toHaveLength(0);

            await createUser('u2@test.com');

            await expect(client.user.findMany()).resolves.toHaveLength(2);
            await expect(
                client.user.findMany({ where: { email: 'u2@test.com' } })
            ).resolves.toHaveLength(1);
        });

        it('works with take and skip', async () => {
            await createUser('u1@test.com');
            await createUser('u2@test.com');
            await createUser('u3@test.com');

            // take
            await expect(
                client.user.findMany({ take: 1 })
            ).resolves.toHaveLength(1);
            await expect(
                client.user.findMany({ take: 2 })
            ).resolves.toHaveLength(2);
            await expect(
                client.user.findMany({ take: 4 })
            ).resolves.toHaveLength(3);

            // skip
            await expect(
                client.user.findMany({ skip: 1 })
            ).resolves.toHaveLength(2);
            await expect(
                client.user.findMany({ skip: 2 })
            ).resolves.toHaveLength(1);

            // take + skip
            await expect(
                client.user.findMany({ take: 1, skip: 1 })
            ).resolves.toHaveLength(1);
            await expect(
                client.user.findMany({ take: 3, skip: 2 })
            ).resolves.toHaveLength(1);
        });

        it('works with orderBy', async () => {
            await createUser('u1@test.com', { role: 'USER', name: null });
            await createUser('u2@test.com', { role: 'ADMIN', name: 'User2' });

            await expect(
                client.user.findFirst({ orderBy: { email: 'asc' } })
            ).resolves.toMatchObject({ email: 'u1@test.com' });

            await expect(
                client.user.findFirst({ orderBy: { email: 'desc' } })
            ).resolves.toMatchObject({ email: 'u2@test.com' });

            // multiple sorting conditions in one object
            await expect(
                client.user.findFirst({
                    orderBy: { role: 'asc', email: 'desc' },
                })
            ).resolves.toMatchObject({ email: 'u2@test.com' });

            // multiple sorting conditions in array
            await expect(
                client.user.findFirst({
                    orderBy: [{ role: 'asc' }, { email: 'desc' }],
                })
            ).resolves.toMatchObject({ email: 'u2@test.com' });

            // null first
            await expect(
                client.user.findFirst({
                    orderBy: { name: { sort: 'asc', nulls: 'first' } },
                })
            ).resolves.toMatchObject({ email: 'u1@test.com' });

            // null last
            await expect(
                client.user.findFirst({
                    orderBy: { name: { sort: 'asc', nulls: 'last' } },
                })
            ).resolves.toMatchObject({ email: 'u2@test.com' });

            // TODO: nested sorting

            // TODO: relation sorting
        });

        it('works with unique finds', async () => {
            let r = await client.user.findUnique({ where: { id: 'none' } });
            expect(r).toBeNull();

            const user = await createUser();

            r = await client.user.findUnique({ where: { id: user.id } });
            expect(r).toMatchObject({ id: user.id, email: 'u1@test.com' });
            r = await client.user.findUnique({
                where: { email: 'u1@test.com' },
            });
            expect(r).toMatchObject({ id: user.id, email: 'u1@test.com' });

            r = await client.user.findUnique({ where: { id: 'none' } });
            expect(r).toBeNull();
            await expect(
                client.user.findUniqueOrThrow({ where: { id: 'none' } })
            ).rejects.toThrow(NotFoundError);
        });

        it('works with non-unique finds', async () => {
            let r = await client.user.findFirst({ where: { name: 'User1' } });
            expect(r).toBeNull();

            const user = await createUser();

            r = await client.user.findFirst({ where: { name: 'User1' } });
            expect(r).toMatchObject({ id: user.id, email: 'u1@test.com' });

            r = await client.user.findFirst({ where: { name: 'User2' } });
            expect(r).toBeNull();
            await expect(
                client.user.findFirstOrThrow({ where: { name: 'User2' } })
            ).rejects.toThrow(NotFoundError);
        });

        it('works with boolean composition', async () => {
            const user1 = await createUser('u1@test.com');
            const user2 = await createUser('u2@test.com');

            // AND
            await expect(
                client.user.findMany({ where: { AND: [] } })
            ).resolves.toHaveLength(2);
            await expect(
                client.user.findFirst({
                    where: {
                        AND: { id: user1.id },
                    },
                })
            ).resolves.toMatchObject(user1);
            await expect(
                client.user.findFirst({
                    where: {
                        AND: [{ id: user1.id }],
                    },
                })
            ).resolves.toMatchObject(user1);
            await expect(
                client.user.findFirst({
                    where: {
                        AND: [{ id: user1.id, email: 'u1@test.com' }],
                    },
                })
            ).resolves.toMatchObject(user1);
            await expect(
                client.user.findFirst({
                    where: {
                        AND: [{ id: user1.id }, { email: 'u1@test.com' }],
                    },
                })
            ).resolves.toMatchObject(user1);
            await expect(
                client.user.findFirst({
                    where: {
                        AND: [{ id: user1.id, email: 'u2@test.com' }],
                    },
                })
            ).toResolveFalsy();

            // OR
            await expect(
                client.user.findMany({ where: { OR: [] } })
            ).resolves.toHaveLength(0);
            await expect(
                client.user.findFirst({
                    where: {
                        OR: [{ id: user1.id }],
                    },
                })
            ).resolves.toMatchObject(user1);
            await expect(
                client.user.findFirst({
                    where: {
                        OR: [{ id: user1.id, email: 'u2@test.com' }],
                    },
                })
            ).toResolveFalsy();
            await expect(
                client.user.findMany({
                    where: {
                        OR: [{ id: user1.id }, { email: 'u2@test.com' }],
                    },
                })
            ).resolves.toHaveLength(2);
            await expect(
                client.user.findFirst({
                    where: {
                        OR: [{ id: 'foo', email: 'bar' }],
                    },
                })
            ).toResolveFalsy();

            // NOT
            await expect(
                client.user.findMany({ where: { NOT: [] } })
            ).resolves.toHaveLength(0);
            await expect(
                client.user.findFirst({
                    where: {
                        NOT: { id: user1.id },
                    },
                })
            ).resolves.toMatchObject(user2);
            await expect(
                client.user.findFirst({
                    where: {
                        NOT: [{ id: user1.id }],
                    },
                })
            ).resolves.toMatchObject(user2);
            await expect(
                client.user.findFirst({
                    where: {
                        NOT: [{ id: user1.id, email: 'u1@test.com' }],
                    },
                })
            ).resolves.toMatchObject(user2);
            await expect(
                client.user.findFirst({
                    where: {
                        NOT: [{ id: user1.id }, { email: 'u1@test.com' }],
                    },
                })
            ).resolves.toMatchObject(user2);
            await expect(
                client.user.findMany({
                    where: {
                        NOT: [{ id: user1.id }, { email: 'foo' }],
                    },
                })
            ).resolves.toHaveLength(2);

            // unique filter
            await expect(
                client.user.findUnique({
                    where: {
                        id: user1.id,
                        AND: [{ email: user1.email }],
                    },
                })
            ).resolves.toMatchObject(user1);
            await expect(
                client.user.findUnique({
                    where: {
                        id: user1.id,
                        AND: [{ email: user2.email }],
                    },
                })
            ).toResolveFalsy();

            // nesting
            await expect(
                client.user.findFirst({
                    where: {
                        AND: {
                            id: user1.id,
                            OR: [{ email: 'foo' }, { email: 'bar' }],
                        },
                    },
                })
            ).toResolveFalsy();
            await expect(
                client.user.findFirst({
                    where: {
                        AND: {
                            id: user1.id,
                            NOT: { OR: [{ email: 'foo' }, { email: 'bar' }] },
                        },
                    },
                })
            ).resolves.toMatchObject(user1);
        });

        it('works with to-many relation filters', async () => {
            const user = await createUser();
            await createPosts(user.id);

            // some
            await expect(
                client.user.findFirst({
                    where: { posts: { some: { title: 'Post1' } } },
                })
            ).toResolveTruthy();
            await expect(
                client.user.findFirst({
                    where: { posts: { some: { title: 'Post3' } } },
                })
            ).toResolveFalsy();

            // every
            await expect(
                client.user.findFirst({
                    where: { posts: { every: { authorId: user.id } } },
                })
            ).toResolveTruthy();
            await expect(
                client.user.findFirst({
                    where: { posts: { every: { published: true } } },
                })
            ).toResolveFalsy();

            // none
            await expect(
                client.user.findFirst({
                    where: { posts: { none: { title: 'Post1' } } },
                })
            ).toResolveFalsy();
            await expect(
                client.user.findFirst({
                    where: { posts: { none: { title: 'Post3' } } },
                })
            ).toResolveTruthy();
        });

        it('works with to-one relation filters', async () => {
            const user1 = await createUser('u1@test.com');
            await createPosts(user1.id);
            const user2 = await createUser('u2@test.com', { profile: null });

            // null check from non-owner side
            await expect(
                client.user.findFirst({
                    where: { profile: null },
                })
            ).resolves.toMatchObject(user2);
            await expect(
                client.user.findFirst({
                    where: { profile: { is: null } },
                })
            ).resolves.toMatchObject(user2);
            await expect(
                client.user.findFirst({
                    where: { profile: { isNot: null } },
                })
            ).resolves.toMatchObject(user1);

            // null check from owner side
            await expect(
                client.profile.findFirst({ where: { user: null } })
            ).toResolveFalsy();
            await expect(
                client.profile.findFirst({ where: { user: { is: null } } })
            ).toResolveFalsy();
            await expect(
                client.profile.findFirst({ where: { user: { isNot: null } } })
            ).toResolveTruthy();

            // field checks
            await expect(
                client.user.findFirst({
                    where: { profile: { bio: 'My bio' } },
                })
            ).resolves.toMatchObject(user1);
            await expect(
                client.user.findFirst({
                    where: { profile: { bio: 'My other bio' } },
                })
            ).toResolveFalsy();

            // is/isNot
            await expect(
                client.user.findFirst({
                    where: { profile: { is: { bio: 'My bio' } } },
                })
            ).resolves.toMatchObject(user1);
            await expect(
                client.user.findFirst({
                    where: { profile: { isNot: { bio: 'My bio' } } },
                })
            ).resolves.toMatchObject(user2);
            await expect(
                client.user.findMany({
                    where: { profile: { isNot: { bio: 'My other bio' } } },
                })
            ).resolves.toHaveLength(2);
        });

        it('works with field selection', async () => {
            const user = await createUser();
            await createPosts(user.id);

            let r = await client.user.findUnique({
                where: { id: user.id },
                select: { id: true, email: true, posts: true },
            });
            expect(r?.id).toBeTruthy();
            expect(r?.email).toBeTruthy();
            expect('name' in r!).toBeFalsy();
            expect(r?.posts).toHaveLength(2);
            expect(r?.posts[0]?.createdAt).toBeInstanceOf(Date);
            expect(r?.posts[0]?.published).toBeTypeOf('boolean');

            await expect(
                client.user.findUnique({
                    where: { id: user.id },
                    select: { id: true, email: true },
                    include: { posts: true },
                } as any)
            ).rejects.toThrow('cannot be used together');

            const r1 = await client.user.findUnique({
                where: { id: user.id },
                include: { posts: { include: { author: true } } },
            });
            expect(r1!.posts[0]!.author).toMatchObject({
                id: user.id,
                email: 'u1@test.com',
                createdAt: expect.any(Date),
            });
        });

        it('works with including filtered relation', async () => {
            const user = await createUser();
            await createPosts(user.id);

            let r = await client.user.findUniqueOrThrow({
                where: { id: user.id },
                include: { posts: { where: { title: 'Post1' } } },
            });
            expect(r.posts).toHaveLength(1);
            expect(r.posts[0]?.title).toBe('Post1');

            r = await client.user.findUniqueOrThrow({
                where: { id: user.id },
                include: { posts: { where: { published: true } } },
            });
            expect(r.posts).toHaveLength(1);

            r = await client.user.findUniqueOrThrow({
                where: { id: user.id },
                include: { posts: { where: { title: 'Post3' } } },
            });
            expect(r.posts).toHaveLength(0);

            const r1 = await client.post.findFirstOrThrow({
                include: {
                    author: {
                        include: { posts: { where: { title: 'Post1' } } },
                    },
                },
            });
            expect(r1.author.posts).toHaveLength(1);

            let r2 = await client.user.findFirstOrThrow({
                include: {
                    profile: { where: { bio: 'My bio' } },
                },
            });
            expect(r2.profile).toBeTruthy();
            r2 = await client.user.findFirstOrThrow({
                include: {
                    profile: { where: { bio: 'Some bio' } },
                },
            });
            expect(r2.profile).toBeNull();

            await expect(
                client.post.findFirstOrThrow({
                    // @ts-expect-error
                    include: { author: { where: { email: user.email } } },
                })
            ).rejects.toThrow(`Field "author" doesn't support filtering`);
        });

        it('supports $expr', async () => {
            await createUser('yiming@gmail.com');
            await createUser('yiming@zenstack.dev');

            await expect(
                client.user.findMany({
                    where: {
                        role: 'ADMIN',
                        $expr: (eb) => eb('email', 'like', '%@zenstack.dev'),
                    },
                })
            ).resolves.toHaveLength(1);

            await expect(
                client.user.findMany({
                    where: {
                        role: 'USER',
                        $expr: (eb) => eb('email', 'like', '%@zenstack.dev'),
                    },
                })
            ).resolves.toHaveLength(0);
        });
    }
);
