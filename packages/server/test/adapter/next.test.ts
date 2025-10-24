import { SchemaDef } from '@zenstackhq/orm/schema';
import { createPolicyTestClient, createTestClient } from '@zenstackhq/testtools';
import { createServer, RequestListener } from 'http';
import { apiResolver } from 'next/dist/server/api-utils/node/api-resolver';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { NextRequestHandler, type PageRouteRequestHandlerOptions } from '../../src/adapter/next';
import { RPCApiHandler } from '../../src/api';

function makeTestClient(
    apiPath: string,
    options: PageRouteRequestHandlerOptions<SchemaDef>,
    qArg?: unknown,
    otherArgs?: any,
) {
    const pathParts = apiPath.split('/').filter((p) => p);

    const query = {
        path: pathParts,
        ...(qArg ? { q: JSON.stringify(qArg) } : {}),
        ...otherArgs,
    };

    const handler = NextRequestHandler(options);

    const listener: RequestListener = (req, res) => {
        return apiResolver(
            req,
            res,
            query,
            handler,
            {
                dev: false,
                previewModeEncryptionKey: '',
                previewModeId: '',
                previewModeSigningKey: '',
            },
            false,
        );
    };

    return request(createServer(listener));
}

describe('Next.js adapter tests - rpc handler', () => {
    it('simple crud', async () => {
        const model = `
model M {
    id String @id @default(cuid())
    value Int
}
        `;

        const client = await createTestClient(model);

        const makeClientOptions = {
            getClient: () => client,
            apiHandler: new RPCApiHandler({
                schema: client.$schema,
            }),
        };

        await makeTestClient('/m/create', makeClientOptions)
            .post('/')
            .send({ data: { id: '1', value: 1 } })
            .expect(201)
            .expect((resp) => {
                expect(resp.body.data.value).toBe(1);
            });

        await makeTestClient('/m/findUnique', makeClientOptions, { where: { id: '1' } })
            .get('/')
            .expect(200)
            .expect((resp) => {
                expect(resp.body.data.value).toBe(1);
            });

        await makeTestClient('/m/findFirst', makeClientOptions, { where: { id: '1' } })
            .get('/')
            .expect(200)
            .expect((resp) => {
                expect(resp.body.data.value).toBe(1);
            });

        await makeTestClient('/m/findMany', makeClientOptions, {})
            .get('/')
            .expect(200)
            .expect((resp) => {
                expect(resp.body.data).toHaveLength(1);
            });

        await makeTestClient('/m/update', makeClientOptions)
            .put('/')
            .send({ where: { id: '1' }, data: { value: 2 } })
            .expect(200)
            .expect((resp) => {
                expect(resp.body.data.value).toBe(2);
            });

        await makeTestClient('/m/updateMany', makeClientOptions)
            .put('/')
            .send({ data: { value: 4 } })
            .expect(200)
            .expect((resp) => {
                expect(resp.body.data.count).toBe(1);
            });

        await makeTestClient('/m/upsert', makeClientOptions)
            .post('/')
            .send({ where: { id: '2' }, create: { id: '2', value: 2 }, update: { value: 3 } })
            .expect(201)
            .expect((resp) => {
                expect(resp.body.data.value).toBe(2);
            });

        await makeTestClient('/m/upsert', makeClientOptions)
            .post('/')
            .send({ where: { id: '2' }, create: { id: '2', value: 2 }, update: { value: 3 } })
            .expect(201)
            .expect((resp) => {
                expect(resp.body.data.value).toBe(3);
            });

        await makeTestClient('/m/count', makeClientOptions, { where: { id: '1' } })
            .get('/')
            .expect(200)
            .expect((resp) => {
                expect(resp.body.data).toBe(1);
            });

        await makeTestClient('/m/count', makeClientOptions, {})
            .get('/')
            .expect(200)
            .expect((resp) => {
                expect(resp.body.data).toBe(2);
            });

        await makeTestClient('/m/aggregate', makeClientOptions, { _sum: { value: true } })
            .get('/')
            .expect(200)
            .expect((resp) => {
                expect(resp.body.data._sum.value).toBe(7);
            });

        await makeTestClient('/m/groupBy', makeClientOptions, { by: ['id'], _sum: { value: true } })
            .get('/')
            .expect(200)
            .expect((resp) => {
                const data = resp.body.data;
                expect(data).toHaveLength(2);
                expect(data.find((item: any) => item.id === '1')._sum.value).toBe(4);
                expect(data.find((item: any) => item.id === '2')._sum.value).toBe(3);
            });

        await makeTestClient('/m/delete', makeClientOptions, { where: { id: '1' } })
            .del('/')
            .expect(200);
        expect(await client.m.count()).toBe(1);

        await makeTestClient('/m/deleteMany', makeClientOptions, {})
            .del('/')
            .expect(200)
            .expect((resp) => {
                expect(resp.body.data.count).toBe(1);
            });
        expect(await client.m.count()).toBe(0);
    });

    it('access policy crud', async () => {
        const model = `
model M {
    id String @id @default(cuid())
    value Int

    @@allow('create,update', true)
    @@allow('read', value > 0)
    @@allow('post-update', value > 1)
    @@allow('delete', value > 2)
}
        `;

        const client = await createPolicyTestClient(model);
        const makeClientOptions = {
            getClient: () => client,
            apiHandler: new RPCApiHandler({
                schema: client.$schema,
            }),
        };

        await makeTestClient('/m/create', makeClientOptions)
            .post('/m/create')
            .send({ data: { value: 0 } })
            .expect(403)
            .expect((resp) => {
                expect(resp.body.error.rejectReason).toBe('cannot-read-back');
            });

        await makeTestClient('/m/create', makeClientOptions)
            .post('/')
            .send({ data: { id: '1', value: 1 } })
            .expect(201);

        await makeTestClient('/m/findMany', makeClientOptions)
            .get('/')
            .expect(200)
            .expect((resp) => {
                expect(resp.body.data).toHaveLength(1);
            });

        await makeTestClient('/m/update', makeClientOptions)
            .put('/')
            .send({ where: { id: '1' }, data: { value: 0 } })
            .expect(403);

        await makeTestClient('/m/update', makeClientOptions)
            .put('/')
            .send({ where: { id: '1' }, data: { value: 2 } })
            .expect(200);

        await makeTestClient('/m/delete', makeClientOptions, { where: { id: '1' } })
            .del('/')
            .expect(404);

        await makeTestClient('/m/update', makeClientOptions)
            .put('/')
            .send({ where: { id: '1' }, data: { value: 3 } })
            .expect(200);

        await makeTestClient('/m/delete', makeClientOptions, { where: { id: '1' } })
            .del('/')
            .expect(200);
    });
});

// describe('Next.js adapter tests - rest handler', () => {
//     let origDir: string;

//     beforeEach(() => {
//         origDir = process.cwd();
//     });

//     afterEach(() => {
//         process.chdir(origDir);
//     });

//     it('adapter test - rest', async () => {
//         const model = `
// model M {
//     id String @id @default(cuid())
//     value Int
// }
//         `;

//         const { prisma, modelMeta } = await loadSchema(model);

//         const options = { getPrisma: () => prisma, handler: Rest({ endpoint: 'http://localhost/api' }), modelMeta };

//         await makeTestClient('/m', options)
//             .post('/')
//             .send({ data: { type: 'm', attributes: { id: '1', value: 1 } } })
//             .expect(201)
//             .expect((resp) => {
//                 expect(resp.body.data.attributes.value).toBe(1);
//             });

//         await makeTestClient('/m/1', options)
//             .get('/')
//             .expect(200)
//             .expect((resp) => {
//                 expect(resp.body.data.id).toBe('1');
//             });

//         await makeTestClient('/m', options, undefined, { 'filter[value]': '1' })
//             .get('/')
//             .expect(200)
//             .expect((resp) => {
//                 expect(resp.body.data).toHaveLength(1);
//             });

//         await makeTestClient('/m', options, undefined, { 'filter[value]': '2' })
//             .get('/')
//             .expect(200)
//             .expect((resp) => {
//                 expect(resp.body.data).toHaveLength(0);
//             });

//         await makeTestClient('/m/1', options)
//             .put('/')
//             .send({ data: { type: 'm', attributes: { value: 2 } } })
//             .expect(200)
//             .expect((resp) => {
//                 expect(resp.body.data.attributes.value).toBe(2);
//             });

//         await makeTestClient('/m/1', options).del('/').expect(200);
//         expect(await prisma.m.count()).toBe(0);
//     });
// });
