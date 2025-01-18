import { describe, it } from 'vitest';
import { getClient } from '../src/client';
import type { SchemaDef } from '../src/schema';
import { call } from '../src/utils';

export const Schema = {
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
        await client.user.findMany();

        await client.user.findMany({
            where: {
                email: 'abc@def.com',
            },
        });

        await client.user.findUnique({
            where: {
                email: 'abc@def.com',
                name: 'abc',
            },
        });

        await client.user.findUnique({
            where: {
                id: '1',
            },
        });

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

    it('works with simple create', async () => {
        const user = await client.user.create({
            data: {
                email: 'a@b.com',
                name: 'Alice',
            },
        });
        console.log(user.email);
        const user1 = await client.user.create({
            data: {
                email: 'a@b.com',
                name: 'Alice',
            },
            select: {
                name: true,
            },
        });
        console.log(user1.name);
        const user2 = await client.user.create({
            data: {
                email: 'a@b.com',
                name: 'Alice',
            },
            include: { posts: true },
        });
        console.log(user2.name);
        console.log(user2.posts);
    });
});
