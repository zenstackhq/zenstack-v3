import Sqlite from 'better-sqlite3';
import { SqliteDialect } from 'kysely';
import { beforeEach, describe, expect, it } from 'vitest';
import { makeClient } from '../../src/client';
import { NotFoundError } from '../../src/client/errors';
import type { DBClient } from '../../src/client/types';
import { pushSchema, Schema } from '../test-schema';

describe('Client API find tests', () => {
    let client: DBClient<typeof Schema>;

    beforeEach(async () => {
        client = makeClient(Schema, {
            dialect: new SqliteDialect({
                database: new Sqlite(':memory:'),
            }),
        });
        await pushSchema(client.$db);
    });

    async function createUser() {
        return await client.$db
            .insertInto('user')
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
            .insertInto('post')
            .values({
                id: '1',
                title: 'Post1',
                updatedAt: new Date().toISOString(),
                authorId,
            })
            .execute();
        await client.$db
            .insertInto('post')
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
});
