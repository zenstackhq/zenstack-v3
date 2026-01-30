import { definePlugin, type ClientContract } from '@zenstackhq/orm';
import { createTestClient } from '@zenstackhq/testtools';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import z from 'zod';
import { schema } from './ext-query-args/schema';

describe('Plugin client members', () => {
    let db: ClientContract<typeof schema>;

    beforeEach(async () => {
        db = await createTestClient(schema);
        await db.user.deleteMany();
    });

    afterEach(async () => {
        await db?.$disconnect();
    });

    it('should allow adding methods and props to client', async () => {
        let methodCalled = false;

        const extDb = db.$use(
            definePlugin({
                id: 'test-plugin',
                client: {
                    // method
                    $invalidateCache(model?: string) {
                        methodCalled = true;
                        return model ?? 'hello';
                    },

                    // dynamic property
                    get $cacheStats() {
                        return { hits: 10, misses: 5 };
                    },

                    // constant property
                    $cacheStats1: {
                        hits: 20,
                        misses: 10,
                    },
                },
            }),
        );

        const result = extDb.$invalidateCache();
        expect(result).toBe('hello');
        expect(methodCalled).toBe(true);

        expect(extDb.$invalidateCache('user')).toBe('user');

        // @ts-expect-error
        extDb.$invalidateCache(1);

        expect(extDb.$cacheStats.hits).toBe(10);
        expect(extDb.$cacheStats.misses).toBe(5);

        expect(extDb.$cacheStats1.hits).toBe(20);
        expect(extDb.$cacheStats1.misses).toBe(10);
    });

    it('should support multiple plugins with different members', async () => {
        const plugin1 = definePlugin({
            id: 'plugin1',
            client: {
                $method1: () => 'from-plugin1',
            },
        });

        const plugin2 = definePlugin({
            id: 'plugin2',
            client: {
                $method2: () => 'from-plugin2',
            },
        });

        const extDb = db.$use(plugin1).$use(plugin2);

        expect(extDb.$method1()).toBe('from-plugin1');
        expect(extDb.$method2()).toBe('from-plugin2');
    });

    it('should make later plugin win for conflicting members', async () => {
        const plugin1 = definePlugin({
            id: 'plugin1',
            client: {
                $conflicting: () => 'from-plugin1',
            },
        });

        const plugin2 = definePlugin({
            id: 'plugin2',
            client: {
                $conflicting: () => 'from-plugin2',
            },
        });

        const extDb = db.$use(plugin1).$use(plugin2);

        // Later plugin wins
        expect(extDb.$conflicting()).toBe('from-plugin2');
    });

    it('should make members available in transactions', async () => {
        const extDb = db.$use(
            definePlugin({
                id: 'test-plugin',
                client: {
                    $txHelper: () => 'in-transaction',
                },
            }),
        );

        await extDb.$transaction(async (tx) => {
            expect(tx.$txHelper()).toBe('in-transaction');
            await tx.user.create({ data: { name: 'Bob' } });
        });
    });

    it('should remove members when plugin is removed via $unuse', async () => {
        const extDb = db.$use(
            definePlugin({
                id: 'removable-plugin',
                client: {
                    $toBeRemoved: () => 'exists',
                },
            }),
        );

        expect(extDb.$toBeRemoved()).toBe('exists');

        const removedDb = extDb.$unuse('removable-plugin');

        // After $unuse, the method should not be available
        // TypeScript would complain, but at runtime it should be undefined
        expect(removedDb.$toBeRemoved).toBeUndefined();
    });

    it('should remove all members when $unuseAll is called', async () => {
        const extDb = db
            .$use(
                definePlugin({
                    id: 'p1',
                    client: { $m1: () => 'a' },
                }),
            )
            .$use(
                definePlugin({
                    id: 'p2',
                    client: { $m2: () => 'b' },
                }),
            );

        expect(extDb.$m1()).toBe('a');
        expect(extDb.$m2()).toBe('b');

        const cleanDb = extDb.$unuseAll();

        expect((cleanDb as any).$m1).toBeUndefined();
        expect((cleanDb as any).$m2).toBeUndefined();
    });

    it('should isolate members between client instances', async () => {
        const extDb = db.$use(
            definePlugin({
                id: 'isolated-plugin',
                client: {
                    $isolated: () => 'only-on-extDb',
                },
            }),
        );

        expect(extDb.$isolated()).toBe('only-on-extDb');

        // Original db should not have the method
        expect((db as any).$isolated).toBeUndefined();
    });

    it('should preserve members through $setAuth', async () => {
        const extDb = db.$use(
            definePlugin({
                id: 'test-plugin',
                client: {
                    $preserved: () => 'still-here',
                },
            }),
        );

        const authDb = extDb.$setAuth({ id: 1 });

        expect(authDb.$preserved()).toBe('still-here');
    });

    it('should preserve members through $setOptions', async () => {
        const extDb = db.$use(
            definePlugin({
                id: 'test-plugin',
                client: {
                    $preserved: () => 'still-here',
                },
            }),
        );

        const newOptionsDb = extDb.$setOptions({ ...extDb.$options, validateInput: false });

        expect(newOptionsDb.$preserved()).toBe('still-here');
    });

    it('should work with both extQueryArgs and client members', async () => {
        let gotTTL: number | undefined;

        const extDb = db.$use(
            definePlugin({
                id: 'cache-plugin',
                queryArgs: {
                    $all: z.object({
                        cache: z
                            .object({
                                ttl: z.number().optional(),
                            })
                            .optional(),
                    }),
                },
                onQuery: async ({ args, proceed }) => {
                    if (args && 'cache' in args) {
                        gotTTL = (args as any).cache?.ttl;
                    }
                    return proceed(args);
                },
                client: {
                    $getCachedTTL: () => gotTTL,
                },
            }),
        );

        await extDb.user.create({ data: { name: 'Test' }, cache: { ttl: 1000 } });
        expect(extDb.$getCachedTTL()).toBe(1000);
    });
});
