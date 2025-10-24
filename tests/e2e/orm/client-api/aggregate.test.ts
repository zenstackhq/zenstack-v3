import type { ClientContract } from '@zenstackhq/orm';
import { createTestClient } from '@zenstackhq/testtools';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { schema } from '../schemas/basic';
import { createUser } from './utils';

describe('Client aggregate tests', () => {
    let client: ClientContract<typeof schema>;

    beforeEach(async () => {
        client = await createTestClient(schema);
    });

    afterEach(async () => {
        await client?.$disconnect();
    });

    it('works with count', async () => {
        await createUser(client, 'u1@test.com', { name: 'User1' });
        await createUser(client, 'u2@test.com', { name: null });

        // count
        const r1 = await client.user.aggregate({
            _count: true,
        });
        expect(r1._count).toBe(2);

        const r2 = await client.user.aggregate({
            _count: { _all: true, name: true },
        });
        expect(r2._count._all).toBe(2);
        expect(r2._count.name).toBe(1);
    });

    it('works with filter', async () => {
        await createUser(client, 'u1@test.com', { name: 'User1' });
        await createUser(client, 'u2@test.com', { name: null });

        await expect(
            client.user.aggregate({
                _count: true,
                where: { email: { contains: 'u1' } },
            }),
        ).resolves.toMatchObject({ _count: 1 });
    });

    it('works with skip, take, orderBy', async () => {
        await createUser(client, 'u1@test.com', { name: 'User1' });
        await createUser(client, 'u2@test.com', { name: 'User2' });
        await createUser(client, 'u3@test.com', { name: 'User3' });

        await expect(
            client.user.aggregate({
                _count: true,
                skip: 1,
                take: 1,
            }),
        ).resolves.toMatchObject({ _count: 1 });

        await expect(
            client.user.aggregate({
                _count: true,
                orderBy: { name: 'asc' },
            }),
        ).resolves.toMatchObject({ _count: 3 });

        await expect(
            client.user.aggregate({
                _count: true,
                take: -2,
            }),
        ).resolves.toMatchObject({ _count: 2 });
    });

    it('works with sum and avg', async () => {
        await client.profile.create({ data: { age: 10, bio: 'Bio1' } });
        await client.profile.create({ data: { age: 20, bio: 'Bio2' } });
        await expect(
            client.profile.aggregate({
                _avg: { age: true },
                _sum: { age: true },
            }),
        ).resolves.toMatchObject({
            _avg: { age: 15 },
            _sum: { age: 30 },
        });

        client.user.aggregate({
            // @ts-expect-error
            _sum: { name: true },
        });
    });

    it('works with min and max', async () => {
        await client.profile.create({ data: { age: 10, bio: 'Bio1' } });
        await client.profile.create({ data: { age: 20, bio: 'Bio2' } });
        const r = await client.profile.aggregate({
            _min: { age: true, bio: true },
            _max: { age: true, bio: true },
        });

        expect(r._min.age).toBe(10);
        expect(r._max.age).toBe(20);
        expect(r._min.bio).toBe('Bio1');
        expect(r._max.bio).toBe('Bio2');
    });

    it('works with scalar orderBy', async () => {
        await createUser(client, 'u1@test.com', {
            name: 'Admin',
            role: 'ADMIN',
        });
        await createUser(client, 'u2@test.com', {
            name: 'User',
            role: 'USER',
        });
        await createUser(client, 'u3@test.com', {
            name: null,
            role: 'USER',
        });

        await expect(
            client.user.aggregate({
                orderBy: {
                    role: 'desc',
                },
                take: 2,
                _count: {
                    name: true,
                },
            }),
        ).resolves.toMatchObject({
            _count: {
                name: 1,
            },
        });

        await expect(
            client.user.aggregate({
                orderBy: {
                    name: { sort: 'asc', nulls: 'last' },
                },
                take: 2,
                _count: {
                    name: true,
                },
            }),
        ).resolves.toMatchObject({
            _count: {
                name: 2,
            },
        });
    });

    it('works with relation orderBy', async () => {
        await createUser(client, 'u1@test.com', {
            name: 'Admin',
            role: 'ADMIN',
            profile: { create: { bio: 'bio', age: 10 } },
        });
        await createUser(client, 'u2@test.com', {
            name: 'User',
            role: 'USER',
            profile: { create: { bio: 'bio', age: 20 } },
        });
        await createUser(client, 'u3@test.com', {
            name: null,
            role: 'USER',
            profile: { create: { bio: 'bio', age: 30 } },
        });

        await expect(
            client.user.aggregate({
                take: 2,
                orderBy: {
                    profile: { age: 'asc' },
                },
                _count: { name: true },
            }),
        ).resolves.toMatchObject({
            _count: {
                name: 2,
            },
        });

        await expect(
            client.user.aggregate({
                take: 2,
                orderBy: {
                    profile: { age: 'desc' },
                },
                _count: { name: true },
            }),
        ).resolves.toMatchObject({
            _count: {
                name: 1,
            },
        });
    });
});
