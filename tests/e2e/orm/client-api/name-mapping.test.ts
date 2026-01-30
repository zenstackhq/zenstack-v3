import type { ClientContract } from '@zenstackhq/orm';
import { createTestClient } from '@zenstackhq/testtools';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { schema, type SchemaType } from '../schemas/name-mapping/schema';

describe('Name mapping tests', () => {
    let db: ClientContract<SchemaType>;

    beforeEach(async () => {
        db = await createTestClient(schema, {
            usePrismaPush: true,
            schemaFile: path.join(__dirname, '../schemas/name-mapping/schema.zmodel'),
        });
    });

    afterEach(async () => {
        await db.$disconnect();
    });

    it('works with create', async () => {
        await expect(
            db.user.create({
                data: {
                    email: 'u1@test.com',
                    posts: {
                        create: {
                            title: 'Post1',
                        },
                    },
                },
            }),
        ).resolves.toMatchObject({
            id: expect.any(Number),
            email: 'u1@test.com',
            role: 'USER', // mapped enum value
        });

        let rawRead = await db.$qbRaw
            .selectFrom('users')
            .where('user_email', '=', 'u1@test.com')
            .selectAll()
            .executeTakeFirst();
        await expect(rawRead).toMatchObject({
            user_email: 'u1@test.com',
            user_role: 'role_user',
        });

        rawRead = await db.$qbRaw
            .selectFrom('users')
            .where('user_role', '=', 'role_user')
            .selectAll()
            .executeTakeFirst();
        await expect(rawRead).toMatchObject({
            user_email: 'u1@test.com',
            user_role: 'role_user',
        });

        await expect(
            db.user.create({
                data: {
                    email: 'u1_1@test.com',
                    role: 'MODERATOR', // unmapped enum value
                },
            }),
        ).resolves.toMatchObject({
            role: 'MODERATOR',
        });

        rawRead = await db.$qbRaw
            .selectFrom('users')
            .where('user_email', '=', 'u1_1@test.com')
            .selectAll()
            .executeTakeFirst();
        await expect(rawRead).toMatchObject({
            user_role: 'MODERATOR',
        });

        rawRead = await db.$qbRaw
            .selectFrom('users')
            .where('user_role', '=', 'MODERATOR')
            .selectAll()
            .executeTakeFirst();
        await expect(rawRead).toMatchObject({
            user_role: 'MODERATOR',
        });

        const mysql = db.$schema.provider.type === ('mysql' as any);

        if (!mysql) {
            await expect(
                db.$qb
                    .insertInto('User')
                    .values({
                        email: 'u2@test.com',
                        role: 'ADMIN',
                    })
                    .returning(['id', 'email', 'role'])
                    .executeTakeFirst(),
            ).resolves.toMatchObject({
                id: expect.any(Number),
                email: 'u2@test.com',
                role: 'ADMIN',
            });
        } else {
            // mysql doesn't support returning, simply insert
            await db.$qb
                .insertInto('User')
                .values({
                    email: 'u2@test.com',
                    role: 'ADMIN',
                })
                .executeTakeFirst();
        }

        rawRead = await db.$qbRaw
            .selectFrom('users')
            .where('user_email', '=', 'u2@test.com')
            .selectAll()
            .executeTakeFirst();
        await expect(rawRead).toMatchObject({
            user_role: 'role_admin',
        });

        if (!mysql) {
            await expect(
                db.$qb
                    .insertInto('User')
                    .values({
                        email: 'u3@test.com',
                    })
                    .returning(['User.id', 'User.email'])
                    .executeTakeFirst(),
            ).resolves.toMatchObject({
                id: expect.any(Number),
                email: 'u3@test.com',
            });

            await expect(
                db.$qb
                    .insertInto('User')
                    .values({
                        email: 'u4@test.com',
                    })
                    .returningAll()
                    .executeTakeFirst(),
            ).resolves.toMatchObject({
                id: expect.any(Number),
                email: 'u4@test.com',
                role: 'USER',
            });
        }
    });

    it('works with find', async () => {
        const user = await db.user.create({
            data: {
                email: 'u1@test.com',
                posts: {
                    create: {
                        title: 'Post1',
                    },
                },
            },
        });

        await expect(
            db.user.findFirst({
                where: { email: 'u1@test.com' },
                select: {
                    id: true,
                    email: true,
                    role: true,
                    posts: { where: { title: { contains: 'Post1' } }, select: { title: true } },
                },
            }),
        ).resolves.toMatchObject({
            id: expect.any(Number),
            email: 'u1@test.com',
            role: 'USER',
            posts: [{ title: 'Post1' }],
        });

        await expect(
            db.user.findFirst({
                where: { role: 'USER' },
                select: {
                    email: true,
                    role: true,
                },
            }),
        ).resolves.toMatchObject({
            email: 'u1@test.com',
            role: 'USER',
        });

        await expect(
            db.user.findMany({
                where: { role: 'USER' },
                select: {
                    email: true,
                    role: true,
                },
            }),
        ).resolves.toEqual([expect.objectContaining({ email: 'u1@test.com', role: 'USER' })]);

        await expect(
            db.user.findFirst({
                where: { role: { in: ['USER'] } },
                select: {
                    email: true,
                    role: true,
                },
            }),
        ).resolves.toMatchObject({
            email: 'u1@test.com',
            role: 'USER',
        });

        await expect(
            db.user.findMany({
                where: { role: { in: ['USER'] } },
                select: {
                    email: true,
                    role: true,
                },
            }),
        ).resolves.toEqual([expect.objectContaining({ email: 'u1@test.com', role: 'USER' })]);

        await expect(
            db.user.findMany({
                where: {
                    AND: [{ role: { in: ['USER'] } }, { role: { in: ['USER'] } }, { OR: [{ role: { in: ['USER'] } }] }],
                },
                select: {
                    email: true,
                    role: true,
                },
            }),
        ).resolves.toEqual([expect.objectContaining({ email: 'u1@test.com', role: 'USER' })]);

        // select all
        await expect(
            db.user.findFirst({
                where: { email: 'u1@test.com' },
            }),
        ).resolves.toMatchObject({
            id: expect.any(Number),
            email: 'u1@test.com',
            role: 'USER',
        });

        // nested select
        await expect(
            db.user.findFirst({
                include: { posts: { where: { title: 'Post1' } } },
            }),
        ).resolves.toMatchObject({
            posts: expect.arrayContaining([expect.objectContaining({ title: 'Post1', authorId: user.id })]),
        });

        await expect(
            db.$qb.selectFrom('User').selectAll().where('email', '=', 'u1@test.com').executeTakeFirst(),
        ).resolves.toMatchObject({
            id: expect.any(Number),
            email: 'u1@test.com',
            role: 'USER',
        });

        await expect(
            db.$qb
                .selectFrom('User')
                .select(['User.email', 'User.role'])
                .where('email', '=', 'u1@test.com')
                .executeTakeFirst(),
        ).resolves.toMatchObject({
            email: 'u1@test.com',
            role: 'USER',
        });

        // name mapping for enum value in where clause, with unqualified column name
        await expect(
            db.$qb.selectFrom('User').select(['User.email', 'User.role']).where('role', '=', 'USER').executeTakeFirst(),
        ).resolves.toMatchObject({
            email: 'u1@test.com',
            role: 'USER',
        });

        // name mapping for enum value in simple where clause, with qualified column name
        await expect(
            db.$qb
                .selectFrom('User as u')
                .select(['u.email', 'u.role'])
                .where('u.role', '=', 'USER')
                .executeTakeFirst(),
        ).resolves.toMatchObject({
            email: 'u1@test.com',
            role: 'USER',
        });

        // enum value in list
        await expect(
            db.$qb
                .selectFrom('User')
                .select(['User.email', 'User.role'])
                .where('role', 'in', ['USER', 'ADMIN'])
                .executeTakeFirst(),
        ).resolves.toMatchObject({
            email: 'u1@test.com',
            role: 'USER',
        });

        await expect(
            db.$qb
                .selectFrom('User')
                .select(['email'])
                .whereRef('email', '=', 'email')
                .orderBy('email')
                .executeTakeFirst(),
        ).resolves.toMatchObject({
            email: 'u1@test.com',
        });

        await expect(
            db.$qb
                .selectFrom('Post')
                .innerJoin('User', 'User.id', 'Post.authorId')
                .select(['User.email', 'Post.authorId', 'Post.title'])
                .whereRef('Post.authorId', '=', 'User.id')
                .executeTakeFirst(),
        ).resolves.toMatchObject({
            authorId: user.id,
            title: 'Post1',
        });

        await expect(
            db.$qb
                .selectFrom('Post')
                .innerJoin('User', (join) => join.onRef('User.id', '=', 'Post.authorId'))
                .select(['User.email', 'Post.authorId', 'Post.title'])
                .whereRef('Post.authorId', '=', 'User.id')
                .executeTakeFirst(),
        ).resolves.toMatchObject({
            authorId: user.id,
            title: 'Post1',
        });

        await expect(
            db.$qb
                .selectFrom('Post')
                .select(['id', 'title'])
                .select((eb) =>
                    eb.selectFrom('User').select(['email']).whereRef('User.id', '=', 'Post.authorId').as('email'),
                )
                .executeTakeFirst(),
        ).resolves.toMatchObject({
            id: user.id,
            title: 'Post1',
            email: 'u1@test.com',
        });
    });

    it('works with update', async () => {
        const user = await db.user.create({
            data: {
                email: 'u1@test.com',
                posts: {
                    create: {
                        id: 1,
                        title: 'Post1',
                    },
                },
            },
        });

        await expect(
            db.user.update({
                where: { id: user.id },
                data: {
                    email: 'u2@test.com',
                    role: 'ADMIN',
                    posts: {
                        update: {
                            where: { id: 1 },
                            data: { title: 'Post2' },
                        },
                    },
                },
                include: { posts: true },
            }),
        ).resolves.toMatchObject({
            id: user.id,
            email: 'u2@test.com',
            role: 'ADMIN',
            posts: [expect.objectContaining({ title: 'Post2' })],
        });

        if (db.$schema.provider.type !== ('mysql' as any)) {
            await expect(
                db.$qb
                    .updateTable('User')
                    .set({ email: (eb) => eb.fn('upper', [eb.ref('email')]), role: 'USER' })
                    .where('email', '=', 'u2@test.com')
                    .returning(['email', 'role'])
                    .executeTakeFirst(),
            ).resolves.toMatchObject({ email: 'U2@TEST.COM', role: 'USER' });

            await expect(
                db.$qb.updateTable('User as u').set({ email: 'u3@test.com' }).returningAll().executeTakeFirst(),
            ).resolves.toMatchObject({ id: expect.any(Number), email: 'u3@test.com', role: 'USER' });
        }
    });

    it('works with delete', async () => {
        const user = await db.user.create({
            data: {
                email: 'u1@test.com',
                posts: {
                    create: {
                        id: 1,
                        title: 'Post1',
                    },
                },
            },
        });

        if (db.$schema.provider.type !== ('mysql' as any)) {
            await expect(
                db.$qb.deleteFrom('Post').where('title', '=', 'Post1').returning(['id', 'title']).executeTakeFirst(),
            ).resolves.toMatchObject({
                id: user.id,
                title: 'Post1',
            });
        } else {
            // mysql doesn't support returning, simply delete
            await db.$qb.deleteFrom('Post').where('title', '=', 'Post1').executeTakeFirst();
        }

        await expect(
            db.user.delete({
                where: { email: 'u1@test.com' },
                include: { posts: true },
            }),
        ).resolves.toMatchObject({
            email: 'u1@test.com',
            posts: [],
            role: 'USER',
        });
    });

    it('works with count', async () => {
        await db.user.create({
            data: {
                email: 'u1@test.com',
                role: 'USER',
                posts: {
                    create: [{ title: 'Post1' }, { title: 'Post2' }],
                },
            },
        });

        await db.user.create({
            data: {
                email: 'u2@test.com',
                role: 'MODERATOR',
                posts: {
                    create: [{ title: 'Post3' }],
                },
            },
        });

        // Test ORM count operations
        await expect(db.user.count()).resolves.toBe(2);
        await expect(db.post.count()).resolves.toBe(3);
        await expect(db.user.count({ select: { email: true, role: true } })).resolves.toMatchObject({
            email: 2,
            role: 2,
        });

        await expect(db.user.count({ where: { email: 'u1@test.com' } })).resolves.toBe(1);
        await expect(db.post.count({ where: { title: { contains: 'Post1' } } })).resolves.toBe(1);

        await expect(db.post.count({ where: { author: { email: 'u1@test.com' } } })).resolves.toBe(2);

        // Test Kysely count operations
        const r = await db.$qb
            .selectFrom('User')
            .select((eb) => eb.fn.count('email').as('email_count'))
            .select((eb) => eb.fn.count('role').as('role_count'))
            .executeTakeFirst();
        await expect(Number(r?.email_count)).toBe(2);
        await expect(Number(r?.role_count)).toBe(2);
    });

    it('works with aggregate', async () => {
        await db.user.create({
            data: {
                id: 1,
                email: 'u1@test.com',
                role: 'USER',
                posts: {
                    create: [
                        { id: 1, title: 'Post1' },
                        { id: 2, title: 'Post2' },
                    ],
                },
            },
        });

        await db.user.create({
            data: {
                id: 2,
                email: 'u2@test.com',
                role: 'MODERATOR',
                posts: {
                    create: [{ id: 3, title: 'Post3' }],
                },
            },
        });

        // Test ORM aggregate operations
        await expect(
            db.user.aggregate({ _count: { id: true, email: true }, _max: { role: true }, _min: { role: true } }),
        ).resolves.toMatchObject({
            _count: { id: 2, email: 2 },
            _max: { role: 'USER' },
            _min: { role: 'MODERATOR' },
        });

        await expect(
            db.post.aggregate({ _count: { authorId: true }, _min: { authorId: true }, _max: { authorId: true } }),
        ).resolves.toMatchObject({
            _count: { authorId: 3 },
            _min: { authorId: 1 },
            _max: { authorId: 2 },
        });

        await expect(
            db.post.aggregate({
                where: { author: { email: 'u1@test.com' } },
                _count: { authorId: true },
                _min: { authorId: true },
                _max: { authorId: true },
            }),
        ).resolves.toMatchObject({
            _count: { authorId: 2 },
            _min: { authorId: 1 },
            _max: { authorId: 1 },
        });

        // Test Kysely aggregate operations
        const countResult = await db.$qb
            .selectFrom('User')
            .select((eb) => eb.fn.count('email').as('emailCount'))
            .executeTakeFirst();
        expect(Number(countResult?.emailCount)).toBe(2);

        const postAggResult = await db.$qb
            .selectFrom('Post')
            .select((eb) => [eb.fn.min('authorId').as('minAuthorId'), eb.fn.max('authorId').as('maxAuthorId')])
            .executeTakeFirst();
        expect(Number(postAggResult?.minAuthorId)).toBe(1);
        expect(Number(postAggResult?.maxAuthorId)).toBe(2);
    });

    it('works with groupBy', async () => {
        // Create test data with multiple posts per user
        await db.user.create({
            data: {
                id: 1,
                email: 'u1@test.com',
                role: 'USER',
                posts: {
                    create: [
                        { id: 1, title: 'Post1' },
                        { id: 2, title: 'Post2' },
                        { id: 3, title: 'Post3' },
                    ],
                },
            },
        });

        await db.user.create({
            data: {
                id: 2,
                email: 'u2@test.com',
                role: 'MODERATOR',
                posts: {
                    create: [
                        { id: 4, title: 'Post4' },
                        { id: 5, title: 'Post5' },
                    ],
                },
            },
        });

        await db.user.create({
            data: {
                id: 3,
                email: 'u3@test.com',
                posts: {
                    create: [{ id: 6, title: 'Post6' }],
                },
            },
        });

        // Test ORM groupBy operations
        const userGroupBy = await db.user.groupBy({
            by: ['email'],
            _count: { id: true },
        });
        expect(userGroupBy).toHaveLength(3);
        expect(userGroupBy).toEqual(
            expect.arrayContaining([
                { email: 'u1@test.com', _count: { id: 1 } },
                { email: 'u2@test.com', _count: { id: 1 } },
                { email: 'u3@test.com', _count: { id: 1 } },
            ]),
        );

        const userGroupBy1 = await db.user.groupBy({
            by: ['role'],
            _count: { id: true },
        });
        expect(userGroupBy1).toHaveLength(2);
        expect(userGroupBy1).toEqual(
            expect.arrayContaining([
                { role: 'USER', _count: { id: 2 } },
                { role: 'MODERATOR', _count: { id: 1 } },
            ]),
        );

        const postGroupBy = await db.post.groupBy({
            by: ['authorId'],
            _count: { id: true },
            _min: { id: true },
            _max: { id: true },
        });
        expect(postGroupBy).toHaveLength(3);
        expect(postGroupBy).toEqual(
            expect.arrayContaining([
                { authorId: 1, _count: { id: 3 }, _min: { id: 1 }, _max: { id: 3 } },
                { authorId: 2, _count: { id: 2 }, _min: { id: 4 }, _max: { id: 5 } },
                { authorId: 3, _count: { id: 1 }, _min: { id: 6 }, _max: { id: 6 } },
            ]),
        );

        const filteredGroupBy = await db.post.groupBy({
            by: ['authorId'],
            where: { title: { contains: 'Post' } },
            _count: { title: true },
            having: { title: { _count: { gte: 2 } } },
        });
        expect(filteredGroupBy).toHaveLength(2);
        expect(filteredGroupBy).toEqual(
            expect.arrayContaining([
                { authorId: 1, _count: { title: 3 } },
                { authorId: 2, _count: { title: 2 } },
            ]),
        );

        // Test Kysely groupBy operations
        const kyselyUserGroupBy = await db.$qb
            .selectFrom('User')
            .select(['email', (eb) => eb.fn.count('email').as('count')])
            .groupBy('email')
            .having((eb) => eb.fn.count('email'), '>=', 1)
            .execute();
        expect(kyselyUserGroupBy).toHaveLength(3);
    });
});
