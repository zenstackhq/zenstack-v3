import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NotFoundError } from '../../src/client/errors';
import type { DBClient } from '../../src/client/types';
import { getSchema, pushSchema } from '../test-schema';
import { createClientSpecs } from './client-specs';

const PG_DB_NAME = 'client-api-find-tests';

describe.each(createClientSpecs(PG_DB_NAME))(
    'Client find tests for $provider',
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

        async function createUser() {
            return await client.$db
                .insertInto('User')
                .values({
                    id: '1',
                    email: 'a@b.com',
                    name: 'User1',
                    updatedAt: new Date().toISOString(),
                })
                .returningAll()
                .executeTakeFirstOrThrow();
        }

        async function createPosts(authorId: string) {
            await client.$db
                .insertInto('Post')
                .values({
                    id: '1',
                    title: 'Post1',
                    updatedAt: new Date().toISOString(),
                    authorId,
                })
                .execute();
            await client.$db
                .insertInto('Post')
                .values({
                    id: '2',
                    title: 'Post2',
                    updatedAt: new Date().toISOString(),
                    authorId,
                })
                .execute();
        }

        it('works with simple findMany', async () => {
            let r = await client.user.findMany();
            expect(r).toHaveLength(0);

            await createUser();

            r = await client.user.findMany();
            expect(r).toHaveLength(1);
            r = await client.user.findMany({ where: { id: '1' } });
            expect(r).toHaveLength(1);

            r = await client.user.findMany({ where: { id: '2' } });
            expect(r).toHaveLength(0);
        });

        it('works with simple findUnique', async () => {
            let r = await client.user.findUnique({ where: { id: '1' } });
            expect(r).toBeNull();

            await createUser();

            r = await client.user.findUnique({ where: { id: '1' } });
            expect(r).toMatchObject({ id: '1', email: 'a@b.com' });
            r = await client.user.findUnique({ where: { email: 'a@b.com' } });
            expect(r).toMatchObject({ id: '1', email: 'a@b.com' });

            r = await client.user.findUnique({ where: { id: '2' } });
            expect(r).toBeNull();
            await expect(
                client.user.findUniqueOrThrow({ where: { id: '2' } })
            ).rejects.toThrow(NotFoundError);
        });

        it('works with simple findFirst', async () => {
            let r = await client.user.findFirst({ where: { name: 'User1' } });
            expect(r).toBeNull();

            await createUser();

            r = await client.user.findFirst({ where: { name: 'User1' } });
            expect(r).toMatchObject({ id: '1', email: 'a@b.com' });

            r = await client.user.findFirst({ where: { name: 'User2' } });
            expect(r).toBeNull();
            await expect(
                client.user.findFirstOrThrow({ where: { name: 'User2' } })
            ).rejects.toThrow(NotFoundError);
        });

        it('works with simple findFirst', async () => {
            let r = await client.user.findFirst({ where: { name: 'User1' } });
            expect(r).toBeNull();

            await createUser();

            r = await client.user.findFirst({ where: { name: 'User1' } });
            expect(r).toMatchObject({ id: '1', email: 'a@b.com' });
            r = await client.user.findFirst({ where: { name: 'User2' } });
            expect(r).toBeNull();
        });

        it('works with field selection', async () => {
            const user = await createUser();
            await createPosts(user.id);

            let r = await client.user.findUnique({
                where: { id: '1' },
                select: { id: true, email: true, posts: true },
            });
            expect(r?.id).toBeTruthy();
            expect(r?.email).toBeTruthy();
            expect('name' in r!).toBeFalsy();
            expect(r?.posts).toHaveLength(2);

            await expect(
                client.user.findUnique({
                    where: { id: '1' },
                    select: { id: true, email: true },
                    include: { posts: true },
                } as any)
            ).rejects.toThrow('cannot be used together');

            const r1 = await client.user.findUnique({
                where: { id: '1' },
                include: { posts: { include: { author: true } } },
            });
            expect(r1!.posts[0]!.author).toMatchObject({
                id: '1',
                email: 'a@b.com',
            });
        });
    }
);
