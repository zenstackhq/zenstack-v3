import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ClientContract } from '../../src/client';
import { schema } from '../schemas/basic';
import { createClientSpecs } from './client-specs';

const PG_DB_NAME = 'client-api-raw-query-tests';

describe.each(createClientSpecs(PG_DB_NAME))('Client raw query tests', ({ createClient, provider }) => {
    let client: ClientContract<typeof schema>;

    beforeEach(async () => {
        client = await createClient();
    });

    afterEach(async () => {
        await client?.$disconnect();
    });

    it('works with executeRaw', async () => {
        await client.user.create({
            data: {
                id: '1',
                email: 'u1@test.com',
            },
        });

        await expect(
            client.$executeRaw`UPDATE "User" SET "email" = ${'u2@test.com'} WHERE "id" = ${'1'}`,
        ).resolves.toBe(1);
        await expect(client.user.findFirst()).resolves.toMatchObject({ email: 'u2@test.com' });
    });

    it('works with executeRawUnsafe', async () => {
        await client.user.create({
            data: {
                id: '1',
                email: 'u1@test.com',
            },
        });

        const sql =
            provider === 'postgresql'
                ? `UPDATE "User" SET "email" = $1 WHERE "id" = $2`
                : `UPDATE "User" SET "email" = ? WHERE "id" = ?`;
        await expect(client.$executeRawUnsafe(sql, 'u2@test.com', '1')).resolves.toBe(1);
        await expect(client.user.findFirst()).resolves.toMatchObject({ email: 'u2@test.com' });
    });

    it('works with queryRaw', async () => {
        await client.user.create({
            data: {
                id: '1',
                email: 'u1@test.com',
            },
        });

        const uid = '1';
        const users = await client.$queryRaw<
            { id: string; email: string }[]
        >`SELECT "User"."id", "User"."email" FROM "User" WHERE "User"."id" = ${uid}`;
        expect(users).toEqual([{ id: '1', email: 'u1@test.com' }]);
    });

    it('works with queryRawUnsafe', async () => {
        await client.user.create({
            data: {
                id: '1',
                email: 'u1@test.com',
            },
        });

        const sql =
            provider === 'postgresql'
                ? `SELECT "User"."id", "User"."email" FROM "User" WHERE "User"."id" = $1`
                : `SELECT "User"."id", "User"."email" FROM "User" WHERE "User"."id" = ?`;
        const users = await client.$queryRawUnsafe<{ id: string; email: string }[]>(sql, '1');
        expect(users).toEqual([{ id: '1', email: 'u1@test.com' }]);
    });
});
