import { createPolicyTestClient } from '@zenstackhq/testtools';
import { describe, expect, it } from 'vitest';

describe('field-level policy tests', () => {
    describe('read tests', () => {
        it('works with read rules', async () => {
            const db = await createPolicyTestClient(
                `
        model User {
            id Int @id @default(autoincrement())
            admin Boolean @default(false)
            models Model[]

            @@allow('all', true)
        }

        model Model {
            id Int @id @default(autoincrement())
            x Int
            y Int @allow('read', x > 0)
            z Int @deny('read', x <= 0)
            owner User @relation(fields: [ownerId], references: [id])
            ownerId Int

            @@allow('all', true)
        }
        `,
            );

            await db.user.create({ data: { id: 1, admin: true } });

            let r;

            // y and z are unreadable

            // create read-back
            r = await db.model.create({
                data: { id: 1, x: 0, y: 0, z: 0, ownerId: 1 },
            });
            expect(r.x).toEqual(0);
            expect(r.y).toBeNull();
            expect(r.z).toBeNull();

            // update read-back
            r = await db.model.update({ where: { id: 1 }, data: { x: -1 } });
            expect(r).toMatchObject({ x: -1, y: null, z: null });

            // delete read-back
            r = await db.model.delete({ where: { id: 1 } });
            expect(r).toMatchObject({ x: -1, y: null, z: null });

            // recreate for further tests
            await db.model.create({
                data: { id: 1, x: 0, y: 0, z: 0, ownerId: 1 },
            });

            r = await db.model.findUnique({ where: { id: 1 } });
            expect(r.y).toBeNull();
            expect(r.z).toBeNull();
            r = await db.user.findUnique({ where: { id: 1 }, select: { models: true } });
            expect(r.models[0].y).toBeNull();
            expect(r.models[0].z).toBeNull();

            r = await db.user.findUnique({ where: { id: 1 }, select: { models: { select: { y: true } } } });
            expect(r.models[0].y).toBeNull();
            expect(r.models[0].z).toBeUndefined();

            r = await db.user.findUnique({ where: { id: 1 }, include: { models: true } });
            expect(r.models[0].y).toBeNull();
            expect(r.models[0].z).toBeNull();

            r = await db.user.findUnique({ where: { id: 1 }, select: { models: { select: { y: true } } } });
            expect(r.models[0].y).toBeNull();
            expect(r.models[0].z).toBeUndefined();

            r = await db.model.findUnique({ select: { x: true }, where: { id: 1 } });
            expect(r.x).toEqual(0);
            expect(r.y).toBeUndefined();
            expect(r.z).toBeUndefined();

            r = await db.model.findUnique({ select: { y: true }, where: { id: 1 } });
            expect(r.x).toBeUndefined();
            expect(r.y).toBeNull();
            expect(r.z).toBeUndefined();

            r = await db.model.findUnique({ select: { x: false, y: true }, where: { id: 1 } });
            expect(r.x).toBeUndefined();
            expect(r.y).toBeNull();
            expect(r.z).toBeUndefined();

            r = await db.model.findUnique({ select: { x: true, y: true }, where: { id: 1 } });
            expect(r.x).toEqual(0);
            expect(r.y).toBeNull();
            expect(r.z).toBeUndefined();

            r = await db.model.findUnique({ include: { owner: true }, where: { id: 1 } });
            expect(r.x).toEqual(0);
            expect(r.owner).toBeTruthy();
            expect(r.y).toBeNull();
            expect(r.z).toBeNull();

            // y is readable

            r = await db.model.create({
                data: { id: 2, x: 1, y: 2, z: 2, ownerId: 1 },
            });
            expect(r).toEqual(expect.objectContaining({ x: 1, y: 2, z: 2 }));

            r = await db.model.findUnique({ where: { id: 2 } });
            expect(r).toEqual(expect.objectContaining({ x: 1, y: 2, z: 2 }));

            r = await db.user.findUnique({ where: { id: 1 }, select: { models: { where: { id: 2 } } } });
            expect(r.models[0]).toEqual(expect.objectContaining({ x: 1, y: 2, z: 2 }));

            r = await db.user.findUnique({
                where: { id: 1 },
                select: { models: { where: { id: 2 }, select: { y: true, z: true } } },
            });
            expect(r.models[0]).toEqual(expect.objectContaining({ y: 2, z: 2 }));

            r = await db.user.findUnique({ where: { id: 1 }, select: { models: { where: { id: 2 } } } });
            expect(r.models[0]).toEqual(expect.objectContaining({ x: 1, y: 2, z: 2 }));

            r = await db.user.findUnique({
                where: { id: 1 },
                select: { models: { where: { id: 2 }, select: { y: true } } },
            });
            expect(r.models[0]).toEqual(expect.objectContaining({ y: 2 }));
            r = await db.model.findUnique({ select: { x: true }, where: { id: 2 } });
            expect(r.x).toEqual(1);
            expect(r.y).toBeUndefined();
            expect(r.z).toBeUndefined();
            r = await db.model.findUnique({ select: { y: true }, where: { id: 2 } });
            expect(r.x).toBeUndefined();
            expect(r.y).toEqual(2);
            expect(r.z).toBeUndefined();

            r = await db.model.findUnique({ select: { x: false, y: true, z: true }, where: { id: 2 } });
            expect(r.x).toBeUndefined();
            expect(r.y).toEqual(2);
            expect(r.z).toEqual(2);

            r = await db.model.findUnique({ select: { x: true, y: true, z: true }, where: { id: 2 } });
            expect(r).toEqual(expect.objectContaining({ x: 1, y: 2, z: 2 }));

            r = await db.model.findUnique({ include: { owner: true }, where: { id: 2 } });
            expect(r).toEqual(expect.objectContaining({ x: 1, y: 2, z: 2 }));
            expect(r.owner).toBeTruthy();

            // count
            await expect(db.model.count({ select: { x: true, y: true, z: true } })).resolves.toMatchObject({
                x: 2,
                y: 1,
                z: 1,
            });

            // aggregate
            await expect(db.model.aggregate({ _min: { y: true, z: true } })).resolves.toMatchObject({
                _min: { y: 2, z: 2 },
            });
        });

        it('works with model-level and field-level read rules', async () => {
            const db = await createPolicyTestClient(
                `
        model Model {
            id Int @id @default(autoincrement())
            x Int @allow('read', x > 1)
            @@allow('create', true)
            @@allow('read', x > 0)
        }
        `,
            );

            await db.$unuseAll().model.create({ data: { id: 1, x: 0 } });
            await expect(db.model.count()).resolves.toEqual(0);

            await db.$unuseAll().model.create({ data: { id: 2, x: 1 } });
            const r = await db.model.findFirst();
            expect(r).toBeTruthy();
            expect(r.x).toBeNull();
        });

        // TODO: field-level policy override
        it.skip('works with read override', async () => {
            const db = await createPolicyTestClient(
                `
        model User {
            id Int @id @default(autoincrement())
            admin Boolean @default(false)
            models Model[]

            @@allow('all', true)
        }

        model Model {
            id Int @id @default(autoincrement())
            x Int
            y Int @allow('read', x > 0, true)
            owner User @relation(fields: [ownerId], references: [id]) @allow('read', x > 1, true)
            ownerId Int

            @@allow('create', true)
            @@allow('read', x > 1)
        }
        `,
            );

            await db.user.create({ data: { id: 1, admin: true } });

            // created but can't read back
            await expect(
                db.model.create({
                    data: { id: 1, x: 0, y: 0, ownerId: 1 },
                }),
            ).toBeRejectedByPolicy();

            // y is readable through override
            // created but can't read back
            await expect(
                db.model.create({
                    data: { id: 2, x: 1, y: 0, ownerId: 1 },
                }),
            ).toBeRejectedByPolicy();

            // y can be read back
            await expect(
                db.model.create({
                    data: { id: 3, x: 1, y: 0, ownerId: 1 },
                    select: { y: true },
                }),
            ).resolves.toEqual({ y: 0 });

            await expect(db.model.findUnique({ where: { id: 3 } })).resolves.toBeNull();
            await expect(db.model.findUnique({ where: { id: 3 }, select: { y: true } })).resolves.toEqual({ y: 0 });
            await expect(db.model.findUnique({ where: { id: 3 }, select: { x: true, y: true } })).resolves.toBeNull();
            await expect(
                db.model.findUnique({ where: { id: 3 }, select: { owner: true, y: true } }),
            ).resolves.toBeNull();
            await expect(db.model.findUnique({ where: { id: 3 }, include: { owner: true } })).resolves.toBeNull();

            // y and owner are readable through override
            await expect(
                db.model.create({
                    data: { id: 4, x: 2, y: 0, ownerId: 1 },
                    select: { y: true },
                }),
            ).resolves.toEqual({ y: 0 });
            await expect(
                db.model.findUnique({ where: { id: 4 }, select: { owner: true, y: true } }),
            ).resolves.toMatchObject({
                owner: expect.objectContaining({ admin: true }),
                y: 0,
            });
            await expect(db.model.findUnique({ where: { id: 4 }, include: { owner: true } })).resolves.toMatchObject({
                owner: expect.objectContaining({ admin: true }),
                y: 0,
            });
        });

        it('works with read filter with auth', async () => {
            const _db = await createPolicyTestClient(
                `
        model User {
            id Int @id @default(autoincrement())
            admin Boolean @default(false)
            models Model[]

            @@allow('all', true)
        }

        model Model {
            id Int @id @default(autoincrement())
            x Int
            y Int @allow('read', auth().admin)
            owner User @relation(fields: [ownerId], references: [id])
            ownerId Int

            @@allow('all', true)
        }
        `,
            );

            await _db.user.create({ data: { id: 1, admin: true } });

            let db = _db.$setAuth({ id: 1, admin: false });
            let r;

            // y is unreadable

            r = await db.model.create({
                data: {
                    id: 1,
                    x: 0,
                    y: 0,
                    ownerId: 1,
                },
            });
            expect(r.x).toEqual(0);
            expect(r.y).toBeNull();

            r = await db.model.findUnique({ where: { id: 1 } });
            expect(r.y).toBeNull();

            r = await db.model.findUnique({ select: { x: true }, where: { id: 1 } });
            expect(r.x).toEqual(0);
            expect(r.y).toBeUndefined();

            r = await db.model.findUnique({ select: { y: true }, where: { id: 1 } });
            expect(r.x).toBeUndefined();
            expect(r.y).toBeNull();

            r = await db.model.findUnique({ select: { x: false, y: true }, where: { id: 1 } });
            expect(r.x).toBeUndefined();
            expect(r.y).toBeNull();

            r = await db.model.findUnique({ select: { x: true, y: true }, where: { id: 1 } });
            expect(r.x).toEqual(0);
            expect(r.y).toBeNull();

            r = await db.model.findUnique({ include: { owner: true }, where: { id: 1 } });
            expect(r.x).toEqual(0);
            expect(r.owner).toBeTruthy();
            expect(r.y).toBeNull();

            // y is readable
            db = _db.$setAuth({ id: 1, admin: true });
            r = await db.model.create({
                data: {
                    id: 2,
                    x: 1,
                    y: 0,
                    ownerId: 1,
                },
            });
            expect(r).toEqual(expect.objectContaining({ x: 1, y: 0 }));

            r = await db.model.findUnique({ where: { id: 2 } });
            expect(r).toEqual(expect.objectContaining({ x: 1, y: 0 }));

            r = await db.model.findUnique({ select: { x: true }, where: { id: 2 } });
            expect(r.x).toEqual(1);
            expect(r.y).toBeUndefined();

            r = await db.model.findUnique({ select: { y: true }, where: { id: 2 } });
            expect(r.x).toBeUndefined();
            expect(r.y).toEqual(0);

            r = await db.model.findUnique({ select: { x: false, y: true }, where: { id: 2 } });
            expect(r.x).toBeUndefined();
            expect(r.y).toEqual(0);

            r = await db.model.findUnique({ select: { x: true, y: true }, where: { id: 2 } });
            expect(r).toEqual(expect.objectContaining({ x: 1, y: 0 }));

            r = await db.model.findUnique({ include: { owner: true }, where: { id: 2 } });
            expect(r).toEqual(expect.objectContaining({ x: 1, y: 0 }));
            expect(r.owner).toBeTruthy();
        });

        it('works with read filter with relation', async () => {
            const db = await createPolicyTestClient(
                `
        model User {
            id Int @id @default(autoincrement())
            admin Boolean @default(false)
            models Model[]

            @@allow('all', true)
        }

        model Model {
            id Int @id @default(autoincrement())
            x Int
            y Int @allow('read', owner.admin)
            owner User @relation(fields: [ownerId], references: [id])
            ownerId Int

            @@allow('all', true)
        }
        `,
            );

            await db.user.create({ data: { id: 1, admin: false } });
            await db.user.create({ data: { id: 2, admin: true } });

            let r;

            // y is unreadable

            r = await db.model.create({
                data: {
                    id: 1,
                    x: 0,
                    y: 0,
                    ownerId: 1,
                },
            });
            expect(r.x).toEqual(0);
            expect(r.y).toBeNull();

            r = await db.model.findUnique({ where: { id: 1 } });
            expect(r.y).toBeNull();

            r = await db.model.findUnique({ select: { x: true }, where: { id: 1 } });
            expect(r.x).toEqual(0);
            expect(r.y).toBeUndefined();

            r = await db.model.findUnique({ select: { y: true }, where: { id: 1 } });
            expect(r.x).toBeUndefined();
            expect(r.y).toBeNull();

            r = await db.model.findUnique({ select: { x: false, y: true }, where: { id: 1 } });
            expect(r.x).toBeUndefined();
            expect(r.y).toBeNull();

            r = await db.model.findUnique({ select: { x: true, y: true }, where: { id: 1 } });
            expect(r.x).toEqual(0);
            expect(r.y).toBeNull();

            r = await db.model.findUnique({ include: { owner: true }, where: { id: 1 } });
            expect(r.x).toEqual(0);
            expect(r.owner).toBeTruthy();
            expect(r.y).toBeNull();

            // y is readable
            r = await db.model.create({
                data: {
                    id: 2,
                    x: 1,
                    y: 0,
                    ownerId: 2,
                },
            });
            expect(r).toEqual(expect.objectContaining({ x: 1, y: 0 }));

            r = await db.model.findUnique({ where: { id: 2 } });
            expect(r).toEqual(expect.objectContaining({ x: 1, y: 0 }));

            r = await db.model.findUnique({ select: { x: true }, where: { id: 2 } });
            expect(r.x).toEqual(1);
            expect(r.y).toBeUndefined();

            r = await db.model.findUnique({ select: { y: true }, where: { id: 2 } });
            expect(r.x).toBeUndefined();
            expect(r.y).toEqual(0);

            r = await db.model.findUnique({ select: { x: false, y: true }, where: { id: 2 } });
            expect(r.x).toBeUndefined();
            expect(r.y).toEqual(0);

            r = await db.model.findUnique({ select: { x: true, y: true }, where: { id: 2 } });
            expect(r).toEqual(expect.objectContaining({ x: 1, y: 0 }));

            r = await db.model.findUnique({ include: { owner: true }, where: { id: 2 } });
            expect(r).toEqual(expect.objectContaining({ x: 1, y: 0 }));
            expect(r.owner).toBeTruthy();
        });

        it('works with all ORM find APIs', async () => {
            const db = await createPolicyTestClient(
                `
        model Model {
            id Int @id @default(autoincrement())
            x Int
            y Int @allow('read', x > 0)

            @@allow('all', true)
        }
        `,
            );
            let r;

            // y is unreadable
            await db.model.create({
                data: {
                    id: 1,
                    x: 0,
                    y: 0,
                },
            });

            r = await db.model.findUnique({ where: { id: 1 } });
            expect(r.y).toBeNull();

            r = await db.model.findUniqueOrThrow({ where: { id: 1 } });
            expect(r.y).toBeNull();

            r = await db.model.findFirst({ where: { id: 1 } });
            expect(r.y).toBeNull();

            r = await db.model.findFirstOrThrow({ where: { id: 1 } });
            expect(r.y).toBeNull();

            await db.model.create({
                data: {
                    id: 2,
                    x: 1,
                    y: 0,
                },
            });
            r = await db.model.findMany({ where: { x: { gte: 0 } } });
            expect(r[0].y).toBeNull();
            expect(r[1].y).toEqual(0);
        });

        it('works with query builder', async () => {
            const db = await createPolicyTestClient(
                `
        model User {
            id Int @id @default(autoincrement())
            admin Boolean @default(false)
            models Model[]

            @@allow('all', true)
        }

        model Model {
            id Int @id @default(autoincrement())
            x Int
            y Int @allow('read', owner.admin)
            owner User @relation(fields: [ownerId], references: [id])
            ownerId Int

            @@allow('all', true)
        }
        `,
            );

            await db.user.create({ data: { id: 1, admin: false } });
            await db.user.create({ data: { id: 2, admin: true } });

            await db.$unuseAll().model.create({
                data: { id: 1, x: 1, y: 1, ownerId: 1 },
            });

            await db.$unuseAll().model.create({
                data: { id: 2, x: 2, y: 2, ownerId: 2 },
            });

            await expect(
                db.$qb.selectFrom('Model').selectAll().where('id', '=', 1).executeTakeFirst(),
            ).resolves.toMatchObject({ x: 1, y: null });
            await expect(
                db.$qb.selectFrom('Model').selectAll().where('id', '=', 2).executeTakeFirst(),
            ).resolves.toMatchObject({ x: 2, y: 2 });

            await expect(
                db.$qb
                    .selectFrom('User')
                    .leftJoin('Model as m', 'm.ownerId', 'User.id')
                    .select(['User.id', 'm.x', 'm.y'])
                    .where('User.id', '=', 1)
                    .executeTakeFirst(),
            ).resolves.toEqual({ id: 1, x: 1, y: null });

            await expect(
                db.$qb
                    .selectFrom('User')
                    .leftJoin('Model as m', 'm.ownerId', 'User.id')
                    .select(['User.id', 'm.x', 'm.y'])
                    .where('User.id', '=', 2)
                    .executeTakeFirst(),
            ).resolves.toEqual({ id: 2, x: 2, y: 2 });
        });

        it('rejects field-level policies on relation fields', async () => {
            await expect(
                createPolicyTestClient(
                    `
        model User {
            id Int @id @default(autoincrement())
            admin Boolean @default(false)
            posts Post[] @allow('read', admin)

            @@allow('all', true)
        }

        model Post {
            id Int @id @default(autoincrement())
            author User? @relation(fields: [authorId], references: [id]) @allow('read', author.admin)
            authorId Int @allow('read', author.admin)

            @@allow('all', true)
        }
        `,
                ),
            ).rejects.toThrow(/Field-level policies are not allowed for relation fields/);
        });
    });

    describe('update tests', () => {
        it('works with simple updates', async () => {
            const db = await createPolicyTestClient(
                `
        model User {
            id Int @id @default(autoincrement())
            models Model[]

            @@allow('all', true)
        }

        model Model {
            id Int @id @default(autoincrement())
            x Int
            y Int @allow('update', x > 0)
            owner User @relation(fields: [ownerId], references: [id])
            ownerId Int

            @@allow('create,read', true)
            @@allow('update', y > 0)
        }
        `,
            );

            await db.user.create({
                data: { id: 1 },
            });

            await db.model.create({
                data: { id: 1, x: 0, y: 0, ownerId: 1 },
            });

            // denied by both model-level and field-level policies
            await expect(
                db.model.update({
                    where: { id: 1 },
                    data: { y: 2 },
                }),
            ).toBeRejectedNotFound();

            await db.model.create({
                data: { id: 2, x: 0, y: 1, ownerId: 1 },
            });

            // denied by field-level policy
            await expect(
                db.model.update({
                    where: { id: 2 },
                    data: { y: 2 },
                }),
            ).toBeRejectedByPolicy();

            // allowed when not updating y
            await expect(
                db.model.update({
                    where: { id: 2 },
                    data: { x: 2 },
                }),
            ).toResolveTruthy();

            await db.model.create({
                data: { id: 3, x: 1, y: 1, ownerId: 1 },
            });

            // allowed when updating y
            await expect(
                db.model.update({
                    where: { id: 3 },
                    data: { y: 2 },
                }),
            ).toResolveTruthy();
        });

        // TODO: field-level policy override
        it.skip('update with override', async () => {
            const db = await createPolicyTestClient(
                `
        model Model {
            id Int @id @default(autoincrement())
            x Int
            y Int @allow('update', x > 0, true) @deny('update', x == 100)
            z Int @allow('update', x > 1, true)

            @@allow('create,read', true)
            @@allow('update', y > 0)
        }
        `,
            );

            await db.model.create({
                data: { id: 1, x: 0, y: 0, z: 0 },
            });

            await expect(
                db.model.update({
                    where: { id: 1 },
                    data: { y: 2 },
                }),
            ).toBeRejectedByPolicy();
            await expect(
                db.model.update({
                    where: { id: 1 },
                    data: { x: 2 },
                }),
            ).toBeRejectedByPolicy();

            await db.model.create({
                data: { id: 2, x: 1, y: 0, z: 0 },
            });
            await expect(
                db.model.update({
                    where: { id: 2 },
                    data: { x: 2, y: 1 },
                }),
            ).toBeRejectedByPolicy(); // denied because field `x` doesn't have override
            await expect(
                db.model.update({
                    where: { id: 2 },
                    data: { y: 1, z: 1 },
                }),
            ).toBeRejectedByPolicy(); // denied because field `z` override not satisfied
            await expect(
                db.model.update({
                    where: { id: 2 },
                    data: { y: 1 },
                }),
            ).toResolveTruthy(); // allowed by override
            await expect(db.model.findUnique({ where: { id: 2 } })).resolves.toMatchObject({ y: 1 });

            await db.model.create({
                data: { id: 3, x: 2, y: 0, z: 0 },
            });
            await expect(
                db.model.update({
                    where: { id: 3 },
                    data: { y: 1, z: 1 },
                }),
            ).toResolveTruthy(); // allowed by override
            await expect(db.model.findUnique({ where: { id: 3 } })).resolves.toMatchObject({ y: 1, z: 1 });

            await db.model.create({
                data: { id: 4, x: 100, y: 0, z: 0 },
            });
            await expect(
                db.model.update({
                    where: { id: 4 },
                    data: { y: 1 },
                }),
            ).toBeRejectedByPolicy(); // can't be allowed by override due to field-level deny
        });

        it('update filter with relation', async () => {
            const db = await createPolicyTestClient(
                `
        model User {
            id Int @id @default(autoincrement())
            models Model[]
            admin Boolean @default(false)

            @@allow('all', true)
        }

        model Model {
            id Int @id @default(autoincrement())
            x Int
            y Int @allow('update', owner.admin)
            owner User @relation(fields: [ownerId], references: [id])
            ownerId Int

            @@allow('all', true)
        }
        `,
            );

            await db.user.create({
                data: { id: 1, admin: false },
            });
            await db.user.create({
                data: { id: 2, admin: true },
            });

            await db.model.create({
                data: { id: 1, x: 0, y: 0, ownerId: 1 },
            });

            // rejected by y field-level policy
            await expect(
                db.model.update({
                    where: { id: 1 },
                    data: { y: 2 },
                }),
            ).toBeRejectedByPolicy();

            // allowed since not updating y
            await expect(
                db.model.update({
                    where: { id: 1 },
                    data: { x: 2 },
                }),
            ).toResolveTruthy();

            await db.model.create({
                data: { id: 2, x: 0, y: 0, ownerId: 2 },
            });
            await expect(
                db.model.update({
                    where: { id: 2 },
                    data: { y: 2 },
                }),
            ).toResolveTruthy();
        });

        it('update with nested to-many relation', async () => {
            const db = await createPolicyTestClient(
                `
        model User {
            id Int @id @default(autoincrement())
            models Model[]
            admin Boolean @default(false)

            @@allow('all', true)
        }

        model Model {
            id Int @id @default(autoincrement())
            x Int
            y Int @allow('update', owner.admin)
            owner User @relation(fields: [ownerId], references: [id])
            ownerId Int

            @@allow('all', true)
        }
        `,
            );

            await db.user.create({
                data: { id: 1, admin: false, models: { create: { id: 1, x: 0, y: 0 } } },
            });
            await db.user.create({
                data: { id: 2, admin: true, models: { create: { id: 2, x: 0, y: 0 } } },
            });

            await expect(
                db.user.update({
                    where: { id: 1 },
                    data: { models: { update: { where: { id: 1 }, data: { y: 2 } } } },
                }),
            ).toBeRejectedByPolicy();
            await expect(
                db.user.update({
                    where: { id: 1 },
                    data: { models: { update: { where: { id: 1 }, data: { x: 2 } } } },
                }),
            ).toResolveTruthy();

            await expect(
                db.user.update({
                    where: { id: 2 },
                    data: { models: { update: { where: { id: 2 }, data: { y: 2 } } } },
                }),
            ).toResolveTruthy();
        });

        it('update with nested to-one relation', async () => {
            const db = await createPolicyTestClient(
                `
        model User {
            id Int @id @default(autoincrement())
            model Model?
            admin Boolean @default(false)

            @@allow('all', true)
        }

        model Model {
            id Int @id @default(autoincrement())
            x Int
            y Int @allow('update', owner.admin)
            owner User @relation(fields: [ownerId], references: [id])
            ownerId Int @unique

            @@allow('all', true)
        }
        `,
            );

            await db.user.create({
                data: { id: 1, admin: false, model: { create: { id: 1, x: 0, y: 0 } } },
            });
            await db.user.create({
                data: { id: 2, admin: true, model: { create: { id: 2, x: 0, y: 0 } } },
            });

            await expect(
                db.user.update({
                    where: { id: 1 },
                    data: { model: { update: { data: { y: 2 } } } },
                }),
            ).toBeRejectedByPolicy();
            await expect(
                db.user.update({
                    where: { id: 1 },
                    data: { model: { update: { y: 2 } } },
                }),
            ).toBeRejectedByPolicy();
            await expect(
                db.user.update({
                    where: { id: 1 },
                    data: { model: { update: { data: { x: 2 } } } },
                }),
            ).toResolveTruthy();
            await expect(
                db.user.update({
                    where: { id: 1 },
                    data: { model: { update: { x: 2 } } },
                }),
            ).toResolveTruthy();

            await expect(
                db.user.update({
                    where: { id: 2 },
                    data: { model: { update: { data: { y: 2 } } } },
                }),
            ).toResolveTruthy();
            await expect(
                db.user.update({
                    where: { id: 2 },
                    data: { model: { update: { y: 2 } } },
                }),
            ).toResolveTruthy();
        });

        it('update with connect to-many relation', async () => {
            const db = await createPolicyTestClient(
                `
        model User {
            id Int @id @default(autoincrement())
            models Model[]
            admin Boolean @default(false)

            @@allow('all', true)
        }

        model Model {
            id Int @id @default(autoincrement())
            value Int
            owner User? @relation(fields: [ownerId], references: [id])
            ownerId Int? @allow('update', value > 0)

            @@allow('all', true)
        }
        `,
            );

            await db.user.create({ data: { id: 1, admin: false } });
            await db.user.create({ data: { id: 2, admin: true } });
            await db.model.create({ data: { id: 1, value: 0 } });
            await db.model.create({ data: { id: 2, value: 1 } });

            // connect/disconnect from owning side

            await expect(
                db.model.update({
                    where: { id: 1 },
                    data: { owner: { connect: { id: 1 } } },
                }),
            ).toBeRejectedByPolicy();

            // force connect
            await db.$unuseAll().model.update({
                where: { id: 1 },
                data: { owner: { connect: { id: 1 } } },
            });

            // disconnect with filter
            await expect(
                db.model.update({
                    where: { id: 1 },
                    data: { owner: { disconnect: { id: 1 } } },
                }),
            ).toBeRejectedByPolicy();

            // force connect
            await db.$unuseAll().model.update({
                where: { id: 1 },
                data: { owner: { connect: { id: 1 } } },
            });

            // disconnect
            await expect(
                db.model.update({
                    where: { id: 1 },
                    data: { owner: { disconnect: true } },
                }),
            ).toBeRejectedByPolicy();

            await expect(
                db.model.update({
                    where: { id: 2 },
                    data: { owner: { connect: { id: 1 } } },
                }),
            ).toResolveTruthy();
            await expect(
                db.model.update({
                    where: { id: 2 },
                    data: { owner: { disconnect: { id: 1 } } },
                }),
            ).toResolveTruthy();

            // connect/disconnect from non-owning side

            await expect(
                db.user.update({
                    where: { id: 1 },
                    data: { models: { connect: { id: 1 } } },
                }),
            ).toBeRejectedByPolicy();

            // force connect
            await db.$unuseAll().user.update({
                where: { id: 1 },
                data: { models: { connect: { id: 1 } } },
            });
            await expect(
                db.user.update({
                    where: { id: 1 },
                    data: { models: { disconnect: { id: 1 } } },
                }),
            ).toBeRejectedByPolicy();
            await expect(
                db.user.update({
                    where: { id: 1 },
                    data: { models: { set: { id: 1 } } },
                }),
            ).toBeRejectedByPolicy();

            await expect(
                db.user.update({
                    where: { id: 1 },
                    data: { models: { connect: { id: 2 } } },
                }),
            ).toResolveTruthy();
            await expect(
                db.user.update({
                    where: { id: 1 },
                    data: { models: { disconnect: { id: 2 } } },
                }),
            ).toResolveTruthy();

            // model#1 needs to be disconnected but it violates the policy
            await expect(
                db.user.update({
                    where: { id: 1 },
                    data: { models: { set: { id: 2 } } },
                }),
            ).toBeRejectedByPolicy();

            // force model#1 disconnect
            await db.$unuseAll().model.update({
                where: { id: 1 },
                data: { ownerId: null },
            });

            await expect(
                db.user.update({
                    where: { id: 1 },
                    data: { models: { set: { id: 2 } } },
                }),
            ).toResolveTruthy();
        });

        it('update with connect to-one relation', async () => {
            const db = await createPolicyTestClient(
                `
        model User {
            id Int @id @default(autoincrement())
            model Model?
            admin Boolean @default(false)

            @@allow('all', true)
        }

        model Model {
            id Int @id @default(autoincrement())
            value Int
            owner User? @relation(fields: [ownerId], references: [id])
            ownerId Int? @unique @allow('update', value > 0)

            @@allow('all', true)
        }
        `,
            );

            await db.user.create({ data: { id: 1, admin: false } });
            await db.user.create({ data: { id: 2, admin: true } });
            await db.model.create({ data: { id: 1, value: 0 } });
            await db.model.create({ data: { id: 2, value: 1 } });

            await expect(
                db.model.update({
                    where: { id: 1 },
                    data: { owner: { connect: { id: 1 } } },
                }),
            ).toBeRejectedByPolicy();

            // force connect
            await db.$unuseAll().model.update({
                where: { id: 1 },
                data: { owner: { connect: { id: 1 } } },
            });

            await expect(
                db.model.update({
                    where: { id: 1 },
                    data: { owner: { disconnect: { id: 1 } } },
                }),
            ).toBeRejectedByPolicy();

            // force disconnect
            await db.$unuseAll().model.update({
                where: { id: 1 },
                data: { owner: { disconnect: true } },
            });

            await expect(
                db.model.update({
                    where: { id: 2 },
                    data: { owner: { connect: { id: 1 } } },
                }),
            ).toResolveTruthy();
            await expect(
                db.model.update({
                    where: { id: 2 },
                    data: { owner: { disconnect: { id: 1 } } },
                }),
            ).toResolveTruthy();

            await expect(
                db.user.update({
                    where: { id: 1 },
                    data: { model: { connect: { id: 1 } } },
                }),
            ).toBeRejectedByPolicy();
            await db.$unuseAll().user.update({
                where: { id: 1 },
                data: { model: { connect: { id: 1 } } },
            });
            await expect(
                db.user.update({
                    where: { id: 1 },
                    data: { model: { disconnect: { id: 1 } } },
                }),
            ).toBeRejectedByPolicy();

            // connecting model#2 results in disconnecting model#1, which is denied by policy
            await expect(
                db.user.update({
                    where: { id: 1 },
                    data: { model: { connect: { id: 2 } } },
                }),
            ).toBeRejectedByPolicy();

            // force disconnect of model#1
            await db.$unuseAll().model.update({
                where: { id: 1 },
                data: { ownerId: null },
            });

            await expect(
                db.user.update({
                    where: { id: 1 },
                    data: { model: { connect: { id: 2 } } },
                }),
            ).toResolveTruthy();

            await expect(
                db.user.update({
                    where: { id: 1 },
                    data: { model: { disconnect: { id: 2 } } },
                }),
            ).toResolveTruthy();
        });

        it('updateMany simple', async () => {
            const db = await createPolicyTestClient(
                `
        model User {
            id Int @id @default(autoincrement())
            models Model[]

            @@allow('all', true)
        }

        model Model {
            id Int @id @default(autoincrement())
            x Int
            y Int @allow('update', x > 0)
            owner User @relation(fields: [ownerId], references: [id])
            ownerId Int

            @@allow('all', true)
        }
        `,
            );

            await db.user.create({
                data: {
                    id: 1,
                    models: {
                        create: [
                            { id: 1, x: 0, y: 0 },
                            { id: 2, x: 1, y: 0 },
                        ],
                    },
                },
            });

            await expect(db.model.updateMany({ data: { y: 2 } })).toBeRejectedByPolicy();
            await expect(db.model.findUnique({ where: { id: 1 } })).resolves.toEqual(
                expect.objectContaining({ x: 0, y: 0 }),
            );
            await expect(db.model.findUnique({ where: { id: 2 } })).resolves.toEqual(
                expect.objectContaining({ x: 1, y: 0 }),
            );

            await expect(db.model.updateMany({ where: { x: 1 }, data: { y: 2 } })).resolves.toEqual({ count: 1 });
            await expect(db.model.findUnique({ where: { id: 1 } })).resolves.toEqual(
                expect.objectContaining({ x: 0, y: 0 }),
            );
            await expect(db.model.findUnique({ where: { id: 2 } })).resolves.toEqual(
                expect.objectContaining({ x: 1, y: 2 }),
            );
        });

        // TODO: field-level policy override
        it.skip('updateMany override', async () => {
            const db = await createPolicyTestClient(
                `
        model Model {
            id Int @id @default(autoincrement())
            x Int
            y Int @allow('update', x > 0, override: true)

            @@allow('create,read', true)
            @@allow('update', x > 1)
        }
        `,
            );

            await db.model.create({ data: { id: 1, x: 0, y: 0 } });
            await db.model.create({ data: { id: 2, x: 1, y: 0 } });

            await expect(db.model.updateMany({ data: { y: 2 } })).resolves.toEqual({ count: 1 });
            await expect(db.model.findUnique({ where: { id: 1 } })).resolves.toEqual(
                expect.objectContaining({ x: 0, y: 0 }),
            );
            await expect(db.model.findUnique({ where: { id: 2 } })).resolves.toEqual(
                expect.objectContaining({ x: 1, y: 2 }),
            );

            await expect(db.model.updateMany({ data: { x: 2, y: 3 } })).resolves.toEqual({ count: 0 });
        });

        it('updateMany nested', async () => {
            const db = await createPolicyTestClient(
                `
        model User {
            id Int @id @default(autoincrement())
            models Model[]

            @@allow('all', true)
        }

        model Model {
            id Int @id @default(autoincrement())
            x Int
            y Int @allow('update', x > 0)
            owner User @relation(fields: [ownerId], references: [id])
            ownerId Int

            @@allow('all', true)
        }
        `,
            );

            await db.user.create({
                data: {
                    id: 1,
                    models: {
                        create: [
                            { id: 1, x: 0, y: 0 },
                            { id: 2, x: 1, y: 0 },
                        ],
                    },
                },
            });

            await expect(
                db.user.update({ where: { id: 1 }, data: { models: { updateMany: { where: {}, data: { y: 2 } } } } }),
            ).toBeRejectedByPolicy();
            await expect(db.model.findUnique({ where: { id: 1 } })).resolves.toEqual(
                expect.objectContaining({ x: 0, y: 0 }),
            );
            await expect(db.model.findUnique({ where: { id: 2 } })).resolves.toEqual(
                expect.objectContaining({ x: 1, y: 0 }),
            );

            await expect(
                db.user.update({
                    where: { id: 1 },
                    data: { models: { updateMany: { where: { id: 1 }, data: { y: 2 } } } },
                }),
            ).toBeRejectedByPolicy();
            await expect(db.model.findUnique({ where: { id: 1 } })).resolves.toEqual(
                expect.objectContaining({ x: 0, y: 0 }),
            );

            await expect(
                db.user.update({
                    where: { id: 1 },
                    data: { models: { updateMany: { where: { id: 2 }, data: { y: 2 } } } },
                }),
            ).toResolveTruthy();
            await expect(db.model.findUnique({ where: { id: 2 } })).resolves.toEqual(
                expect.objectContaining({ x: 1, y: 2 }),
            );
        });
    });

    describe('misc tests', () => {
        it('this expression', async () => {
            const _db = await createPolicyTestClient(
                `
            model User {
                id Int @id
                username String @allow("all", auth() == this)
                @@allow('all', true)
              }
            `,
            );

            await _db.user.create({ data: { id: 1, username: 'test' } });

            // admin
            let r = await _db.$setAuth({ id: 1, admin: true }).user.findFirst();
            expect(r.username).toEqual('test');

            // owner
            r = await _db.$setAuth({ id: 1 }).user.findFirst();
            expect(r.username).toEqual('test');

            // anonymous
            r = await _db.user.findFirst();
            expect(r.username).toBeNull();

            // non-owner
            r = await _db.$setAuth({ id: 2 }).user.findFirst();
            expect(r.username).toBeNull();
        });

        it('collection predicate', async () => {
            const db = await createPolicyTestClient(
                `
        model User {
            id Int @id @default(autoincrement())
            foos Foo[]
            a Int @allow('read', foos?[x > 0 && bars![y > 0]])
            b Int @allow('read', foos^[x == 1])

            @@allow('all', true)
        }

        model Foo {
            id Int @id @default(autoincrement())
            x Int
            owner User @relation(fields: [ownerId], references: [id])
            ownerId Int
            bars Bar[]

            @@allow('all', true)
        }

        model Bar {
            id Int @id @default(autoincrement())
            y Int
            foo Foo @relation(fields: [fooId], references: [id])
            fooId Int

            @@allow('all', true)
        }
        `,
            );

            await db.user.create({
                data: {
                    id: 1,
                    a: 1,
                    b: 2,
                    foos: {
                        create: [
                            { x: 0, bars: { create: [{ y: 1 }] } },
                            { x: 1, bars: { create: [{ y: 0 }, { y: 1 }] } },
                        ],
                    },
                },
            });

            let r = await db.user.findUnique({ where: { id: 1 } });
            expect(r.a).toBeNull();
            expect(r.b).toBeNull();

            await db.user.create({
                data: {
                    id: 2,
                    a: 1,
                    b: 2,
                    foos: {
                        create: [{ x: 2, bars: { create: [{ y: 0 }, { y: 1 }] } }],
                    },
                },
            });
            r = await db.user.findUnique({ where: { id: 2 } });
            expect(r.a).toBeNull();
            expect(r.b).toBe(2);

            await db.user.create({
                data: {
                    id: 3,
                    a: 1,
                    b: 2,
                    foos: {
                        create: [{ x: 2 }],
                    },
                },
            });
            r = await db.user.findUnique({ where: { id: 3 } });
            expect(r.a).toBe(1);

            await db.user.create({
                data: {
                    id: 4,
                    a: 1,
                    b: 2,
                    foos: {
                        create: [{ x: 2, bars: { create: [{ y: 1 }, { y: 2 }] } }],
                    },
                },
            });
            r = await db.user.findUnique({ where: { id: 4 } });
            expect(r.a).toBe(1);
            expect(r.b).toBe(2);
        });

        it('deny only without field access', async () => {
            const db = await createPolicyTestClient(
                `
        model User {
            id Int @id @default(autoincrement())
            role String @deny('update', auth().role != 'ADMIN')

            @@allow('all', true)
        }
        `,
            );

            const user = await db.user.create({
                data: { role: 'USER' },
            });

            await expect(
                db.$setAuth({ id: 1, role: 'ADMIN' }).user.update({
                    where: { id: user.id },
                    data: { role: 'ADMIN' },
                }),
            ).toResolveTruthy();

            await expect(
                db.$setAuth({ id: 1, role: 'USER' }).user.update({
                    where: { id: user.id },
                    data: { role: 'ADMIN' },
                }),
            ).toBeRejectedByPolicy();
        });

        it('deny only with field access', async () => {
            const db = await createPolicyTestClient(
                `
        model User {
            id Int @id @default(autoincrement())
            locked Boolean @default(false)
            role String @deny('update', auth().role != 'ADMIN' || locked)

            @@allow('all', true)
        }
        `,
            );

            const user1 = await db.user.create({
                data: { role: 'USER' },
            });

            await expect(
                db.$setAuth({ id: 1, role: 'ADMIN' }).user.update({
                    where: { id: user1.id },
                    data: { role: 'ADMIN' },
                }),
            ).toResolveTruthy();

            await expect(
                db.$setAuth({ id: 1, role: 'USER' }).user.update({
                    where: { id: user1.id },
                    data: { role: 'ADMIN' },
                }),
            ).toBeRejectedByPolicy();

            const user2 = await db.user.create({
                data: { role: 'USER', locked: true },
            });

            await expect(
                db.$setAuth({ id: 1, role: 'ADMIN' }).user.update({
                    where: { id: user2.id },
                    data: { role: 'ADMIN' },
                }),
            ).toBeRejectedByPolicy();
        });
    });
});
