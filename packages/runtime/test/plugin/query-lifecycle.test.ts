import SQLite from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { definePlugin, ZenStackClient, type ClientContract } from '../../src/client';
import { schema } from '../test-schema';

describe('Query interception tests', () => {
    let _client: ClientContract<typeof schema>;

    beforeEach(async () => {
        _client = new ZenStackClient(schema, {
            dialectConfig: {
                database: new SQLite(':memory:'),
            },
        });
        await _client.$pushSchema();
    });

    it('supports simple interception', async () => {
        const user = await _client.user.create({
            data: { email: 'u1@test.com' },
        });

        let findHookCalled = false;
        let updateHookCalled = false;

        const client = _client.$use({
            id: 'test-plugin',
            onQuery: {
                user: {
                    findFirst: (ctx) => {
                        findHookCalled = true;
                        expect(ctx).toMatchObject({
                            model: 'User',
                            operation: 'findFirst',
                            args: { where: { id: user.id } },
                        });
                        return ctx.query(ctx.args);
                    },
                    update: (ctx) => {
                        updateHookCalled = true;
                        return ctx.query(ctx.args);
                    },
                },
            },
        });

        await expect(
            client.user.findFirst({
                where: { id: user.id },
            }),
        ).resolves.toMatchObject(user);
        expect(findHookCalled).toBe(true);
        expect(updateHookCalled).toBe(false);
    });

    it('supports all models interception', async () => {
        const user = await _client.user.create({
            data: { email: 'u1@test.com' },
        });

        let hooksCalled = false;
        const client = _client.$use({
            id: 'test-plugin',
            onQuery: {
                $allModels: {
                    findFirst: (ctx) => {
                        hooksCalled = true;
                        expect(ctx.model).toBe('User');
                        return ctx.query(ctx.args);
                    },
                },
            },
        });
        await expect(
            client.user.findFirst({
                where: { id: user.id },
            }),
        ).resolves.toMatchObject(user);
        expect(hooksCalled).toBe(true);
    });

    it('supports all operations interception', async () => {
        const user = await _client.user.create({
            data: { email: 'u1@test.com' },
        });

        let hooksCalled = false;
        const client = _client.$use({
            id: 'test-plugin',
            onQuery: {
                $allModels: {
                    $allOperations: (ctx) => {
                        hooksCalled = true;
                        expect(ctx.model).toBe('User');
                        expect(ctx.operation).toBe('findFirst');
                        return ctx.query(ctx.args);
                    },
                },
            },
        });
        await expect(
            client.user.findFirst({
                where: { id: user.id },
            }),
        ).resolves.toMatchObject(user);
        expect(hooksCalled).toBe(true);
    });

    it('supports modifying query args', async () => {
        const user = await _client.user.create({
            data: { email: 'u1@test.com' },
        });

        let hooksCalled = false;
        const client = _client.$use({
            id: 'test-plugin',
            onQuery: {
                user: {
                    findFirst: async (ctx) => {
                        hooksCalled = true;
                        return ctx.query({ where: { id: 'non-exist' } });
                    },
                },
            },
        });

        await expect(
            client.user.findFirst({
                where: { id: user.id },
            }),
        ).toResolveNull();
        expect(hooksCalled).toBe(true);
    });

    it('supports modifying query result', async () => {
        const user = await _client.user.create({
            data: { email: 'u1@test.com' },
        });

        let hooksCalled = false;
        const client = _client.$use({
            id: 'test-plugin',
            onQuery: {
                user: {
                    findFirst: async (ctx) => {
                        hooksCalled = true;
                        const result = await ctx.query(ctx.args);
                        (result as any).happy = true;
                        return result;
                    },
                },
            },
        });

        await expect(
            client.user.findFirst({
                where: { id: user.id },
            }),
        ).resolves.toMatchObject({
            ...user,
            happy: true,
        });
        expect(hooksCalled).toBe(true);
    });

    it('supports multiple interceptors', async () => {
        const user1 = await _client.user.create({
            data: { email: 'u1@test.com' },
        });
        const user2 = await _client.user.create({
            data: { email: 'u2@test.com' },
        });
        const user3 = await _client.user.create({
            data: { email: 'u3@test.com' },
        });

        let hooks1Called = false;
        let hooks2Called = false;
        const client = _client
            .$use({
                id: 'test-plugin',
                onQuery: {
                    user: {
                        findFirst: async (ctx) => {
                            hooks1Called = true;
                            console.log('Plugin1 ready to proceed');
                            const r = await ctx.query({ where: { id: user2.id } });
                            (r as any).happy = true;
                            (r as any).source = 'plugin1';
                            console.log('Plugin1 ready to return', r);
                            return r;
                        },
                    },
                },
            })
            .$use({
                id: 'test-plugin-2',
                onQuery: {
                    user: {
                        findFirst: async (ctx) => {
                            hooks2Called = true;
                            console.log('Plugin2 ready to proceed');
                            const r = await ctx.query({ where: { id: user3.id } });
                            (r as any).source = 'plugin2';
                            console.log('Plugin2 ready to return', r);
                            return r;
                        },
                    },
                },
            });

        // call order:
        // 1. plugin2 pre proceed
        // 2. plugin1 pre proceed
        // 3. plugin1 post proceed
        // 4. plugin2 post proceed
        await expect(
            client.user.findFirst({
                where: { id: user1.id },
            }),
        ).resolves.toMatchObject({ ...user2, happy: true, source: 'plugin2' });
        expect(hooks1Called).toBe(true);
        expect(hooks2Called).toBe(true);
    });

    it('persists the effect without transaction', async () => {
        let hooksCalled = false;
        const client = _client.$use({
            id: 'test-plugin',
            onQuery: {
                user: {
                    create: async (ctx) => {
                        hooksCalled = true;
                        await ctx.query(ctx.args);
                        throw new Error('trigger error');
                    },
                },
            },
        });

        try {
            await client.user.create({
                data: { id: '1', email: 'u1@test.com' },
            });
        } catch {
            // no-op
        }

        expect(hooksCalled).toBe(true);
        await expect(
            _client.user.findFirst({
                where: { id: '1' },
            }),
        ).toResolveTruthy();
    });

    it('rolls back the effect with transaction', async () => {
        let hooksCalled = false;
        const client = _client.$use({
            id: 'test-plugin',
            onQuery: {
                user: {
                    create: async (ctx) => {
                        hooksCalled = true;
                        return ctx.client.$transaction(async (tx) => {
                            await ctx.query(ctx.args, tx);
                            throw new Error('trigger error');
                        });
                    },
                },
            },
        });

        try {
            await client.user.create({
                data: { id: '1', email: 'u1@test.com' },
            });
        } catch {
            // no-op
        }

        expect(hooksCalled).toBe(true);
        await expect(
            _client.user.findFirst({
                where: { id: '1' },
            }),
        ).toResolveNull();
    });

    it('supports plugin encapsulation', async () => {
        const user = await _client.user.create({
            data: { email: 'u1@test.com' },
        });

        let findHookCalled = false;

        const plugin = definePlugin<typeof schema>({
            id: 'test-plugin',
            onQuery: {
                user: {
                    findFirst: (ctx) => {
                        findHookCalled = true;
                        return ctx.query(ctx.args);
                    },
                },
            },
        });

        const client = _client.$use(plugin);

        await expect(
            client.user.findFirst({
                where: { id: user.id },
            }),
        ).resolves.toMatchObject(user);
        expect(findHookCalled).toBe(true);
    });
});
