import { type ClientContract } from '@zenstackhq/orm';
import { createTestClient } from '@zenstackhq/testtools';
import { InsertQueryNode, Kysely, PrimitiveValueListNode, ValuesNode, type QueryResult } from 'kysely';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { schema } from '../schemas/basic';

describe('On kysely query tests', () => {
    let _client: ClientContract<typeof schema>;

    beforeEach(async () => {
        _client = await createTestClient(schema);
    });

    afterEach(async () => {
        await _client.$disconnect();
    });

    it('intercepts queries', async () => {
        let called = false;
        const client = _client.$use({
            id: 'test-plugin',
            onKyselyQuery({ query, proceed }) {
                if (query.kind === 'InsertQueryNode') {
                    called = true;
                }
                return proceed(query);
            },
        });
        await expect(
            client.user.create({
                data: { email: 'u1@test.com' },
            }),
        ).resolves.toMatchObject({
            email: 'u1@test.com',
        });
        await expect(called).toBe(true);
    });

    it('does not pollute old client', async () => {
        let called = false;
        _client.$use({
            id: 'test-plugin',
            onKyselyQuery({ proceed, query }) {
                called = true;
                return proceed(query);
            },
        });
        await expect(
            _client.user.create({
                data: { email: 'u1@test.com' },
            }),
        ).resolves.toMatchObject({
            email: 'u1@test.com',
        });
        await expect(called).toBe(false);
    });

    it('support query transformation', async () => {
        const client = _client.$use({
            id: 'test-plugin',
            onKyselyQuery({ proceed, query }) {
                if (query.kind !== 'InsertQueryNode') {
                    return proceed(query);
                }
                const valueList = [
                    ...(((query as InsertQueryNode).values as ValuesNode).values[0] as PrimitiveValueListNode).values,
                ];
                valueList[0] = 'u2@test.com';
                const newQuery = InsertQueryNode.cloneWith(query as InsertQueryNode, {
                    values: ValuesNode.create([PrimitiveValueListNode.create(valueList)]),
                });
                return proceed(newQuery);
            },
        });

        await expect(
            client.user.create({
                data: { email: 'u1@test.com' },
            }),
        ).resolves.toMatchObject({
            email: 'u2@test.com',
        });
    });

    it('supports spawning multiple queries', async () => {
        const client = _client.$use({
            id: 'test-plugin',
            async onKyselyQuery({ client, proceed, query }) {
                if (query.kind !== 'InsertQueryNode') {
                    return proceed(query);
                }

                const result = await proceed(query);

                // create a post for the user
                await proceed(createPost(client.$qb, result));

                return result;
            },
        });

        await expect(
            client.user.create({
                data: { id: '1', email: 'u1@test.com' },
            }),
        ).resolves.toMatchObject({
            email: 'u1@test.com',
        });

        await expect(client.post.findFirst()).resolves.toMatchObject({
            title: 'Post1',
            authorId: '1',
        });
    });

    it('works with multiple interceptors', async () => {
        let called1 = false;
        let called2 = false;

        const client = _client
            .$use({
                id: 'test-plugin',
                onKyselyQuery({ proceed, query }) {
                    if (query.kind !== 'InsertQueryNode') {
                        return proceed(query);
                    }
                    called1 = true;
                    const valueList = [
                        ...(((query as InsertQueryNode).values as ValuesNode).values[0] as PrimitiveValueListNode)
                            .values,
                    ];
                    valueList[1] = 'Marvin2';
                    const newQuery = InsertQueryNode.cloneWith(query as InsertQueryNode, {
                        values: ValuesNode.create([PrimitiveValueListNode.create(valueList)]),
                    });
                    return proceed(newQuery);
                },
            })
            .$use({
                id: 'test-plugin2',
                onKyselyQuery({ proceed, query }) {
                    if (query.kind !== 'InsertQueryNode') {
                        return proceed(query);
                    }
                    called2 = true;
                    const valueList = [
                        ...(((query as InsertQueryNode).values as ValuesNode).values[0] as PrimitiveValueListNode)
                            .values,
                    ];
                    valueList[0] = 'u2@test.com';
                    valueList[1] = 'Marvin1';
                    const newQuery = InsertQueryNode.cloneWith(query as InsertQueryNode, {
                        values: ValuesNode.create([PrimitiveValueListNode.create(valueList)]),
                    });
                    return proceed(newQuery);
                },
            });

        await expect(
            client.user.create({
                data: { email: 'u1@test.com', name: 'Marvin' },
            }),
        ).resolves.toMatchObject({
            email: 'u2@test.com',
            name: 'Marvin2',
        });

        await expect(called1).toBe(true);
        await expect(called2).toBe(true);
    });

    it('works with multiple interceptors with outer transaction', async () => {
        let called1 = false;
        let called2 = false;

        const client = _client
            .$use({
                id: 'test-plugin',
                async onKyselyQuery({ query, proceed }) {
                    if (query.kind !== 'InsertQueryNode') {
                        return proceed(query);
                    }
                    called1 = true;
                    await proceed(query);
                    throw new Error('test error');
                },
            })
            .$use({
                id: 'test-plugin2',
                onKyselyQuery({ query, proceed }) {
                    if (query.kind !== 'InsertQueryNode') {
                        return proceed(query);
                    }
                    called2 = true;
                    const valueList = [
                        ...(((query as InsertQueryNode).values as ValuesNode).values[0] as PrimitiveValueListNode)
                            .values,
                    ];
                    valueList[0] = 'u2@test.com';
                    valueList[1] = 'Marvin1';
                    const newQuery = InsertQueryNode.cloneWith(query as InsertQueryNode, {
                        values: ValuesNode.create([PrimitiveValueListNode.create(valueList)]),
                    });
                    return proceed(newQuery);
                },
            });

        await expect(
            client.$transaction((tx) =>
                tx.user.create({
                    data: { email: 'u1@test.com', name: 'Marvin' },
                }),
            ),
        ).rejects.toThrow('test error');

        await expect(called1).toBe(true);
        await expect(called2).toBe(true);
        await expect(client.user.findFirst()).toResolveNull();
    });
});

function createPost(kysely: Kysely<any>, userRows: QueryResult<any>) {
    const now = new Date().toISOString();
    const createPost = kysely.insertInto('Post').values({
        id: '1',
        title: 'Post1',
        authorId: (userRows.rows[0] as any).id,
        updatedAt: now,
    });
    return createPost.toOperationNode();
}
