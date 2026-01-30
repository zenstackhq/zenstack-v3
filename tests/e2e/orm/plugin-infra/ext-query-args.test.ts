import { definePlugin, type ClientContract } from '@zenstackhq/orm';
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
        cache: z
            .strictObject({
                bust: z.boolean().optional(),
            })
            .optional(),
    });

    type CacheOptions = z.infer<typeof cacheSchema>;

    beforeEach(async () => {
        db = await createTestClient(schema);
        await db.user.deleteMany();
    });

    afterEach(async () => {
        await db?.$disconnect();
    });

    it('should allow extending grouped operations', async () => {
        let gotTTL: number | undefined = undefined;

        const cachePlugin = definePlugin({
            id: 'cache',
            queryArgs: {
                $read: cacheSchema,
                $create: cacheBustSchema,
                $update: cacheBustSchema,
                $delete: cacheBustSchema,
            },

            onQuery: async ({ args, proceed }) => {
                if (args && 'cache' in args) {
                    gotTTL = (args as CacheOptions).cache?.ttl;
                }
                return proceed(args);
            },
        });

        const extDb = db.$use(cachePlugin);

        // cache is optional
        const alice = await extDb.user.create({ data: { name: 'Alice' } });

        // bust is optional
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

        // read args are not allowed in create
        // @ts-expect-error
        await expect(extDb.user.create({ data: { name: 'Charlie' }, cache: { ttl: 1000 } })).rejects.toThrow(
            'Unrecognized key',
        );

        // create args are not allowed in read
        // @ts-expect-error
        await expect(extDb.user.findMany({ cache: { bust: true } })).rejects.toThrow('Unrecognized key');

        // validate all other operations

        const cacheOption = { cache: { ttl: 1000 } } as const;
        const cacheBustOption = { cache: { bust: true } } as const;

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
        await expect(
            extDb.user.createMany({ data: [{ name: 'Charlie' }], ...cacheBustOption }),
        ).resolves.toHaveProperty('count');

        const isMySql = db.$schema.provider.type === ('mysql' as any);

        if (!isMySql) {
            await expect(
                extDb.user.createManyAndReturn({ data: [{ name: 'David' }], ...cacheBustOption }),
            ).toResolveWithLength(1);
        }

        // update operations
        await expect(
            extDb.user.update({ where: { id: alice.id }, data: { name: 'Alice Updated' }, ...cacheBustOption }),
        ).toResolveTruthy();
        await expect(
            extDb.user.updateMany({ where: { name: 'Bob' }, data: { name: 'Bob Updated' }, ...cacheBustOption }),
        ).resolves.toHaveProperty('count');

        if (!isMySql) {
            await expect(
                extDb.user.updateManyAndReturn({
                    where: { name: 'Charlie' },
                    data: { name: 'Charlie Updated' },
                    ...cacheBustOption,
                }),
            ).toResolveTruthy();
        }

        await expect(
            extDb.user.upsert({
                where: { id: 999 },
                create: { name: 'Eve' },
                update: { name: 'Eve Updated' },
                ...cacheBustOption,
            }),
        ).resolves.toMatchObject({ name: 'Eve' });

        // delete operations
        await expect(extDb.user.delete({ where: { id: bob.id }, ...cacheBustOption })).toResolveTruthy();
        await expect(extDb.user.deleteMany({ where: { name: 'David' }, ...cacheBustOption })).resolves.toHaveProperty(
            'count',
        );

        // validate transaction
        await extDb.$transaction(async (tx) => {
            await expect(tx.user.findMany(cacheOption)).toResolveTruthy();
        });

        // validate $use
        await expect(extDb.$use({ id: 'foo' }).user.findMany(cacheOption)).toResolveTruthy();

        // validate $setOptions
        await expect(
            extDb.$setOptions({ ...extDb.$options, validateInput: false }).user.findMany(cacheOption),
        ).toResolveTruthy();

        // validate $setAuth
        await expect(extDb.$setAuth({ id: 1 }).user.findMany(cacheOption)).toResolveTruthy();
    });

    it('should allow extending all operations', async () => {
        const extDb = db.$use(
            definePlugin({
                id: 'cache',
                queryArgs: {
                    $all: cacheSchema,
                },
            }),
        );

        const alice = await extDb.user.create({ data: { name: 'Alice' }, cache: {} });
        await expect(extDb.user.findMany({ cache: { ttl: 100 } })).toResolveWithLength(1);
        await expect(extDb.user.count({ where: { name: 'Alice' }, cache: { ttl: 200 } })).resolves.toBe(1);
        await expect(
            extDb.user.update({ where: { id: alice.id }, data: { name: 'Alice Updated' }, cache: { ttl: 300 } }),
        ).toResolveTruthy();
        await expect(extDb.user.delete({ where: { id: alice.id }, cache: { ttl: 400 } })).toResolveTruthy();
    });

    it('should allow extending specific operations', async () => {
        const extDb = db.$use(
            definePlugin({
                id: 'cache',
                queryArgs: {
                    $read: cacheSchema,
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

    it('should isolate validation schemas between clients', async () => {
        const extDb = db.$use(
            definePlugin({
                id: 'cache',
                queryArgs: {
                    $all: cacheSchema,
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

    it('should merge $create and $update schemas for upsert operation', async () => {
        // Define different schemas for $create and $update
        const createOnlySchema = z.object({
            tracking: z
                .strictObject({
                    source: z.string().optional(),
                })
                .optional(),
        });

        const updateOnlySchema = z.object({
            audit: z
                .strictObject({
                    reason: z.string().optional(),
                })
                .optional(),
        });

        const extDb = db.$use(
            definePlugin({
                id: 'test',
                queryArgs: {
                    $create: createOnlySchema,
                    $update: updateOnlySchema,
                },
            }),
        );

        // upsert should accept both tracking (from $create) and audit (from $update)
        await expect(
            extDb.user.upsert({
                where: { id: 999 },
                create: { name: 'Alice' },
                update: { name: 'Alice Updated' },
                tracking: { source: 'test' },
                audit: { reason: 'testing merge' },
            }),
        ).resolves.toMatchObject({ name: 'Alice' });

        // upsert should reject tracking-only in update operations
        await expect(
            extDb.user.update({
                where: { id: 1 },
                data: { name: 'Test' },
                // @ts-expect-error - tracking is only for $create
                tracking: { source: 'test' },
            }),
        ).rejects.toThrow('Unrecognized key');

        // upsert should reject audit-only in create operations
        await expect(
            extDb.user.create({
                data: { name: 'Bob' },
                // @ts-expect-error - audit is only for $update
                audit: { reason: 'test' },
            }),
        ).rejects.toThrow('Unrecognized key');

        // verify that upsert without both is fine
        await expect(
            extDb.user.upsert({
                where: { id: 888 },
                create: { name: 'Charlie' },
                update: { name: 'Charlie Updated' },
            }),
        ).resolves.toMatchObject({ name: 'Charlie' });

        // verify that upsert with only tracking is fine
        await expect(
            extDb.user.upsert({
                where: { id: 777 },
                create: { name: 'David' },
                update: { name: 'David Updated' },
                tracking: { source: 'test' },
            }),
        ).resolves.toMatchObject({ name: 'David' });

        // verify that upsert with only audit is fine
        await expect(
            extDb.user.upsert({
                where: { id: 666 },
                create: { name: 'Eve' },
                update: { name: 'Eve Updated' },
                audit: { reason: 'testing' },
            }),
        ).resolves.toMatchObject({ name: 'Eve' });

        // verify that upsert with both is fine
        await expect(
            extDb.user.upsert({
                where: { id: 555 },
                create: { name: 'Frank' },
                update: { name: 'Frank Updated' },
                tracking: { source: 'test' },
                audit: { reason: 'testing both' },
            }),
        ).resolves.toMatchObject({ name: 'Frank' });
    });
});
