import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ClientContract } from '../../src';
import { schema, type SchemaType } from '../schemas/name-mapping/schema';
import { createTestClient } from '../utils';

const TEST_DB = 'client-api-name-mapper-test';

describe.each([{ provider: 'sqlite' as const }, { provider: 'postgresql' as const }])(
    'Name mapping tests',
    ({ provider }) => {
        let db: ClientContract<SchemaType>;

        beforeEach(async () => {
            db = await createTestClient(
                schema,
                { usePrismaPush: true, provider, dbName: TEST_DB },
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
                    .orderBy(['email'])
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
    },
);
