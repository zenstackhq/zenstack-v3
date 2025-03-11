import type { Client } from '../../src/client';
import type { getSchema } from '../test-schema';

type SchemaType = ReturnType<typeof getSchema>;
type ClientType = Client<SchemaType>;

export async function createUser(
    client: ClientType,
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

export async function createPosts(client: ClientType, authorId: string) {
    return [
        await client.post.create({
            data: { title: 'Post1', published: true, authorId },
        }),
        await client.post.create({
            data: { title: 'Post2', published: false, authorId },
        }),
    ] as const;
}
