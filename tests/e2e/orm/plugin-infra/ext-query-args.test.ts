import { CoreReadOperations, CoreWriteOperations, definePlugin, type ClientContract } from '@zenstackhq/orm';
import { createTestClient } from '@zenstackhq/testtools';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import z from 'zod';
import { schema } from './ext-query-args/schema';

describe('Plugin extended query args', () => {
    let db: ClientContract<typeof schema>;

    const cacheSchema = z.object({
        cache: z
            .strictObject({
                ttl: z.number().min(0).optional(),
            })
            .optional(),
    });

    const cacheBustSchema = z.object({
        cache: z.strictObject({
            bust: z.boolean().optional(),
        }),
    });

    type CacheOptions = z.infer<typeof cacheSchema>;
    type CacheBustOptions = z.infer<typeof cacheBustSchema>;

    beforeEach(async () => {
        db = await createTestClient(schema);
        await db.user.deleteMany();
    });

    afterEach(async () => {
        await db?.$disconnect();
    });

    it('should allow extending all operations', async () => {
        let gotTTL: number | undefined = undefined;

        const extDb = db.$use(
            definePlugin<
                typeof schema,
                {
                    all: CacheOptions;
                }
            >({
                id: 'cache',
                extQueryArgs: {
                    getValidationSchema: () => cacheSchema,
                },

                onQuery: async ({ args, proceed }) => {
                    if ('cache' in args) {
                        gotTTL = (args as CacheOptions).cache?.ttl;
                    }
                    return proceed(args);
                },
            }),
        );

        // cache is optional
        const alice = await extDb.user.create({ data: { name: 'Alice' } });

        // ttl is optional
        const bob = await extDb.user.create({ data: { name: 'Bob' }, cache: {} });

        gotTTL = undefined;
        await expect(extDb.user.findMany({ cache: { ttl: 5000 } })).toResolveWithLength(2);
        expect(gotTTL).toBe(5000);

        await expect(extDb.user.findMany({ cache: { ttl: -1 } })).rejects.toThrow('Too small');

        // reject unrecognized keys in extended args
        // @ts-expect-error
        await expect(extDb.user.findMany({ cache: { x: 1 } })).rejects.toThrow('Unrecognized key');

        // still reject invalid original args
        // @ts-expect-error
        await expect(extDb.user.findMany({ where: { foo: 'bar' } })).rejects.toThrow('Unrecognized key');
        // @ts-expect-error
        await expect(extDb.user.findMany({ foo: 'bar' })).rejects.toThrow('Unrecognized key');
        // @ts-expect-error
        await expect(extDb.user.findMany({ where: { id: 'abc' } })).rejects.toThrow('expected number');

        // validate all other operations

        const cacheOption = { cache: { ttl: 1000 } } as const;

        // read operations
        await expect(extDb.user.findUnique({ where: { id: 1 }, ...cacheOption })).toResolveTruthy();
        await expect(extDb.user.findUniqueOrThrow({ where: { id: 1 }, ...cacheOption })).toResolveTruthy();
        await expect(extDb.user.findFirst(cacheOption)).toResolveTruthy();
        await expect(extDb.user.findFirstOrThrow(cacheOption)).toResolveTruthy();
        await expect(extDb.user.count(cacheOption)).resolves.toBe(2);
        await expect(extDb.user.exists(cacheOption)).resolves.toBe(true);
        await expect(
            extDb.user.aggregate({
                _count: true,
                ...cacheOption,
            }),
        ).resolves.toHaveProperty('_count');
        await expect(
            extDb.user.groupBy({
                by: ['id'],
                _count: {
                    id: true,
                },
                ...cacheOption,
            }),
        ).resolves.toHaveLength(2);

        // create operations
        await expect(extDb.user.createMany({ data: [{ name: 'Charlie' }], ...cacheOption })).resolves.toHaveProperty(
            'count',
        );
        await expect(extDb.user.createManyAndReturn({ data: [{ name: 'David' }], ...cacheOption })).toResolveWithLength(
            1,
        );

        // update operations
        await expect(
            extDb.user.update({ where: { id: alice.id }, data: { name: 'Alice Updated' }, ...cacheOption }),
        ).toResolveTruthy();
        await expect(
            extDb.user.updateMany({ where: { name: 'Bob' }, data: { name: 'Bob Updated' }, ...cacheOption }),
        ).resolves.toHaveProperty('count');
        await expect(
            extDb.user.updateManyAndReturn({
                where: { name: 'Charlie' },
                data: { name: 'Charlie Updated' },
                ...cacheOption,
            }),
        ).toResolveTruthy();
        await expect(
            extDb.user.upsert({
                where: { id: 999 },
                create: { name: 'Eve' },
                update: { name: 'Eve Updated' },
                ...cacheOption,
            }),
        ).resolves.toMatchObject({ name: 'Eve' });

        // delete operations
        await expect(extDb.user.delete({ where: { id: bob.id }, ...cacheOption })).toResolveTruthy();
        await expect(extDb.user.deleteMany({ where: { name: 'David' }, ...cacheOption })).resolves.toHaveProperty(
            'count',
        );
    });

    it('should allow extending specific operations', async () => {
        const extDb = db.$use(
            definePlugin<
                typeof schema,
                {
                    [Op in CoreReadOperations]: CacheOptions;
                }
            >({
                id: 'cache',
                extQueryArgs: {
                    getValidationSchema: (operation) => {
                        if (!(CoreReadOperations as readonly string[]).includes(operation)) {
                            return undefined;
                        }
                        return cacheSchema;
                    },
                },
            }),
        );

        // "create" is not extended
        // @ts-expect-error
        await expect(extDb.user.create({ data: { name: 'Bob' }, cache: {} })).rejects.toThrow('Unrecognized key');

        await extDb.user.create({ data: { name: 'Alice' } });

        await expect(extDb.user.findMany({ cache: { ttl: 100 } })).toResolveWithLength(1);
        await expect(extDb.user.count({ where: { name: 'Alice' }, cache: { ttl: 200 } })).resolves.toBe(1);
    });

    it('should allow different extensions for different operations', async () => {
        let gotTTL: number | undefined = undefined;
        let gotBust: boolean | undefined = undefined;

        const extDb = db.$use(
            definePlugin<
                typeof schema,
                {
                    [Op in CoreReadOperations]: CacheOptions;
                } & {
                    [Op in CoreWriteOperations]: CacheBustOptions;
                }
            >({
                id: 'cache',
                extQueryArgs: {
                    getValidationSchema: (operation) => {
                        if ((CoreReadOperations as readonly string[]).includes(operation)) {
                            return cacheSchema;
                        } else if ((CoreWriteOperations as readonly string[]).includes(operation)) {
                            return cacheBustSchema;
                        }
                        return undefined;
                    },
                },

                onQuery: async ({ args, proceed }) => {
                    if ('cache' in args) {
                        gotTTL = (args as CacheOptions).cache?.ttl;
                        gotBust = (args as CacheBustOptions).cache?.bust;
                    }
                    return proceed(args);
                },
            }),
        );

        gotBust = undefined;
        await extDb.user.create({ data: { name: 'Alice' }, cache: { bust: true } });
        expect(gotBust).toBe(true);

        // ttl extension is not applied to "create"
        // @ts-expect-error
        await expect(extDb.user.create({ data: { name: 'Bob' }, cache: { ttl: 100 } })).rejects.toThrow(
            'Unrecognized key',
        );

        gotTTL = undefined;
        await expect(extDb.user.findMany({ cache: { ttl: 5000 } })).toResolveWithLength(1);
        expect(gotTTL).toBe(5000);

        // bust extension is not applied to "findMany"
        // @ts-expect-error
        await expect(extDb.user.findMany({ cache: { bust: true } })).rejects.toThrow('Unrecognized key');
    });

    it('should isolate validation schemas between clients', async () => {
        const extDb = db.$use(
            definePlugin<
                typeof schema,
                {
                    all: CacheOptions;
                }
            >({
                id: 'cache',
                extQueryArgs: {
                    getValidationSchema: () => cacheSchema,
                },
            }),
        );

        // @ts-expect-error
        await expect(db.user.findMany({ cache: { ttl: 1000 } })).rejects.toThrow('Unrecognized key');
        await expect(extDb.user.findMany({ cache: { ttl: 1000 } })).toResolveWithLength(0);

        // do it again to make sure cache is not shared
        // @ts-expect-error
        await expect(db.user.findMany({ cache: { ttl: 2000 } })).rejects.toThrow('Unrecognized key');
        await expect(extDb.user.findMany({ cache: { ttl: 2000 } })).toResolveWithLength(0);
    });
});
