import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ClientContract } from '../../src/client';
import { schema } from '../schemas/basic';
import { createClientSpecs } from './client-specs';

const PG_DB_NAME = 'client-api-create-many-and-return-tests';

describe.each(createClientSpecs(PG_DB_NAME))('Client createManyAndReturn tests', ({ createClient }) => {
    let client: ClientContract<typeof schema>;

    beforeEach(async () => {
        client = await createClient();
    });

    afterEach(async () => {
        await client?.$disconnect();
    });

    it('works with toplevel createManyAndReturn', async () => {
        // empty
        await expect(client.user.createManyAndReturn()).toResolveWithLength(0);

        // single
        await expect(
            client.user.createManyAndReturn({
                data: {
                    email: 'u1@test.com',
                    name: 'name',
                },
            }),
        ).resolves.toEqual([expect.objectContaining({ email: 'u1@test.com', name: 'name' })]);

        // multiple
        let r = await client.user.createManyAndReturn({
            data: [{ email: 'u2@test.com' }, { email: 'u3@test.com' }],
        });
        expect(r).toHaveLength(2);
        expect(r).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ email: 'u2@test.com' }),
                expect.objectContaining({ email: 'u3@test.com' }),
            ]),
        );

        // conflict
        await expect(
            client.user.createManyAndReturn({
                data: [{ email: 'u3@test.com' }, { email: 'u4@test.com' }],
            }),
        ).rejects.toThrow();
        await expect(client.user.findUnique({ where: { email: 'u4@test.com' } })).toResolveNull();

        // skip duplicates
        r = await client.user.createManyAndReturn({
            data: [{ email: 'u3@test.com' }, { email: 'u4@test.com' }],
            skipDuplicates: true,
        });
        expect(r).toHaveLength(1);
        expect(r).toEqual(expect.arrayContaining([expect.objectContaining({ email: 'u4@test.com' })]));
        await expect(client.user.findUnique({ where: { email: 'u4@test.com' } })).toResolveTruthy();
    });

    it('works with select and omit', async () => {
        let r = await client.user.createManyAndReturn({
            data: [{ email: 'u1@test.com', name: 'name' }],
            select: { email: true },
        });
        expect(r[0]!.email).toBe('u1@test.com');
        // @ts-expect-error
        expect(r[0]!.name).toBeUndefined();

        r = await client.user.createManyAndReturn({
            data: [{ email: 'u2@test.com', name: 'name' }],
            omit: { name: true },
        });
        expect(r[0]!.email).toBe('u2@test.com');
        // @ts-expect-error
        expect(r[0]!.name).toBeUndefined();
    });
});
