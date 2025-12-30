import type { ClientContract } from '@zenstackhq/orm';
import type { SchemaDef } from '@zenstackhq/orm/schema';
import { createTestClient } from '@zenstackhq/testtools';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RestApiHandler } from '../../src/api/rest';

describe('Procedures E2E', () => {
    let client: ClientContract<SchemaDef>;
    let api: RestApiHandler;

    const schema = `
datasource db {
    provider = 'sqlite'
    url = 'file:./test.db'
}

model User {
    id Int @id @default(autoincrement())
    email String @unique
}

procedure greet(name: String?): String
mutation procedure createTwoAndFail(email1: String, email2: String): Int
`;

    beforeEach(async () => {
        client = await createTestClient(schema, {
            procedures: {
                greet: async (_db, name?: string) => `hello ${name ?? 'world'}`,
                createTwoAndFail: async (db, email1: string, email2: string) => {
                    await db.user.create({ data: { email: email1 } });
                    await db.user.create({ data: { email: email2 } });
                    throw new Error('boom');
                },
            },
        });

        api = new RestApiHandler({
            schema: client.$schema,
            endpoint: 'http://localhost/api',
            pageSize: 5,
        });
    });

    afterEach(async () => {
        await client?.$disconnect();
    });

    it('supports $procs and $procedures routes', async () => {
        const r1 = await api.handleRequest({
            client,
            method: 'get',
            path: '/$procs/greet',
            query: { q: JSON.stringify('alice') },
        });
        expect(r1.status).toBe(200);
        expect(r1.body).toEqual({ data: 'hello alice' });

        const r2 = await api.handleRequest({
            client,
            method: 'get',
            path: '/$procedures/greet',
            query: { q: JSON.stringify('bob') },
        });
        expect(r2.status).toBe(200);
        expect(r2.body).toEqual({ data: 'hello bob' });
    });

    it('returns 422 for invalid input', async () => {
        const r = await api.handleRequest({
            client,
            method: 'get',
            path: '/$procs/greet',
            query: { q: JSON.stringify(123) },
        });

        expect(r.status).toBe(422);
        expect(r.body).toMatchObject({
            errors: [
                {
                    status: 422,
                    code: 'validation-error',
                    rejectedByValidation: true,
                    reason: 'invalid-input',
                },
            ],
        });
    });

    it('rolls back mutation procedures on error', async () => {
        const r = await api.handleRequest({
            client,
            method: 'post',
            path: '/$procs/createTwoAndFail',
            requestBody: ['a@a.com', 'b@b.com'],
        });

        expect(r.status).toBe(500);
        expect(r.body).toMatchObject({
            errors: [
                {
                    status: 500,
                    code: 'unknown-error',
                    detail: 'boom',
                },
            ],
        });

        const users = await client.user.findMany();
        expect(users).toHaveLength(0);
    });
});
