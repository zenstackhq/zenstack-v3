import type { ClientContract } from '@zenstackhq/orm';
import { createTestClient } from '@zenstackhq/testtools';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { schema } from '../schemas/basic';
import { createPosts, createUser } from './utils';

describe('Client groupBy tests', () => {
    let client: ClientContract<typeof schema>;

    beforeEach(async () => {
        client = await createTestClient(schema);
    });

    afterEach(async () => {
        await client?.$disconnect();
    });

    it('works with single by', async () => {
        await createUser(client, 'u1@test.com', {
            id: '1',
            name: 'Admin',
            role: 'ADMIN',
        });
        await createUser(client, 'u2@test.com', {
            id: '2',
            name: 'User',
            role: 'USER',
        });
        await createUser(client, 'u3@test.com', {
            id: '3',
            name: 'User',
            role: 'USER',
        });
        await createPosts(client, '1');

        await expect(
            client.user.groupBy({
                by: ['name'],
                _count: {
                    role: true,
                },
            }),
        ).resolves.toEqual(
            expect.arrayContaining([
                { name: 'User', _count: { role: 2 } },
                { name: 'Admin', _count: { role: 1 } },
            ]),
        );

        await expect(
            client.user.groupBy({
                by: ['email'],
                where: {
                    email: { not: 'u2@test.com' },
                },
                skip: 1,
                take: -1,
                orderBy: { email: 'desc' },
            }),
        ).resolves.toEqual([{ email: 'u3@test.com' }]);

        await expect(
            client.user.groupBy({
                by: ['email'],
                skip: 1,
                take: -2,
                orderBy: { email: 'desc' },
            }),
        ).resolves.toEqual(expect.arrayContaining([{ email: 'u2@test.com' }, { email: 'u3@test.com' }]));

        await expect(
            client.user.groupBy({
                by: ['name'],
                _count: true,
                having: {
                    name: 'User',
                },
            }),
        ).resolves.toEqual(expect.arrayContaining([{ name: 'User', _count: 2 }]));

        await expect(
            client.user.groupBy({
                by: ['name', 'role'],
                orderBy: {
                    _count: {
                        role: 'desc',
                    },
                },
                _count: true,
            }),
        ).resolves.toEqual(
            expect.arrayContaining([
                { name: 'User', role: 'USER', _count: 2 },
                { name: 'Admin', role: 'ADMIN', _count: 1 },
            ]),
        );

        await expect(
            client.post.groupBy({
                by: ['published'],
                _count: true,
            }),
        ).resolves.toEqual(
            expect.arrayContaining([
                { published: true, _count: 1 },
                { published: false, _count: 1 },
            ]),
        );
    });

    it('works with multiple bys', async () => {
        await createUser(client, 'u1@test.com', {
            name: 'Admin1',
            role: 'ADMIN',
        });
        await createUser(client, 'u2@test.com', {
            name: 'Admin2',
            role: 'ADMIN',
        });
        await createUser(client, 'u3@test.com', {
            name: 'User',
            role: 'USER',
        });
        await createUser(client, 'u4@test.com', {
            name: 'User',
            role: 'USER',
        });

        await expect(
            client.user.groupBy({
                by: ['role', 'name'],
                _count: true,
            }),
        ).resolves.toEqual(
            expect.arrayContaining([
                { role: 'ADMIN', name: 'Admin1', _count: 1 },
                { role: 'ADMIN', name: 'Admin2', _count: 1 },
                { role: 'USER', name: 'User', _count: 2 },
            ]),
        );
    });

    it('works with different types of aggregation', async () => {
        await client.profile.create({
            data: {
                id: '1',
                age: 10,
                bio: 'bio',
            },
        });
        await client.profile.create({
            data: {
                id: '2',
                age: 20,
                bio: 'bio',
            },
        });

        await expect(
            client.profile.groupBy({
                by: ['bio'],
                _count: { age: true, id: true },
                _avg: { age: true },
                _sum: { age: true },
                _min: { age: true, id: true },
                _max: { age: true, id: true },
            }),
        ).resolves.toEqual(
            expect.arrayContaining([
                {
                    bio: 'bio',
                    _count: { age: 2, id: 2 },
                    _avg: { age: 15 },
                    _sum: { age: 30 },
                    _min: { age: 10, id: '1' },
                    _max: { age: 20, id: '2' },
                },
            ]),
        );
    });

    it('works with using aggregations in having', async () => {
        await client.profile.create({
            data: {
                id: '1',
                age: 10,
                bio: 'bio1',
            },
        });
        await client.profile.create({
            data: {
                id: '2',
                age: 20,
                bio: 'bio1',
            },
        });
        await client.profile.create({
            data: {
                id: '3',
                age: 30,
                bio: 'bio2',
            },
        });
        await client.profile.create({
            data: {
                id: '4',
                age: 40,
                bio: 'bio2',
            },
        });

        await expect(
            client.profile.groupBy({
                by: ['bio'],
                having: {
                    age: { _avg: { gt: 15, lt: 50 }, _sum: { equals: 70 } },
                },
            }),
        ).resolves.toEqual(expect.arrayContaining([{ bio: 'bio2' }]));
    });

    it('works with using aggregations in orderBy', async () => {
        await client.profile.create({
            data: {
                id: '1',
                age: 10,
                bio: 'bio1',
            },
        });
        await client.profile.create({
            data: {
                id: '2',
                age: 20,
                bio: 'bio1',
            },
        });
        await client.profile.create({
            data: {
                id: '3',
                age: 30,
                bio: 'bio2',
            },
        });
        await client.profile.create({
            data: {
                id: '4',
                age: 40,
                bio: 'bio2',
            },
        });

        await expect(
            client.profile.groupBy({
                by: ['bio'],
                orderBy: {
                    _avg: {
                        age: 'desc',
                    },
                },
            }),
        ).resolves.toEqual(expect.arrayContaining([{ bio: 'bio2' }]));
    });

    it('complains about fields in having that are not in by', async () => {
        await expect(
            client.profile.groupBy({
                by: ['bio'],
                having: {
                    age: 10,
                },
            }),
        ).rejects.toThrow(/must be in "by"/);
    });

    it('complains about fields in orderBy that are not in by', async () => {
        await expect(
            client.profile.groupBy({
                by: ['bio'],
                orderBy: {
                    age: 'asc',
                },
            }),
        ).rejects.toThrow(/must be in "by"/);
    });
});
