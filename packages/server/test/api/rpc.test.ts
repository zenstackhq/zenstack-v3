import { ClientContract } from '@zenstackhq/orm';
import { SchemaDef } from '@zenstackhq/orm/schema';
import { createPolicyTestClient, createTestClient } from '@zenstackhq/testtools';
import Decimal from 'decimal.js';
import SuperJSON from 'superjson';
import { beforeAll, describe, expect, it } from 'vitest';
import {
    RPCBadInputErrorResponse,
    RPCGenericErrorResponse,
    RPCApiHandler,
    type RPCApiHandlerOptions,
} from '../../src/api';
import { schema } from '../utils';

describe('RPC API Handler Tests', () => {
    let client: ClientContract<SchemaDef>;
    let rawClient: ClientContract<SchemaDef>;

    beforeAll(async () => {
        client = await createPolicyTestClient(schema);
        rawClient = client.$unuseAll();
    });

    it('crud', async () => {
        const handleRequest = makeHandler();

        let r = await handleRequest({
            method: 'get',
            path: '/post/findMany',
            client: rawClient,
        });
        expect(r.status).toBe(200);
        expect(r.data).toHaveLength(0);

        r = await handleRequest({
            method: 'post',
            path: '/user/create',
            query: {},
            requestBody: {
                include: { posts: true },
                data: {
                    id: 'user1',
                    email: 'user1@abc.com',
                    posts: {
                        create: [
                            { title: 'post1', published: true, viewCount: 1 },
                            { title: 'post2', published: false, viewCount: 2 },
                        ],
                    },
                },
            },
            client: rawClient,
        });
        expect(r.status).toBe(201);
        expect(r.data).toEqual(
            expect.objectContaining({
                email: 'user1@abc.com',
                posts: expect.arrayContaining([
                    expect.objectContaining({ title: 'post1' }),
                    expect.objectContaining({ title: 'post2' }),
                ]),
            }),
        );

        r = await handleRequest({
            method: 'get',
            path: '/post/findMany',
            client: rawClient,
        });
        expect(r.status).toBe(200);
        expect(r.data).toHaveLength(2);

        r = await handleRequest({
            method: 'get',
            path: '/post/findMany',
            query: { q: JSON.stringify({ where: { viewCount: { gt: 1 } } }) },
            client: rawClient,
        });
        expect(r.status).toBe(200);
        expect(r.data).toHaveLength(1);

        r = await handleRequest({
            method: 'put',
            path: '/user/update',
            requestBody: { where: { id: 'user1' }, data: { email: 'user1@def.com' } },
            client: rawClient,
        });
        expect(r.status).toBe(200);
        expect(r.data.email).toBe('user1@def.com');

        r = await handleRequest({
            method: 'get',
            path: '/post/count',
            query: { q: JSON.stringify({ where: { viewCount: { gt: 1 } } }) },
            client: rawClient,
        });
        expect(r.status).toBe(200);
        expect(r.data).toBe(1);

        r = await handleRequest({
            method: 'get',
            path: '/post/aggregate',
            query: { q: JSON.stringify({ _sum: { viewCount: true } }) },
            client: rawClient,
        });
        expect(r.status).toBe(200);
        expect(r.data._sum.viewCount).toBe(3);

        r = await handleRequest({
            method: 'get',
            path: '/post/groupBy',
            query: { q: JSON.stringify({ by: ['published'], _sum: { viewCount: true } }) },
            client: rawClient,
        });
        expect(r.status).toBe(200);
        expect(r.data).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ published: true, _sum: { viewCount: 1 } }),
                expect.objectContaining({ published: false, _sum: { viewCount: 2 } }),
            ]),
        );

        r = await handleRequest({
            method: 'delete',
            path: '/user/deleteMany',
            query: { q: JSON.stringify({ where: { id: 'user1' } }) },
            client: rawClient,
        });
        expect(r.status).toBe(200);
        expect(r.data.count).toBe(1);
    });

    it('pagination and ordering', async () => {
        const handleRequest = makeHandler();

        // Clean up any existing data first
        await rawClient.post.deleteMany();
        await rawClient.user.deleteMany();

        // Create test data
        await rawClient.user.create({
            data: {
                id: 'user1',
                email: 'user1@abc.com',
                posts: {
                    create: [
                        { id: '1', title: 'A Post', published: true, viewCount: 5 },
                        { id: '2', title: 'B Post', published: true, viewCount: 3 },
                        { id: '3', title: 'C Post', published: true, viewCount: 7 },
                        { id: '4', title: 'D Post', published: true, viewCount: 1 },
                        { id: '5', title: 'E Post', published: true, viewCount: 9 },
                    ],
                },
            },
        });

        // Test orderBy with title ascending
        let r = await handleRequest({
            method: 'get',
            path: '/post/findMany',
            query: { q: JSON.stringify({ orderBy: { title: 'asc' } }) },
            client: rawClient,
        });
        expect(r.status).toBe(200);
        expect(r.data).toHaveLength(5);
        expect(r.data[0].title).toBe('A Post');
        expect(r.data[4].title).toBe('E Post');

        // Test orderBy with viewCount descending
        r = await handleRequest({
            method: 'get',
            path: '/post/findMany',
            query: { q: JSON.stringify({ orderBy: { viewCount: 'desc' } }) },
            client: rawClient,
        });
        expect(r.status).toBe(200);
        expect(r.data[0].viewCount).toBe(9);
        expect(r.data[4].viewCount).toBe(1);

        // Test multiple orderBy
        r = await handleRequest({
            method: 'get',
            path: '/post/findMany',
            query: { q: JSON.stringify({ orderBy: [{ published: 'desc' }, { title: 'asc' }] }) },
            client: rawClient,
        });
        expect(r.status).toBe(200);
        expect(r.data[0].title).toBe('A Post');

        // Test take (limit)
        r = await handleRequest({
            method: 'get',
            path: '/post/findMany',
            query: { q: JSON.stringify({ take: 3 }) },
            client: rawClient,
        });
        expect(r.status).toBe(200);
        expect(r.data).toHaveLength(3);

        // Test skip (offset)
        r = await handleRequest({
            method: 'get',
            path: '/post/findMany',
            query: { q: JSON.stringify({ skip: 2, take: 2 }) },
            client: rawClient,
        });
        expect(r.status).toBe(200);
        expect(r.data).toHaveLength(2);

        // Test skip and take with orderBy
        r = await handleRequest({
            method: 'get',
            path: '/post/findMany',
            query: { q: JSON.stringify({ orderBy: { title: 'asc' }, skip: 1, take: 3 }) },
            client: rawClient,
        });
        expect(r.status).toBe(200);
        expect(r.data).toHaveLength(3);
        expect(r.data[0].title).toBe('B Post');
        expect(r.data[2].title).toBe('D Post');

        // Test cursor-based pagination
        r = await handleRequest({
            method: 'get',
            path: '/post/findMany',
            query: { q: JSON.stringify({ orderBy: { id: 'asc' }, take: 2 }) },
            client: rawClient,
        });
        expect(r.status).toBe(200);
        expect(r.data).toHaveLength(2);
        const lastId = r.data[1].id;

        // Get next page using cursor
        r = await handleRequest({
            method: 'get',
            path: '/post/findMany',
            query: { q: JSON.stringify({ orderBy: { id: 'asc' }, take: 2, skip: 1, cursor: { id: lastId } }) },
            client: rawClient,
        });
        expect(r.status).toBe(200);
        expect(r.data).toHaveLength(2);
        expect(r.data[0].id).toBe('3');
        expect(r.data[1].id).toBe('4');

        // Clean up
        await rawClient.post.deleteMany();
        await rawClient.user.deleteMany();
    });

    it('policy violation', async () => {
        // Clean up any existing data first
        await rawClient.post.deleteMany();
        await rawClient.user.deleteMany();

        await rawClient.user.create({
            data: {
                id: '1',
                email: 'user1@abc.com',
                posts: { create: { id: '1', title: 'post1', published: true } },
            },
        });

        const handleRequest = makeHandler();

        let r = await handleRequest({
            method: 'post',
            path: '/post/create',
            requestBody: {
                data: { id: '2', title: 'post2', authorId: '1', published: false },
            },
            client,
        });
        expect(r.status).toBe(403);
        expect(r.error.rejectedByPolicy).toBe(true);
        expect(r.error.model).toBe('Post');
        expect(r.error.rejectReason).toBe('no-access');

        r = await handleRequest({
            method: 'put',
            path: '/post/update',
            requestBody: {
                where: { id: '1' },
                data: { title: 'post2' },
            },
            client,
        });
        expect(r.status).toBe(404);
        expect(r.error.model).toBe('Post');
    });

    it('validation error', async () => {
        const handleRequest = makeHandler();

        let r = await handleRequest({
            method: 'get',
            path: '/post/findUnique',
            client: rawClient,
        });
        expect(r.status).toBe(422);
        expect(r.error.message).toContain('Validation error');
        expect(r.error.message).toContain('where');

        r = await handleRequest({
            method: 'post',
            path: '/post/create',
            requestBody: { data: {} },
            client: rawClient,
        });
        expect(r.status).toBe(422);
        expect(r.error.message).toContain('Validation error');
        expect(r.error.message).toContain('data');

        r = await handleRequest({
            method: 'post',
            path: '/user/create',
            requestBody: { data: { email: 'hello' } },
            client: rawClient,
        });
        expect(r.status).toBe(422);
        expect(r.error.message).toContain('Validation error');
        expect(r.error.message).toContain('email');
    });

    it('invalid path or args', async () => {
        const handleRequest = makeHandler();
        let r = await handleRequest({
            method: 'get',
            path: '/post/',
            client: rawClient,
        });
        expect(r.status).toBe(400);
        expect(r.error.message).toContain('invalid request path');

        r = await handleRequest({
            method: 'get',
            path: '/post/findMany/abc',
            client: rawClient,
        });
        expect(r.status).toBe(400);
        expect(r.error.message).toContain('invalid request path');

        r = await handleRequest({
            method: 'get',
            path: '/post/findUnique',
            query: { q: 'abc' },
            client: rawClient,
        });
        expect(r.status).toBe(400);
        expect(r.error.message).toContain('invalid "q" query parameter');

        r = await handleRequest({
            method: 'delete',
            path: '/post/deleteMany',
            query: { q: 'abc' },
            client: rawClient,
        });
        expect(r.status).toBe(400);
        expect(r.error.message).toContain('invalid "q" query parameter');
    });

    it('custom operation works', async () => {
        const handleRequest = makeHandler({
            customOperations: {
                echo: async ({ requestBody }) => {
                    if (!requestBody) {
                        throw new RPCBadInputErrorResponse('missing body');
                    }
                    return { status: 200, body: { data: requestBody } };
                },
            },
        });

        const r = await handleRequest({
            method: 'post',
            path: '/post/echo',
            client: rawClient,
            requestBody: { message: 'hello' },
        });

        expect(r.status).toBe(200);
        expect(r.data).toEqual({ message: 'hello' });
    });

    it('custom operation auto unmarshals query', async () => {
        const serialized = SuperJSON.serialize({ where: { id: '1', created: new Date() } });

        const handleRequest = makeHandler({
            customOperations: {
                passthrough: async ({ query }) => ({ status: 200, body: { data: query?.q } }),
            },
        });

        const r = await handleRequest({
            method: 'get',
            path: '/post/passthrough',
            client: rawClient,
            query: {
                q: JSON.stringify(serialized.json),
                meta: JSON.stringify({ serialization: serialized.meta }),
            },
        });

        expect(r.status).toBe(200);
        expect(r.data.where.id).toBe('1');
        expect(r.data.where.created).toBeInstanceOf(Date);
    });

    it('custom operation maps errors', async () => {
        const handleRequest = makeHandler({
            customOperations: {
                bad: async () => {
                    throw new RPCBadInputErrorResponse('nope');
                },
                boom: async () => {
                    throw new RPCGenericErrorResponse('boom');
                },
            },
        });

        const bad = await handleRequest({ method: 'get', path: '/post/bad', client: rawClient });
        expect(bad.status).toBe(400);
        expect(bad.error.message).toBe('nope');

        const boom = await handleRequest({ method: 'get', path: '/post/boom', client: rawClient });
        expect(boom.status).toBe(500);
        expect(boom.error.message).toBe('boom');
    });

    it('custom operation cannot override built-in', () => {
        expect(() =>
            new RPCApiHandler({
                schema: client.$schema,
                customOperations: {
                    findMany: async () => ({ status: 200, body: { data: null } }),
                },
            }),
        ).toThrow(/cannot override built-in operation/);
    });

    it('custom operation name must be identifier', () => {
        expect(() =>
            new RPCApiHandler({
                schema: client.$schema,
                customOperations: {
                    'not-valid': async () => ({ status: 200, body: { data: null } }),
                },
            }),
        ).toThrow(/valid identifier/);
    });

    it('custom operation must be function', () => {
        expect(() =>
            new RPCApiHandler({
                schema: client.$schema,
                customOperations: {
                    nope: 'oops' as any,
                },
            }),
        ).toThrow(/must be a function/);
    });

    it('field types', async () => {
        const schema = `
        model Foo {
            id Int @id
            
            string String
            int Int
            bigInt BigInt
            date DateTime
            float Float
            decimal Decimal
            boolean Boolean
            bytes Bytes
            bars Bar[]
        }


        model Bar {
            id Int @id @default(autoincrement())
            bytes Bytes
            foo Foo @relation(fields: [fooId], references: [id])
            fooId Int @unique
        }    
        `;

        const handleRequest = makeHandler();
        const client = await createTestClient(schema, { provider: 'postgresql' });

        const decimalValue = new Decimal('0.046875');
        const bigIntValue = BigInt(534543543534);
        const dateValue = new Date();
        const bytesValue = new Uint8Array([1, 2, 3, 4]);
        const barBytesValue = new Uint8Array([7, 8, 9]);

        const createData = {
            string: 'string',
            int: 123,
            bigInt: bigIntValue,
            date: dateValue,
            float: 1.23,
            decimal: decimalValue,
            boolean: true,
            bytes: bytesValue,
            bars: {
                create: { bytes: barBytesValue },
            },
        };

        const serialized = SuperJSON.serialize({
            include: { bars: true },
            data: { id: 1, ...createData },
        });

        let r = await handleRequest({
            method: 'post',
            path: '/foo/create',
            query: {},
            client,
            requestBody: {
                ...(serialized.json as any),
                meta: { serialization: serialized.meta },
            },
        });
        expect(r.status).toBe(201);
        expect(r.meta).toBeTruthy();
        const data: any = SuperJSON.deserialize({ json: r.data, meta: r.meta.serialization });
        expect(typeof data.bigInt).toBe('bigint');
        expect(data.bytes).toBeInstanceOf(Uint8Array);
        expect(data.date instanceof Date).toBeTruthy();
        expect(Decimal.isDecimal(data.decimal)).toBeTruthy();
        expect(data.bars[0].bytes).toBeInstanceOf(Uint8Array);

        // find with filter not found
        const serializedQ = SuperJSON.serialize({
            where: {
                bigInt: {
                    gt: bigIntValue,
                },
            },
        });
        r = await handleRequest({
            method: 'get',
            path: '/foo/findFirst',
            query: {
                q: JSON.stringify(serializedQ.json),
                meta: JSON.stringify({ serialization: serializedQ.meta }),
            },
            client,
        });
        expect(r.status).toBe(200);
        expect(r.data).toBeNull();

        // find with filter found
        const serializedQ1 = SuperJSON.serialize({
            where: {
                bigInt: bigIntValue,
            },
        });
        r = await handleRequest({
            method: 'get',
            path: '/foo/findFirst',
            query: {
                q: JSON.stringify(serializedQ1.json),
                meta: JSON.stringify({ serialization: serializedQ1.meta }),
            },
            client,
        });
        expect(r.status).toBe(200);
        expect(r.data).toBeTruthy();

        // find with filter found
        const serializedQ2 = SuperJSON.serialize({
            where: {
                bars: {
                    some: {
                        bytes: barBytesValue,
                    },
                },
            },
        });
        r = await handleRequest({
            method: 'get',
            path: '/foo/findFirst',
            query: {
                q: JSON.stringify(serializedQ2.json),
                meta: JSON.stringify({ serialization: serializedQ2.meta }),
            },
            client,
        });
        expect(r.status).toBe(200);
        expect(r.data).toBeTruthy();

        // find with filter not found
        const serializedQ3 = SuperJSON.serialize({
            where: {
                bars: {
                    none: {
                        bytes: barBytesValue,
                    },
                },
            },
        });
        r = await handleRequest({
            method: 'get',
            path: '/foo/findFirst',
            query: {
                q: JSON.stringify(serializedQ3.json),
                meta: JSON.stringify({ serialization: serializedQ3.meta }),
            },
            client,
        });
        expect(r.status).toBe(200);
        expect(r.data).toBeNull();
    });

    function makeHandler(options?: Partial<RPCApiHandlerOptions<SchemaDef>>) {
        const handler = new RPCApiHandler({ schema: client.$schema, ...(options ?? {}) });
        return async (args: any) => {
            const r = await handler.handleRequest({
                ...args,
                url: new URL(`http://localhost/${args.path}`),
            });
            return {
                status: r.status,
                body: r.body as any,
                data: (r.body as any).data,
                error: (r.body as any).error,
                meta: (r.body as any).meta,
            };
        };
    }
});
