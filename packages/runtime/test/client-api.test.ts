import { beforeEach, describe, expect, it } from 'vitest';
import { makeClient } from '../src/client';
import { pushSchema, Schema } from './test-schema';
import type { DBClient } from '../src/client/types';

describe('Client API tests', () => {
    let client: DBClient<typeof Schema>;

    // const client = makeClient(Schema);

    beforeEach(async () => {
        client = makeClient(Schema);
        await pushSchema(client.$db);
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
        const user = await client.user.create({
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
        console.log(user);
    });

    it('works with simple findUnique', async () => {
        const r1 = await client.user.findUnique({
            where: {
                id: '1',
            },
        });
        console.log(r1?.email);
        console.log(r1?.role);

        await client.user.findUnique({
            where: {
                email: 'abc@def.com',
            },
        });

        const r2 = await client.user.findUnique({
            where: {
                email: 'abc@def.com',
            },
            select: { name: true },
        });
        console.log(r2?.name);

        await client.user.findUnique({
            where: {
                email: 'abc@def.com',
                name: 'abc',
            },
        });

        const r3 = await client.user.findUnique({
            include: { posts: true },
        });
        console.log(r3?.posts.length);

        await client.foo.findUnique({
            where: {
                id1_id2: { id1: 1, id2: 2 },
            },
        });

        await client.foo.findUnique({
            where: {
                id1_id2: { id1: 1, id2: 2 },
                id1: 1,
            },
        });
    });

    it('works with simple findMany', async () => {
        const r1 = await client.user.findMany();
        console.log(r1[0]?.email);

        const r2 = await client.user.findMany({
            where: {
                email: 'abc@def.com',
            },
            select: {
                name: true,
                posts: true,
            },
        });
        console.log(r2[0]?.name);
        console.log(r2[0]?.posts.length);

        const r3 = await client.user.findMany({
            include: { posts: true },
        });
        console.log(r3[0]?.posts.length);
    });

    it('create', async () => {
        const user1 = await client.user.create({
            data: {
                email: 'a@b.com',
                name: 'name',
            },
        });
        console.log(user1.email);

        await client.user.create({
            data: {
                email: 'b@c.com',
                posts: {
                    createMany: {
                        data: [{ title: 'Post1' }],
                        skipDuplicates: true,
                    },
                },
            },
        });

        client.post.create({
            data: {
                title: 'Post1',
                author: {
                    create: { email: 'abc' },
                },
            },
        });

        client.post.create({
            data: {
                title: 'Post1',
                author: {
                    connect: { email: 'abc' },
                },
            },
        });

        client.post.create({
            data: {
                title: 'Post1',
                author: {
                    connectOrCreate: {
                        where: { id: '1' },
                        create: { email: 'abc' },
                    },
                },
            },
        });

        await client.post.create({
            data: {
                title: 'Post1',
                authorId: user1.id,
            },
        });

        const r2 = await client.user.create({
            data: {
                email: 'a@b.com',
                name: 'Alice',
                posts: {
                    create: {
                        title: 'Post1',
                    },
                },
            },
            include: { posts: true },
        });
        console.log(r2.email);
        console.log(r2.posts.length);
    });
});
