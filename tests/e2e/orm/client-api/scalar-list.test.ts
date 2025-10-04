import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestClient } from '@zenstackhq/testtools';

describe('Scalar list tests', () => {
    const schema = `
    model User {
        id String @id @default(cuid())
        name String
        tags String[]
        flags Boolean[]
    }
    `;

    let client: any;

    beforeEach(async () => {
        client = await createTestClient(schema, {
            provider: 'postgresql',
        });
    });

    afterEach(async () => {
        await client?.$disconnect();
    });

    it('works with create', async () => {
        await expect(
            client.user.create({
                data: {
                    name: 'user',
                },
            }),
        ).resolves.toMatchObject({
            tags: [],
        });

        await expect(
            client.user.create({
                data: {
                    name: 'user',
                    tags: [],
                },
            }),
        ).resolves.toMatchObject({
            tags: [],
        });

        await expect(
            client.user.create({
                data: {
                    name: 'user',
                    tags: ['tag1', 'tag2'],
                },
            }),
        ).resolves.toMatchObject({
            tags: ['tag1', 'tag2'],
        });

        await expect(
            client.user.create({
                data: {
                    name: 'user',
                    tags: { set: ['tag1', 'tag2'] },
                },
            }),
        ).resolves.toMatchObject({
            tags: ['tag1', 'tag2'],
        });

        await expect(
            client.user.create({
                data: {
                    name: 'user',
                    flags: [true, false],
                },
            }),
        ).resolves.toMatchObject({ flags: [true, false] });

        await expect(
            client.user.create({
                data: {
                    name: 'user',
                    flags: { set: [true, false] },
                },
            }),
        ).resolves.toMatchObject({ flags: [true, false] });
    });

    it('works with update', async () => {
        const user = await client.user.create({
            data: {
                name: 'user',
                tags: ['tag1', 'tag2'],
            },
        });

        await expect(
            client.user.update({
                where: { id: user.id },
                data: { tags: ['tag3', 'tag4'] },
            }),
        ).resolves.toMatchObject({ tags: ['tag3', 'tag4'] });

        await expect(
            client.user.update({
                where: { id: user.id },
                data: { tags: { set: ['tag5'] } },
            }),
        ).resolves.toMatchObject({ tags: ['tag5'] });

        await expect(
            client.user.update({
                where: { id: user.id },
                data: { tags: { push: 'tag6' } },
            }),
        ).resolves.toMatchObject({ tags: ['tag5', 'tag6'] });

        await expect(
            client.user.update({
                where: { id: user.id },
                data: { tags: { push: [] } },
            }),
        ).resolves.toMatchObject({ tags: ['tag5', 'tag6'] });

        await expect(
            client.user.update({
                where: { id: user.id },
                data: { tags: { push: ['tag7', 'tag8'] } },
            }),
        ).resolves.toMatchObject({ tags: ['tag5', 'tag6', 'tag7', 'tag8'] });

        await expect(
            client.user.update({
                where: { id: user.id },
                data: { tags: { set: [] } },
            }),
        ).resolves.toMatchObject({ tags: [] });
    });

    it('works with filter', async () => {
        const user1 = await client.user.create({
            data: {
                name: 'user1',
                tags: ['tag1', 'tag2'],
            },
        });
        await client.user.create({
            data: {
                name: 'user2',
            },
        });
        const user3 = await client.user.create({
            data: {
                name: 'user3',
                tags: [],
            },
        });

        await expect(
            client.user.findMany({
                where: { tags: { equals: ['tag1', 'tag2'] } },
            }),
        ).resolves.toMatchObject([user1]);

        await expect(
            client.user.findFirst({
                where: { tags: { equals: ['tag1'] } },
            }),
        ).toResolveNull();

        await expect(
            client.user.findMany({
                where: { tags: { has: 'tag1' } },
            }),
        ).resolves.toMatchObject([user1]);

        await expect(
            client.user.findFirst({
                where: { tags: { has: 'tag3' } },
            }),
        ).toResolveNull();

        await expect(
            client.user.findMany({
                where: { tags: { hasSome: ['tag1'] } },
            }),
        ).resolves.toMatchObject([user1]);

        await expect(
            client.user.findMany({
                where: { tags: { hasSome: ['tag1', 'tag3'] } },
            }),
        ).resolves.toMatchObject([user1]);

        await expect(
            client.user.findFirst({
                where: { tags: { hasSome: [] } },
            }),
        ).toResolveNull();

        await expect(
            client.user.findFirst({
                where: { tags: { hasEvery: ['tag3', 'tag4'] } },
            }),
        ).toResolveNull();

        await expect(
            client.user.findMany({
                where: { tags: { hasEvery: ['tag1', 'tag2'] } },
            }),
        ).resolves.toMatchObject([user1]);

        await expect(
            client.user.findFirst({
                where: { tags: { hasEvery: ['tag1', 'tag3'] } },
            }),
        ).toResolveNull();

        await expect(
            client.user.findMany({
                where: { tags: { isEmpty: true } },
            }),
        ).resolves.toEqual([user3]);

        await expect(
            client.user.findMany({
                where: { tags: { isEmpty: false } },
            }),
        ).resolves.toEqual([user1]);
    });
});
