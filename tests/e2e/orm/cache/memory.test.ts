import { type ClientContract } from '@zenstackhq/orm';
import { createTestClient } from '@zenstackhq/testtools';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { defineCachePlugin } from '@zenstackhq/plugin-cache';
import { MemoryCache } from '@zenstackhq/plugin-cache/providers/memory';
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

    test('respects ttl', async () => {
        const extDb = db.$use(defineCachePlugin({
            provider: new MemoryCache(),
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
        ])

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

        vi.advanceTimersByTime(60000);

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
    })
});