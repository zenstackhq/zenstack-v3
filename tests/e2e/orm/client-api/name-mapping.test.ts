import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ClientContract } from '@zenstackhq/orm';
import { schema, type SchemaType } from '../schemas/name-mapping/schema';
import { createTestClient } from '@zenstackhq/testtools';

describe('Name mapping tests', () => {
    let db: ClientContract<SchemaType>;

    beforeEach(async () => {
        db = await createTestClient(
            schema,
            { usePrismaPush: true },
            path.join(__dirname, '../schemas/name-mapping/schema.zmodel'),
        );
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
        });

        await expect(
            db.$qb
                .insertInto('User')
                .values({
                    email: 'u2@test.com',
                })
                .returning(['id', 'email'])
                .executeTakeFirst(),
        ).resolves.toMatchObject({
            id: expect.any(Number),
            email: 'u2@test.com',
        });

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
        });
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
                    posts: { where: { title: { contains: 'Post1' } }, select: { title: true } },
                },
            }),
        ).resolves.toMatchObject({
            id: expect.any(Number),
            email: 'u1@test.com',
            posts: [{ title: 'Post1' }],
        });

        await expect(
            db.$qb.selectFrom('User').selectAll().where('email', '=', 'u1@test.com').executeTakeFirst(),
        ).resolves.toMatchObject({
            id: expect.any(Number),
            email: 'u1@test.com',
        });

        await expect(
            db.$qb.selectFrom('User').select(['User.email']).where('email', '=', 'u1@test.com').executeTakeFirst(),
        ).resolves.toMatchObject({
            email: 'u1@test.com',
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
            posts: [expect.objectContaining({ title: 'Post2' })],
        });

        await expect(
            db.$qb
                .updateTable('User')
                .set({ email: (eb) => eb.fn('upper', [eb.ref('email')]) })
                .where('email', '=', 'u2@test.com')
                .returning(['email'])
                .executeTakeFirst(),
        ).resolves.toMatchObject({ email: 'U2@TEST.COM' });

        await expect(
            db.$qb.updateTable('User as u').set({ email: 'u3@test.com' }).returningAll().executeTakeFirst(),
        ).resolves.toMatchObject({ id: expect.any(Number), email: 'u3@test.com' });
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

        await expect(
            db.$qb.deleteFrom('Post').where('title', '=', 'Post1').returning(['id', 'title']).executeTakeFirst(),
        ).resolves.toMatchObject({
            id: user.id,
            title: 'Post1',
        });

        await expect(
            db.user.delete({
                where: { email: 'u1@test.com' },
                include: { posts: true },
            }),
        ).resolves.toMatchObject({
            email: 'u1@test.com',
            posts: [],
        });
    });

    it('works with count', async () => {
        await db.user.create({
            data: {
                email: 'u1@test.com',
                posts: {
                    create: [{ title: 'Post1' }, { title: 'Post2' }],
                },
            },
        });

        await db.user.create({
            data: {
                email: 'u2@test.com',
                posts: {
                    create: [{ title: 'Post3' }],
                },
            },
        });

        // Test ORM count operations
        await expect(db.user.count()).resolves.toBe(2);
        await expect(db.post.count()).resolves.toBe(3);
        await expect(db.user.count({ select: { email: true } })).resolves.toMatchObject({
            email: 2,
        });

        await expect(db.user.count({ where: { email: 'u1@test.com' } })).resolves.toBe(1);
        await expect(db.post.count({ where: { title: { contains: 'Post1' } } })).resolves.toBe(1);

        await expect(db.post.count({ where: { author: { email: 'u1@test.com' } } })).resolves.toBe(2);

        // Test Kysely count operations
        const r = await db.$qb
            .selectFrom('User')
            .select((eb) => eb.fn.count('email').as('count'))
            .executeTakeFirst();
        await expect(Number(r?.count)).toBe(2);
    });

    it('works with aggregate', async () => {
        await db.user.create({
            data: {
                id: 1,
                email: 'u1@test.com',
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
                posts: {
                    create: [{ id: 3, title: 'Post3' }],
                },
            },
        });

        // Test ORM aggregate operations
        await expect(db.user.aggregate({ _count: { id: true, email: true } })).resolves.toMatchObject({
            _count: { id: 2, email: 2 },
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
