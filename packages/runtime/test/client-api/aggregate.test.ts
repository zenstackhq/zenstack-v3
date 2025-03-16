import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Client } from '../../src/client';
import { getSchema, pushSchema } from '../test-schema';
import { createClientSpecs } from './client-specs';
import { createUser } from './utils';

describe.each(createClientSpecs(__filename, true))(
    'Client aggregate tests',
    ({ makeClient, provider }) => {
        const schema = getSchema(provider);
        let client: Client<typeof schema>;

        beforeEach(async () => {
            client = await makeClient();
            await pushSchema(client);
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
                })
            ).resolves.toMatchObject({ _count: 1 });
        });

        it('works with sum and avg', async () => {
            await client.profile.create({ data: { age: 10, bio: 'Bio1' } });
            await client.profile.create({ data: { age: 20, bio: 'Bio2' } });
            await expect(
                client.profile.aggregate({
                    _avg: { age: true },
                    _sum: { age: true },
                })
            ).resolves.toMatchObject({
                _avg: { age: 15 },
                _sum: { age: 30 },
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
    }
);
