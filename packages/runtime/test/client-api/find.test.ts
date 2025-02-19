import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Client } from '../../src/client';
import { NotFoundError } from '../../src/client/errors';
import { getSchema, pushSchema } from '../test-schema';
import { createClientSpecs } from './client-specs';

const PG_DB_NAME = 'client-api-find-tests';

describe.each(createClientSpecs(PG_DB_NAME))(
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

        async function createUser(email = 'a@b.com') {
            return await client.$qb
                .insertInto('User')
                .values({
                    id: crypto.randomUUID(),
                    email,
                    name: 'User1',
                    role: 'ADMIN',
                    updatedAt: new Date().toISOString(),
                })
                .returningAll()
                .executeTakeFirstOrThrow();
        }

        async function createPosts(authorId: string) {
            await client.$qb
                .insertInto('Post')
                .values({
                    id: crypto.randomUUID(),
                    title: 'Post1',
                    updatedAt: new Date().toISOString(),
                    authorId,
                })
                .execute();
            await client.$qb
                .insertInto('Post')
                .values({
                    id: crypto.randomUUID(),
                    title: 'Post2',
                    updatedAt: new Date().toISOString(),
                    authorId,
                })
                .execute();
        }

        it('works with simple findMany', async () => {
            let r = await client.user.findMany();
            expect(r).toHaveLength(0);

            const user = await createUser();
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
        });

        it('works with simple findUnique', async () => {
            let r = await client.user.findUnique({ where: { id: 'none' } });
            expect(r).toBeNull();

            const user = await createUser();

            r = await client.user.findUnique({ where: { id: user.id } });
            expect(r).toMatchObject({ id: user.id, email: 'a@b.com' });
            r = await client.user.findUnique({ where: { email: 'a@b.com' } });
            expect(r).toMatchObject({ id: user.id, email: 'a@b.com' });

            r = await client.user.findUnique({ where: { id: 'none' } });
            expect(r).toBeNull();
            await expect(
                client.user.findUniqueOrThrow({ where: { id: 'none' } })
            ).rejects.toThrow(NotFoundError);
        });

        it('works with simple findFirst', async () => {
            let r = await client.user.findFirst({ where: { name: 'User1' } });
            expect(r).toBeNull();

            const user = await createUser();

            r = await client.user.findFirst({ where: { name: 'User1' } });
            expect(r).toMatchObject({ id: user.id, email: 'a@b.com' });

            r = await client.user.findFirst({ where: { name: 'User2' } });
            expect(r).toBeNull();
            await expect(
                client.user.findFirstOrThrow({ where: { name: 'User2' } })
            ).rejects.toThrow(NotFoundError);
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
                email: 'a@b.com',
                createdAt: expect.any(Date),
            });
        });

        it('supports kysely expression builder', async () => {
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
