import { DeleteQueryNode, InsertQueryNode, UpdateQueryNode } from 'kysely';
import { beforeEach, describe, expect, it } from 'vitest';
import { ZenStackClient, type ClientContract } from '../../src';
import { schema } from '../test-schema';

describe('Entity lifecycle tests', () => {
    let _client: ClientContract<typeof schema>;

    beforeEach(async () => {
        _client = await new ZenStackClient(schema);
        await _client.$pushSchema();
    });

    it('can intercept all mutations', async () => {
        const beforeCalled = { create: false, update: false, delete: false };
        const afterCalled = { create: false, update: false, delete: false };

        const client = _client.$use({
            id: 'test',
            beforeEntityMutation(args) {
                beforeCalled[args.action] = true;
                if (args.action === 'create') {
                    expect(InsertQueryNode.is(args.queryNode)).toBe(true);
                }
                if (args.action === 'update') {
                    expect(UpdateQueryNode.is(args.queryNode)).toBe(true);
                }
                if (args.action === 'delete') {
                    expect(DeleteQueryNode.is(args.queryNode)).toBe(true);
                }
                expect(args.entities).toBeUndefined();
            },
            afterEntityMutation(args) {
                afterCalled[args.action] = true;
                expect(args.beforeMutationEntities).toBeUndefined();
                expect(args.afterMutationEntities).toBeUndefined();
            },
        });

        const user = await client.user.create({
            data: { email: 'u1@test.com' },
        });
        await client.user.update({
            where: { id: user.id },
            data: { email: 'u2@test.com' },
        });
        await client.user.delete({ where: { id: user.id } });

        expect(beforeCalled).toEqual({
            create: true,
            update: true,
            delete: true,
        });
        expect(afterCalled).toEqual({
            create: true,
            update: true,
            delete: true,
        });
    });

    it('can intercept with filtering', async () => {
        const beforeCalled = { create: false, update: false, delete: false };
        const afterCalled = { create: false, update: false, delete: false };

        const client = _client.$use({
            id: 'test',
            mutationInterceptionFilter: (args) => {
                return {
                    intercept: args.action !== 'delete',
                };
            },
            beforeEntityMutation(args) {
                beforeCalled[args.action] = true;
                expect(args.entities).toBeUndefined();
            },
            afterEntityMutation(args) {
                afterCalled[args.action] = true;
            },
        });

        const user = await client.user.create({
            data: { email: 'u1@test.com' },
        });
        await client.user.update({
            where: { id: user.id },
            data: { email: 'u2@test.com' },
        });
        await client.user.delete({ where: { id: user.id } });

        expect(beforeCalled).toEqual({
            create: true,
            update: true,
            delete: false,
        });
        expect(afterCalled).toEqual({
            create: true,
            update: true,
            delete: false,
        });
    });

    it('can intercept with loading before mutation entities', async () => {
        const client = _client.$use({
            id: 'test',
            mutationInterceptionFilter: () => {
                return {
                    intercept: true,
                    loadBeforeMutationEntity: true,
                };
            },
            beforeEntityMutation(args) {
                if (args.action === 'update' || args.action === 'delete') {
                    expect(args.entities).toEqual([
                        expect.objectContaining({
                            email:
                                args.action === 'update'
                                    ? 'u1@test.com'
                                    : 'u3@test.com',
                        }),
                    ]);
                } else {
                    expect(args.entities).toBeUndefined();
                }
            },
            afterEntityMutation(args) {
                if (args.action === 'update' || args.action === 'delete') {
                    expect(args.beforeMutationEntities).toEqual([
                        expect.objectContaining({
                            email:
                                args.action === 'update'
                                    ? 'u1@test.com'
                                    : 'u3@test.com',
                        }),
                    ]);
                }
                expect(args.afterMutationEntities).toBeUndefined();
            },
        });

        const user = await client.user.create({
            data: { email: 'u1@test.com' },
        });
        await client.user.create({
            data: { email: 'u2@test.com' },
        });
        await client.user.update({
            where: { id: user.id },
            data: { email: 'u3@test.com' },
        });
        await client.user.delete({ where: { id: user.id } });
    });

    it('can intercept with loading after mutation entities', async () => {
        let userCreateIntercepted = false;
        let userUpdateIntercepted = false;
        const client = _client.$use({
            id: 'test',
            mutationInterceptionFilter: () => {
                return {
                    intercept: true,
                    loadAfterMutationEntity: true,
                };
            },
            afterEntityMutation(args) {
                if (args.action === 'create' || args.action === 'update') {
                    if (args.action === 'create') {
                        userCreateIntercepted = true;
                    }
                    if (args.action === 'update') {
                        userUpdateIntercepted = true;
                    }
                    expect(args.afterMutationEntities).toEqual(
                        expect.arrayContaining([
                            expect.objectContaining({
                                email:
                                    args.action === 'create'
                                        ? 'u1@test.com'
                                        : 'u2@test.com',
                            }),
                        ])
                    );
                } else {
                    expect(args.afterMutationEntities).toBeUndefined();
                }
            },
        });

        const user = await client.user.create({
            data: { email: 'u1@test.com' },
        });
        await client.user.update({
            where: { id: user.id },
            data: { email: 'u2@test.com' },
        });

        expect(userCreateIntercepted).toBe(true);
        expect(userUpdateIntercepted).toBe(true);
    });

    it('can intercept multi-entity mutations', async () => {
        let userCreateIntercepted = false;
        let userUpdateIntercepted = false;
        let userDeleteIntercepted = false;

        const client = _client.$use({
            id: 'test',
            mutationInterceptionFilter: () => {
                return {
                    intercept: true,
                    loadAfterMutationEntity: true,
                };
            },
            afterEntityMutation(args) {
                if (args.action === 'create') {
                    userCreateIntercepted = true;
                    expect(args.afterMutationEntities).toEqual(
                        expect.arrayContaining([
                            expect.objectContaining({ email: 'u1@test.com' }),
                            expect.objectContaining({ email: 'u2@test.com' }),
                        ])
                    );
                } else if (args.action === 'update') {
                    userUpdateIntercepted = true;
                    expect(args.afterMutationEntities).toEqual(
                        expect.arrayContaining([
                            expect.objectContaining({
                                email: 'u1@test.com',
                                name: 'A user',
                            }),
                            expect.objectContaining({
                                email: 'u1@test.com',
                                name: 'A user',
                            }),
                        ])
                    );
                } else if (args.action === 'delete') {
                    userDeleteIntercepted = true;
                    expect(args.afterMutationEntities).toEqual(
                        expect.arrayContaining([
                            expect.objectContaining({ email: 'u1@test.com' }),
                            expect.objectContaining({ email: 'u2@test.com' }),
                        ])
                    );
                }
            },
        });

        await client.user.createMany({
            data: [{ email: 'u1@test.com' }, { email: 'u2@test.com' }],
        });
        await client.user.updateMany({
            data: { name: 'A user' },
        });

        expect(userCreateIntercepted).toBe(true);
        expect(userUpdateIntercepted).toBe(true);
        expect(userDeleteIntercepted).toBe(false);
    });

    it('can intercept nested mutations', async () => {
        let post1Intercepted = false;
        let post2Intercepted = false;
        const client = _client.$use({
            id: 'test',
            mutationInterceptionFilter: (args) => {
                return {
                    intercept:
                        args.action === 'create' || args.action === 'update',
                    loadAfterMutationEntity: true,
                };
            },
            afterEntityMutation(args) {
                if (args.action === 'create') {
                    if (args.model === 'Post') {
                        if (
                            (args.afterMutationEntities![0] as any).title ===
                            'Post1'
                        ) {
                            post1Intercepted = true;
                        }
                        if (
                            (args.afterMutationEntities![0] as any).title ===
                            'Post2'
                        ) {
                            post2Intercepted = true;
                        }
                    }
                }
            },
        });

        const user = await client.user.create({
            data: {
                email: 'u1@test.com',
                posts: { create: { title: 'Post1' } },
            },
        });
        await client.user.update({
            where: { id: user.id },
            data: {
                email: 'u2@test.com',
                posts: { create: { title: 'Post2' } },
            },
        });

        expect(post1Intercepted).toBe(true);
        expect(post2Intercepted).toBe(true);
    });

    // TODO: revisit mutation hooks and transactions
    it.skip('proceeds with mutation even when hooks throw', async () => {
        let userIntercepted = false;

        const client = _client.$use({
            id: 'test',
            afterEntityMutation() {
                userIntercepted = true;
                throw new Error('trigger error');
            },
        });

        let gotError = false;
        try {
            await client.user.create({
                data: { email: 'u1@test.com' },
            });
        } catch (err) {
            gotError = true;
            expect((err as Error).message).toContain('trigger error');
        }

        expect(userIntercepted).toBe(true);
        expect(gotError).toBe(true);
        console.log(await client.user.findMany());
        await expect(client.user.findMany()).toResolveWithLength(1);
    });

    it('rolls back when hooks throw if transaction is used', async () => {
        let userIntercepted = false;

        const client = _client.$use({
            id: 'test',
            mutationInterceptionFilter: () => {
                return {
                    intercept: true,
                    useTransactionForMutation: true,
                };
            },
            afterEntityMutation() {
                userIntercepted = true;
                throw new Error('trigger rollback');
            },
        });

        let gotError = false;
        try {
            await client.user.create({
                data: { email: 'u1@test.com' },
            });
        } catch (err) {
            gotError = true;
            expect((err as Error).message).toContain('trigger rollback');
        }

        expect(userIntercepted).toBe(true);
        expect(gotError).toBe(true);
        await expect(client.user.findMany()).toResolveWithLength(0);
    });
});
