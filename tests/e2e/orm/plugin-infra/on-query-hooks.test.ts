import { definePlugin, type ClientContract } from '@zenstackhq/orm';
import { createTestClient } from '@zenstackhq/testtools';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { schema } from '../schemas/basic';

describe('On query hooks tests', () => {
    let _client: ClientContract<typeof schema>;

    beforeEach(async () => {
        _client = await createTestClient(schema);
    });

    afterEach(async () => {
        await _client?.$disconnect();
    });

    it('supports simple interception', async () => {
        const user = await _client.user.create({
            data: { email: 'u1@test.com' },
        });

        let findHookCalled = false;
        let updateHookCalled = false;

        const client = _client.$use({
            id: 'test-plugin',
            onQuery: (ctx) => {
                if (ctx.operation === 'findFirst') {
                    findHookCalled = true;
                    expect(ctx).toMatchObject({
                        model: 'User',
                        operation: 'findFirst',
                        args: { where: { id: user.id } },
                    });
                } else if (ctx.operation === 'update') {
                    updateHookCalled = true;
                }
                return ctx.proceed(ctx.args);
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
            onQuery: (ctx) => {
                if (ctx.operation === 'findFirst') {
                    hooksCalled = true;
                    expect(ctx.model).toBe('User');
                }
                return ctx.proceed(ctx.args);
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
            onQuery: (ctx) => {
                hooksCalled = true;
                expect(ctx.model).toBe('User');
                expect(ctx.operation).toBe('findFirst');
                return ctx.proceed(ctx.args);
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
            onQuery: async (ctx) => {
                if (ctx.model === 'User' && ctx.operation === 'findFirst') {
                    hooksCalled = true;
                    return ctx.proceed({ where: { id: 'non-exist' } });
                } else {
                    return ctx.proceed(ctx.args);
                }
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
            onQuery: async (ctx) => {
                if (ctx.model === 'User' && ctx.operation === 'findFirst') {
                    hooksCalled = true;
                    const result = await ctx.proceed(ctx.args);
                    (result as any).happy = true;
                    return result;
                } else {
                    return ctx.proceed(ctx.args);
                }
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

    it('persists the effect without transaction', async () => {
        let hooksCalled = false;
        const client = _client.$use({
            id: 'test-plugin',
            onQuery: async (ctx) => {
                if (ctx.model === 'User' && ctx.operation === 'create') {
                    hooksCalled = true;
                    await ctx.proceed(ctx.args);
                    throw new Error('trigger error');
                } else {
                    return ctx.proceed(ctx.args);
                }
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

    it('supports plugin encapsulation', async () => {
        const user = await _client.user.create({
            data: { email: 'u1@test.com' },
        });

        let findHookCalled = false;

        const plugin = definePlugin({
            id: 'test-plugin',
            onQuery: (ctx) => {
                findHookCalled = true;
                return ctx.proceed(ctx.args);
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

    it('propagates overridden args across multiple onQuery plugins', async () => {
        const user = await _client.user.create({ data: { email: 'u1@test.com' } });

        let earlierSawOverridden = false;

        // Plugin A (registered first) should see the overridden args from Plugin B
        const clientA = _client.$use({
            id: 'plugin-a',
            onQuery: (ctx) => {
                if (ctx.model === 'User' && ctx.operation === 'findFirst') {
                    // expect overridden where clause from Plugin B
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    earlierSawOverridden = (ctx.args as any)?.where?.id === 'non-exist';
                }
                return ctx.proceed(ctx.args);
            },
        });

        // Plugin B (registered second) overrides args
        const client = clientA.$use({
            id: 'plugin-b',
            onQuery: (ctx) => {
                if (ctx.model === 'User' && ctx.operation === 'findFirst') {
                    return ctx.proceed({ where: { id: 'non-exist' } });
                }
                return ctx.proceed(ctx.args);
            },
        });

        await expect(
            client.user.findFirst({
                where: { id: user.id },
            }),
        ).toResolveNull();

        expect(earlierSawOverridden).toBe(true);
    });
});
