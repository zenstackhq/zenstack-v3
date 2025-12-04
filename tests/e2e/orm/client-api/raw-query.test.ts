import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ClientContract } from '@zenstackhq/orm';
import { schema } from '../schemas/basic';
import { createTestClient } from '@zenstackhq/testtools';

describe('Client raw query tests', () => {
    let client: ClientContract<typeof schema>;

    beforeEach(async () => {
        client = (await createTestClient(schema)) as any;
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
            // @ts-ignore
            client.$schema.provider.type === 'postgresql'
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
            // @ts-ignore
            client.$schema.provider.type === 'postgresql'
                ? `SELECT "User"."id", "User"."email" FROM "User" WHERE "User"."id" = $1`
                : `SELECT "User"."id", "User"."email" FROM "User" WHERE "User"."id" = ?`;
        const users = await client.$queryRawUnsafe<{ id: string; email: string }[]>(sql, '1');
        expect(users).toEqual([{ id: '1', email: 'u1@test.com' }]);
    });
});
