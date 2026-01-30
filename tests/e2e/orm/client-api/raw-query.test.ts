import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ClientContract } from '@zenstackhq/orm';
import { schema } from '../schemas/basic';
import { createTestClient } from '@zenstackhq/testtools';
import { sql } from 'kysely';
import { match } from 'ts-pattern';
import type { DataSourceProviderType } from '@zenstackhq/schema';

describe('Client raw query tests', () => {
    let client: ClientContract<typeof schema>;

    beforeEach(async () => {
        client = await createTestClient(schema);
    });

    afterEach(async () => {
        await client?.$disconnect();
    });

    function ref(col: string) {
        return client.$schema.provider.type === ('mysql' as any) ? sql.raw(`\`${col}\``) : sql.raw(`"${col}"`);
    }

    it('works with executeRaw', async () => {
        await client.user.create({
            data: {
                id: '1',
                email: 'u1@test.com',
            },
        });

        await expect(
            client.$executeRaw`UPDATE ${ref('User')} SET ${ref('email')} = ${'u2@test.com'} WHERE ${ref('id')} = ${'1'}`,
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

        const sql = match(client.$schema.provider.type as DataSourceProviderType)
            .with('postgresql', () => `UPDATE "User" SET "email" = $1 WHERE "id" = $2`)
            .with('mysql', () => 'UPDATE `User` SET `email` = ? WHERE `id` = ?')
            .with('sqlite', () => 'UPDATE "User" SET "email" = ? WHERE "id" = ?')
            .exhaustive();
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
        >`SELECT ${ref('User')}.${ref('id')}, ${ref('User')}.${ref('email')} FROM ${ref('User')} WHERE ${ref('User')}.${ref('id')} = ${uid}`;
        expect(users).toEqual([{ id: '1', email: 'u1@test.com' }]);
    });

    it('works with queryRawUnsafe', async () => {
        await client.user.create({
            data: {
                id: '1',
                email: 'u1@test.com',
            },
        });

        const sql = match(client.$schema.provider.type as DataSourceProviderType)
            .with('postgresql', () => `SELECT "User"."id", "User"."email" FROM "User" WHERE "User"."id" = $1`)
            .with('mysql', () => 'SELECT `User`.`id`, `User`.`email` FROM `User` WHERE `User`.`id` = ?')
            .with('sqlite', () => 'SELECT "User"."id", "User"."email" FROM "User" WHERE "User"."id" = ?')
            .exhaustive();

        const users = await client.$queryRawUnsafe<{ id: string; email: string }[]>(sql, '1');
        expect(users).toEqual([{ id: '1', email: 'u1@test.com' }]);
    });
});
