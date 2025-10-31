import type { ClientContract } from '@zenstackhq/orm';
import type { schema } from '../schemas/basic';

type ClientType = ClientContract<typeof schema>;

export async function createUser(
    client: ClientType,
    email = 'u1@test.com',
    restFields: any = {
        name: 'User1',
        role: 'ADMIN',
        profile: { create: { bio: 'My bio' } },
    },
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
