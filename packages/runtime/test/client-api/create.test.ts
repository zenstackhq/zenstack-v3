import { beforeEach, describe, expect, it } from 'vitest';
import { makeClient } from '../../src/client';
import type { DBClient } from '../../src/client/types';
import { pushSchema, Schema } from '../test-schema';

describe('Client API create tests', () => {
    let client: DBClient<typeof Schema>;

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
        console.log(user);
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
        console.log(user);
        expect(user).toMatchObject({
            id: expect.any(String),
            email: 'b@c.com',
            name: 'name',
            posts: [{ title: 'Post2' }],
        });
    });
});
