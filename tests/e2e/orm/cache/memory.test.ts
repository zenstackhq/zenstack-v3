import { type ClientContract } from '@zenstackhq/orm';
import { createTestClient } from '@zenstackhq/testtools';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineCachePlugin } from '@zenstackhq/plugin-cache';
import { MemoryCacheProvider } from '@zenstackhq/plugin-cache/providers/memory';
import { schema } from '../schemas/basic';

describe('Cache plugin (memory)', () => {
    let db: ClientContract<typeof schema>;

    beforeEach(async () => {
        db = await createTestClient(schema);
        vi.useFakeTimers();
    });

    afterEach(async () => {
        vi.useRealTimers();
        await db?.$disconnect();
    });

    it('respects ttl', async () => {
        const extDb = db.$use(defineCachePlugin({
            provider: new MemoryCacheProvider(),
        }));

        expect(extDb.$cache.status).toBe(null);
        expect(extDb.$cache.revalidation).toBe(null);

        const user = await extDb.user.create({
            data: {
                email: 'test@email.com',
            },
        });

        await Promise.all([
            extDb.user.findFirst({
                where: {
                    id: user.id,
                },

                cache: {
                    ttl: 60,
                },
            }),

            extDb.user.findUnique({
                where: {
                    id: user.id,
                },

                cache: {
                    ttl: 60,
                },
            }),

            extDb.user.findMany({
                cache: {
                    ttl: 60,
                },
            }),

            extDb.user.findFirstOrThrow({
                where: {
                    id: user.id,
                },

                cache: {
                    ttl: 60,
                },
            }),

            extDb.user.findUniqueOrThrow({
                where: {
                    id: user.id,
                },

                cache: {
                    ttl: 60,
                },
            }),

            extDb.user.exists({
                where: {
                    id: user.id,
                },

                cache: {
                    ttl: 60,
                },
            }),

            extDb.user.count({
                cache: {
                    ttl: 60,
                },
            }),

            // extDb.user.aggregate({
            //     where: {
            //         id: user.id,
            //     },

            //     cache: {
            //         ttl: 60,
            //     },
            // }),

            extDb.user.groupBy({
                by: 'id',

                cache: {
                    ttl: 60,
                },
            }),
        ]);

        expect(extDb.$cache.status).toBe('miss');

        await Promise.all([
            extDb.user.delete({
                where: {
                    id: user.id,
                },
            }),

            extDb.user.create({
                data: {
                    email: 'test2@email.com',
                },
            }),

            extDb.user.create({
                data: {
                    email: 'test3@email.com',
                },
            }),
        ]);

        await expect(extDb.user.findFirst({
            where: {
                id: user.id,
            },

            cache: {
                ttl: 60,
            },
        })).resolves.toMatchObject({
            email: 'test@email.com',
        });

        expect(extDb.$cache.status).toBe('hit');

        await expect(extDb.user.findUnique({
            where: {
                id: user.id,
            },

            cache: {
                ttl: 60,
            },
        })).resolves.toMatchObject({
            email: 'test@email.com',
        });

        await expect(extDb.user.findMany({
            cache: {
                ttl: 60,
            },
        })).resolves.toHaveLength(1);

        await expect(extDb.user.findFirstOrThrow({
            where: {
                id: user.id,
            },

            cache: {
                ttl: 60,
            },
        })).resolves.toMatchObject({
            email: 'test@email.com',
        });

        await expect(extDb.user.findUniqueOrThrow({
            where: {
                id: user.id,
            },

            cache: {
                ttl: 60,
            },
        })).resolves.toMatchObject({
            email: 'test@email.com',
        });

        await expect(extDb.user.exists({
            where: {
                id: user.id,
            },

            cache: {
                ttl: 60,
            },
        })).resolves.toBe(true);

        await expect(extDb.user.count({
            cache: {
                ttl: 60,
            },
        })).resolves.toBe(1);

        // await expect(extDb.user.aggregate({
        //     where: {
        //         id: user.id,
        //     },

        //     cache: {
        //         ttl: 60,
        //     },
        // })).resolves.toHaveLength(1);

        await expect(extDb.user.groupBy({
            by: 'id',

            cache: {
                ttl: 60,
            },
        })).resolves.toHaveLength(1);

        vi.advanceTimersByTime(61000);

        await expect(extDb.user.findFirst({
            where: {
                id: user.id,
            },

            cache: {
                ttl: 60,
            },
        })).resolves.toBeNull();

        await expect(extDb.user.findUnique({
            where: {
                id: user.id,
            },

            cache: {
                ttl: 60,
            },
        })).resolves.toBeNull();

        await expect(extDb.user.findMany({
            cache: {
                ttl: 60,
            },
        })).resolves.toHaveLength(2);

        await expect(extDb.user.findFirstOrThrow({
            where: {
                id: user.id,
            },

            cache: {
                ttl: 60,
            },
        })).rejects.toThrow('Record not found');

        await expect(extDb.user.findUniqueOrThrow({
            where: {
                id: user.id,
            },

            cache: {
                ttl: 60,
            },
        })).rejects.toThrow('Record not found');

        await expect(extDb.user.exists({
            where: {
                id: user.id,
            },

            cache: {
                ttl: 60,
            },
        })).resolves.toBe(false);

        await expect(extDb.user.count({
            cache: {
                ttl: 60,
            },
        })).resolves.toBe(2);

        await expect(extDb.user.groupBy({
            by: 'id',

            cache: {
                ttl: 60,
            },
        })).resolves.toHaveLength(2);
    });

    it('respects swr', async () => {
        const extDb = db.$use(defineCachePlugin({
            provider: new MemoryCacheProvider(),
        }));

        const user = await extDb.user.create({
            data: {
                email: 'test@email.com',
            },
        });

        await extDb.user.findFirst({
            where: {
                id: user.id,
            },

            cache: {
                swr: 60,
            },
        });

        await extDb.user.update({
            data: {
                name: 'newname',
            },

            where: {
                id: user.id,
            },
        });

        await expect(extDb.user.findFirst({
            where: {
                id: user.id,
            },

            cache: {
                swr: 60,
            },
        })).resolves.toMatchObject({
            name: null,
        });

        expect(extDb.$cache.status).toBe('stale');
        const revalidatedUser = await extDb.$cache.revalidation;

        expect(revalidatedUser).toMatchObject({
            name: 'newname',
        });

        await expect(extDb.user.findFirst({
            where: {
                id: user.id,
            },

            cache: {
                swr: 60,
            },
        })).resolves.toMatchObject({
            name: 'newname',
        });
    });

    it('respects ttl and swr simultaneously', async () => {
        const extDb = db.$use(defineCachePlugin({
            provider: new MemoryCacheProvider(),
        }));

        const user = await extDb.user.create({
            data: {
                email: 'test@email.com',
            },
        });

        await extDb.user.findFirst({
            where: {
                id: user.id,
            },

            cache: {
                ttl: 60,
                swr: 60,
            },
        });

        await extDb.user.update({
            data: {
                name: 'newname',
            },

            where: {
                id: user.id,
            },
        });

        await expect(extDb.user.findFirst({
            where: {
                id: user.id,
            },

            cache: {
                ttl: 60,
                swr: 60,
            },
        })).resolves.toMatchObject({
            name: null,
        });

        expect(extDb.$cache.status).toBe('hit');
        vi.advanceTimersByTime(65000);

        await expect(extDb.user.findFirst({
            where: {
                id: user.id,
            },

            cache: {
                ttl: 60,
                swr: 60,
            },
        })).resolves.toMatchObject({
            name: null,
        });

        expect(extDb.$cache.status).toBe('stale');
        expect(extDb.$cache.revalidation).not.toBe(null);
        await extDb.$cache.revalidation;

        await expect(extDb.user.findFirst({
            where: {
                id: user.id,
            },

            cache: {
                ttl: 60,
                swr: 60,
            },
        })).resolves.toMatchObject({
            name: 'newname',
        });
    });

    it('supports invalidating all entries', async () => {
        const extDb = db.$use(defineCachePlugin({
            provider: new MemoryCacheProvider(),
        }));

        const user = await extDb.user.create({
            data: {
                email: 'test@email.com',
            },
        });

        await Promise.all([
            extDb.user.findFirst({
                where: {
                    id: user.id,
                },

                cache: {
                    ttl: 60,
                },
            }),

            extDb.user.findUnique({
                where: {
                    id: user.id,
                },

                cache: {
                    ttl: 60,
                },
            }),

            extDb.user.findMany({
                cache: {
                    ttl: 60,
                },
            }),

            extDb.user.findFirstOrThrow({
                where: {
                    id: user.id,
                },

                cache: {
                    ttl: 60,
                },
            }),

            extDb.user.findUniqueOrThrow({
                where: {
                    id: user.id,
                },

                cache: {
                    ttl: 60,
                },
            }),

            extDb.user.exists({
                where: {
                    id: user.id,
                },

                cache: {
                    ttl: 60,
                },
            }),

            extDb.user.count({
                cache: {
                    ttl: 60,
                },
            }),

            // extDb.user.aggregate({
            //     where: {
            //         id: user.id,
            //     },

            //     cache: {
            //         ttl: 60,
            //     },
            // }),

            extDb.user.groupBy({
                by: 'id',

                cache: {
                    ttl: 60,
                },
            }),
        ]);

        await Promise.all([
            extDb.user.delete({
                where: {
                    id: user.id,
                },
            }),

            extDb.user.create({
                data: {
                    email: 'test2@email.com',
                },
            }),

            extDb.user.create({
                data: {
                    email: 'test3@email.com',
                },
            }),
        ]);

        extDb.$cache.invalidateAll();

        await expect(extDb.user.findFirst({
            where: {
                id: user.id,
            },

            cache: {
                ttl: 60,
            },
        })).resolves.toBeNull();

        await expect(extDb.user.findUnique({
            where: {
                id: user.id,
            },

            cache: {
                ttl: 60,
            },
        })).resolves.toBeNull();

        await expect(extDb.user.findMany({
            cache: {
                ttl: 60,
            },
        })).resolves.toHaveLength(2);

        await expect(extDb.user.findFirstOrThrow({
            where: {
                id: user.id,
            },

            cache: {
                ttl: 60,
            },
        })).rejects.toThrow('Record not found');

        await expect(extDb.user.findUniqueOrThrow({
            where: {
                id: user.id,
            },

            cache: {
                ttl: 60,
            },
        })).rejects.toThrow('Record not found');

        await expect(extDb.user.exists({
            where: {
                id: user.id,
            },

            cache: {
                ttl: 60,
            },
        })).resolves.toBe(false);

        await expect(extDb.user.count({
            cache: {
                ttl: 60,
            },
        })).resolves.toBe(2);

        await expect(extDb.user.groupBy({
            by: 'id',

            cache: {
                ttl: 60,
            },
        })).resolves.toHaveLength(2);
    });

    it('supports invalidating by tags', async () => {
        const extDb = db.$use(defineCachePlugin({
            provider: new MemoryCacheProvider(),
        }));

        const user1 = await extDb.user.create({
            data: {
                email: 'test@email.com',
            },
        });

        const user2 = await extDb.user.create({
            data: {
                email: 'test2@email.com',
            },
        });

        const post1 = await extDb.post.create({
            data: {
                title: 'title',
                authorId: user1.id,
            },
        });

        const post2 = await extDb.post.create({
            data: {
                title: 'title',
                authorId: user2.id,
            },
        });

        await Promise.all([
            extDb.user.findUnique({
                where: {
                    id: user1.id,
                },

                cache: {
                    ttl: 60,
                    tags: ['user1'],
                },
            }),

            extDb.user.findUnique({
                where: {
                    id: user2.id,
                },

                cache: {
                    ttl: 60,
                    tags: ['user2'],
                },
            }),

            extDb.post.findUnique({
                where: {
                    id: post1.id,
                },

                cache: {
                    ttl: 60,
                    tags: ['post', 'user1'],
                },
            }),

            extDb.post.findUnique({
                where: {
                    id: post2.id,
                },

                cache: {
                    ttl: 60,
                },
            }),
        ]);

        await Promise.all([
            extDb.user.update({
                data: {
                    name: 'newname',
                },

                where: {
                    id: user1.id,
                },
            }),

            extDb.user.update({
                data: {
                    name: 'newname',
                },

                where: {
                    id: user2.id,
                },
            }),

            extDb.post.update({
                data: {
                    title: 'newtitle',
                },

                where: {
                    id: post1.id,
                },
            }),
        ]);

        await extDb.$cache.invalidate({
            tags: [],
        });

        // everything should still be the same as when we started
        await expect(extDb.user.findUnique({
            where: {
                id: user1.id,
            },

            cache: {
                ttl: 60,
                tags: ['user1'],
            },
        })).resolves.toMatchObject({
            name: null,
        });

        await expect(extDb.user.findUnique({
            where: {
                id: user2.id,
            },

            cache: {
                ttl: 60,
                tags: ['user2'],
            },
        })).resolves.toMatchObject({
            name: null,
        });

        await expect(extDb.post.findUnique({
            where: {
                id: post1.id,
            },

            cache: {
                ttl: 60,
                tags: ['post', 'user1'],
            },
        })).resolves.toMatchObject({
            title: 'title',
        });

        await extDb.$cache.invalidate({
            tags: ['these', 'tags', 'do', 'not', 'exist'],
        });

        // everything should still be the same as when we started
        await expect(extDb.user.findUnique({
            where: {
                id: user1.id,
            },

            cache: {
                ttl: 60,
                tags: ['user1'],
            },
        })).resolves.toMatchObject({
            name: null,
        });

        await expect(extDb.user.findUnique({
            where: {
                id: user2.id,
            },

            cache: {
                ttl: 60,
                tags: ['user2'],
            },
        })).resolves.toMatchObject({
            name: null,
        });

        await expect(extDb.post.findUnique({
            where: {
                id: post1.id,
            },

            cache: {
                ttl: 60,
                tags: ['post', 'user1'],
            },
        })).resolves.toMatchObject({
            title: 'title',
        });

        await extDb.$cache.invalidate({
            tags: ['user1'],
        });

        // only user2 and post2 stays the same
        await expect(extDb.user.findUnique({
            where: {
                id: user1.id,
            },

            cache: {
                ttl: 60,
                tags: ['user1'],
            },
        })).resolves.toMatchObject({
            name: 'newname',
        });

        await expect(extDb.user.findUnique({
            where: {
                id: user2.id,
            },

            cache: {
                ttl: 60,
                tags: ['user2'],
            },
        })).resolves.toMatchObject({
            name: null,
        });

        await expect(extDb.post.findUnique({
            where: {
                id: post1.id,
            },

            cache: {
                ttl: 60,
                tags: ['post', 'user1'],
            },
        })).resolves.toMatchObject({
            title: 'newtitle',
        });

        await expect(extDb.post.findUnique({
            where: {
                id: post2.id,
            },

            cache: {
                ttl: 60,
            },
        })).resolves.toMatchObject({
            title: 'title',
        });
    });

    it('supports custom options', async () => {
        const onIntervalExpiration = vi.fn(() => {});
        const extDb = db.$use(defineCachePlugin({
            provider: new MemoryCacheProvider({
                checkInterval: 10,
                onIntervalExpiration,
            }),
        }));

        await extDb.user.exists({
            cache: {
                ttl: 5,
            },
        });

        vi.advanceTimersByTime(5100);
        expect(onIntervalExpiration).not.toHaveBeenCalled();
        vi.advanceTimersByTime(10000);
        expect(onIntervalExpiration).toHaveBeenCalledOnce();
        
        // @ts-expect-error
        const arg = onIntervalExpiration.mock.lastCall[0];

        expect(arg).toMatchObject({
            result: false,
            options: {
                ttl: 5,
            },
        })
    });

    it('handles edge cases', async () => {
        const extDb = db.$use(defineCachePlugin({
            provider: new MemoryCacheProvider(),
        }));

        await expect(extDb.user.findMany({
            cache: {
                ttl: 0,
            },
        })).rejects.toThrow('Invalid findMany');

        await expect(extDb.user.findMany({
            cache: {
                swr: 0,
            },
        })).rejects.toThrow('Invalid findMany');

        await expect(extDb.user.findMany({
            cache: {
                ttl: 0,
                swr: 0,
            },
        })).rejects.toThrow('Invalid findMany');
    });
});