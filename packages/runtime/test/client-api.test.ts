import { describe, it } from 'vitest';
import { getClient } from '../src/client';
import type { SchemaDef } from '../src/schema';
import { call } from '../src/type-utils';

export const Schema = {
    models: {
        User: {
            fields: {
                id: {
                    type: 'String',
                    default: call('cuid()'),
                },
                email: {
                    type: 'String',
                    unique: true,
                },
                name: {
                    type: 'String',
                    optional: true,
                },
                createdAt: {
                    type: 'DateTime',
                    default: call('now()'),
                },
                updatedAt: {
                    type: 'DateTime',
                    updatedAt: true,
                },
                posts: {
                    type: 'Post',
                    array: true,
                    relation: {
                        opposite: 'author',
                    },
                },
            },
            uniqueFields: {
                id: { type: 'String' },
                email: { type: 'String' },
            },
        },
        Post: {
            fields: {
                id: {
                    type: 'String',
                    default: call('cuid()'),
                },
                createdAt: {
                    type: 'DateTime',
                    default: call('now()'),
                },
                updatedAt: {
                    type: 'DateTime',
                    updatedAt: true,
                },
                title: {
                    type: 'String',
                },
                content: {
                    type: 'String',
                    optional: true,
                },
                published: {
                    type: 'Boolean',
                    default: false,
                },
                author: {
                    type: 'User',
                    relation: {
                        fields: ['authorId'],
                        references: ['id'],
                        opposite: 'posts',
                    },
                },
                authorId: {
                    type: 'String',
                    foreignKeyFor: ['author'],
                },
            },
            uniqueFields: {
                id: { type: 'String' },
            },
        },
        Foo: {
            fields: {
                id1: { type: 'Int' },
                id2: { type: 'Int' },
            },
            uniqueFields: {
                id1_id2: { id1: { type: 'Int' }, id2: { type: 'Int' } },
            },
        },
    },
} as const satisfies SchemaDef;

describe('Client API tests', () => {
    const client = getClient(Schema);

    it('works with simple findUnique', async () => {
        const r1 = await client.user.findUnique({
            where: {
                id: '1',
            },
        });
        console.log(r1?.email);

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

    it('works with simple create', async () => {
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
