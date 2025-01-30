import { beforeEach, describe, expect, it } from 'vitest';
import { makeClient } from '../../src/client';
import type { DBClient } from '../../src/client/types';
import { pushSchema, Schema } from '../test-schema';
import { NotFoundError } from '../../src/client/errors';

describe('Client API find tests', () => {
    let client: DBClient<typeof Schema>;

    beforeEach(async () => {
        client = makeClient(Schema);
        await pushSchema(client.$db);
    });

    it('works with simple findMany', async () => {
        let r = await client.user.findMany();
        expect(r).toHaveLength(0);

        await client.$db
            .insertInto('user')
            .values({
                id: '1',
                email: 'a@b.com',
                updatedAt: new Date().toISOString(),
            })
            .execute();

        r = await client.user.findMany();
        expect(r).toHaveLength(1);
        r = await client.user.findMany({ where: { id: '1' } });
        expect(r).toHaveLength(1);

        r = await client.user.findMany({ where: { id: '2' } });
        expect(r).toHaveLength(0);
    });

    it('works with simple findUnique', async () => {
        let r = await client.user.findUnique({ where: { id: '1' } });
        expect(r).toBeNull();

        await client.$db
            .insertInto('user')
            .values({
                id: '1',
                email: 'a@b.com',
                updatedAt: new Date().toISOString(),
            })
            .execute();

        r = await client.user.findUnique({ where: { id: '1' } });
        expect(r).toMatchObject({ id: '1', email: 'a@b.com' });
        r = await client.user.findUnique({ where: { email: 'a@b.com' } });
        expect(r).toMatchObject({ id: '1', email: 'a@b.com' });

        r = await client.user.findUnique({ where: { id: '2' } });
        expect(r).toBeNull();
        await expect(
            client.user.findUniqueOrThrow({ where: { id: '2' } })
        ).rejects.toThrow(NotFoundError);
    });

    it('works with simple findFirst', async () => {
        let r = await client.user.findFirst({ where: { name: 'User1' } });
        expect(r).toBeNull();

        await client.$db
            .insertInto('user')
            .values({
                id: '1',
                email: 'a@b.com',
                name: 'User1',
                updatedAt: new Date().toISOString(),
            })
            .execute();

        r = await client.user.findFirst({ where: { name: 'User1' } });
        expect(r).toMatchObject({ id: '1', email: 'a@b.com' });

        r = await client.user.findFirst({ where: { name: 'User2' } });
        expect(r).toBeNull();
        await expect(
            client.user.findFirstOrThrow({ where: { name: 'User2' } })
        ).rejects.toThrow(NotFoundError);
    });

    it('works with simple findFirst', async () => {
        let r = await client.user.findFirst({ where: { name: 'User1' } });
        expect(r).toBeNull();

        await client.$db
            .insertInto('user')
            .values({
                id: '1',
                email: 'a@b.com',
                name: 'User1',
                updatedAt: new Date().toISOString(),
            })
            .execute();
        r = await client.user.findFirst({ where: { name: 'User1' } });
        expect(r).toMatchObject({ id: '1', email: 'a@b.com' });
        r = await client.user.findFirst({ where: { name: 'User2' } });
        expect(r).toBeNull();
    });
});
