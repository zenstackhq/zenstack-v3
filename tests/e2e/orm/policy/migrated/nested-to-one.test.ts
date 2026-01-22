import { describe, it, expect } from 'vitest';
import { createPolicyTestClient } from '@zenstackhq/testtools';

describe('With Policy:nested to-one', () => {
    it('read filtering for optional relation', async () => {
        const db = await createPolicyTestClient(
            `
        model M1 {
            id String @id @default(uuid())
            m2 M2?
        
            @@allow('all', true)
        }
        
        model M2 {
            id String @id @default(uuid())
            m1 M1 @relation(fields: [m1Id], references:[id])
            m1Id String @unique
            value Int
        
            @@allow('create', true)
            @@allow('read', value > 0)
        }
        `,
        );

        let read = await db.m1.create({
            include: { m2: true },
            data: {
                id: '1',
                m2: {
                    create: { id: '1', value: 0 },
                },
            },
        });
        expect(read.m2).toBeNull();

        await expect(db.m1.findUnique({ where: { id: '1' }, include: { m2: true } })).resolves.toEqual(
            expect.objectContaining({ m2: null }),
        );
        await expect(db.m1.findMany({ include: { m2: true } })).resolves.toEqual(
            expect.arrayContaining([expect.objectContaining({ m2: null })]),
        );

        await db.$unuseAll().m2.update({ where: { id: '1' }, data: { value: 1 } });
        read = await db.m1.findUnique({ where: { id: '1' }, include: { m2: true } });
        expect(read.m2).toEqual(expect.objectContaining({ id: '1', value: 1 }));
    });

    it('read rejection for non-optional relation', async () => {
        const db = await createPolicyTestClient(
            `
        model M1 {
            id String @id @default(uuid())
            m2 M2?
            value Int
        
            @@allow('create', true)
            @@allow('read', value > 0)
        }
        
        model M2 {
            id String @id @default(uuid())
            m1 M1 @relation(fields: [m1Id], references:[id])
            m1Id String @unique
        
            @@allow('all', true)
        }
        `,
        );

        await db.$unuseAll().m1.create({
            data: {
                id: '1',
                value: 0,
                m2: {
                    create: { id: '1' },
                },
            },
        });

        await expect(db.m2.findUnique({ where: { id: '1' }, include: { m1: true } })).resolves.toMatchObject({
            m1: null,
        });

        await db.$unuseAll().m1.update({ where: { id: '1' }, data: { value: 1 } });
        await expect(db.m2.findMany({ include: { m1: true } })).toResolveTruthy();
    });

    // TODO: should we keep v2 semantic?
    it.skip('read condition hoisting', async () => {
        const db = await createPolicyTestClient(
            `
        model M1 {
            id String @id @default(uuid())
            m2 M2 @relation(fields: [m2Id], references:[id])
            m2Id String @unique
        
            @@allow('all', true)
        }
        
        model M2 {
            id String @id @default(uuid())
            value Int

            m1 M1?

            m3 M3 @relation(fields: [m3Id], references:[id])
            m3Id String @unique

            @@allow('create', true)
            @@allow('read', value > 0)
        }

        model M3 {
            id String @id @default(uuid())
            value Int
            m2 M2?
        
            @@allow('create', true)
            @@allow('read', value > 1)
        }
        `,
        );

        await db.m1.create({
            include: { m2: true },
            data: {
                id: '1',
                m2: {
                    create: { id: 'm2-1', value: 1, m3: { create: { value: 1 } } },
                },
            },
        });

        // check m2-m3 filtering
        // including m3 causes m1 to be filtered due to hosting
        await expect(db.m1.findFirst({ include: { m2: { include: { m3: true } } } })).toResolveNull();
        await expect(db.m1.findFirst({ select: { m2: { select: { m3: true } } } })).toResolveNull();
    });

    it('create and update tests', async () => {
        const db = await createPolicyTestClient(
            `
        model M1 {
            id String @id @default(uuid())
            m2 M2?
        
            @@allow('all', true)
        }
        
        model M2 {
            id String @id @default(uuid())
            value Int
            m1 M1 @relation(fields: [m1Id], references:[id])
            m1Id String @unique
        
            @@allow('read', true)
            @@allow('create', value > 0)
            @@allow('update', value > 1)
        }
        `,
        );

        // create denied
        await expect(
            db.m1.create({
                data: {
                    m2: {
                        create: { value: 0 },
                    },
                },
            }),
        ).toBeRejectedByPolicy();

        await expect(
            db.m1.create({
                data: {
                    id: '1',
                    m2: {
                        create: { id: '1', value: 1 },
                    },
                },
            }),
        ).toResolveTruthy();

        // nested update to m2 is filtered
        await expect(
            db.m1.update({
                where: { id: '1' },
                data: {
                    m2: {
                        update: { value: 2 },
                    },
                },
            }),
        ).toBeRejectedNotFound();

        await expect(db.m2.findFirst()).resolves.toMatchObject({ value: 1 });
    });

    it('nested update id tests', async () => {
        const db = await createPolicyTestClient(
            `
        model M1 {
            id String @id @default(uuid())
            m2 M2?
        
            @@allow('all', true)
        }
        
        model M2 {
            id String @id @default(uuid())
            value Int
            m1 M1 @relation(fields: [m1Id], references:[id])
            m1Id String @unique
        
            @@allow('read', true)
            @@allow('create', value > 0)
            @@allow('update', value > 1)
            @@allow('post-update', value > 2)
        }
        `,
        );

        await db.m1.create({
            data: {
                id: '1',
                m2: {
                    create: { id: '1', value: 2 },
                },
            },
        });

        await expect(
            db.m1.update({
                where: { id: '1' },
                data: {
                    m2: {
                        update: { id: '2', value: 1 },
                    },
                },
            }),
        ).toBeRejectedByPolicy();

        if (db.$schema.provider.type !== 'mysql') {
            await expect(
                db.m1.update({
                    where: { id: '1' },
                    data: {
                        m2: {
                            update: { id: '2', value: 3 },
                        },
                    },
                    include: { m2: true },
                }),
            ).resolves.toMatchObject({ m2: expect.objectContaining({ id: '2', value: 3 }) });
        } else {
            // mysql does not support post-update with id updates
            await expect(
                db.m1.update({
                    where: { id: '1' },
                    data: {
                        m2: {
                            update: { id: '2', value: 3 },
                        },
                    },
                    include: { m2: true },
                }),
            ).toBeRejectedByPolicy();
        }
    });

    it('nested create', async () => {
        const db = await createPolicyTestClient(
            `
        model M1 {
            id String @id @default(uuid())
            m2 M2?
        
            @@allow('all', true)
        }
        
        model M2 {
            id String @id @default(uuid())
            value Int
            m1 M1 @relation(fields: [m1Id], references:[id])
            m1Id String @unique
        
            @@allow('read', true)
            @@allow('create', value > 0)
            @@allow('update', value > 1)
        }
        `,
        );

        await db.m1.create({
            data: {
                id: '1',
            },
        });

        // nested create denied
        await expect(
            db.m1.update({
                where: { id: '1' },
                data: {
                    m2: {
                        create: { value: 0 },
                    },
                },
            }),
        ).toBeRejectedByPolicy();

        await expect(
            db.m1.update({
                where: { id: '1' },
                data: {
                    m2: {
                        create: { value: 1 },
                    },
                },
            }),
        ).toResolveTruthy();
    });

    it('nested delete', async () => {
        const db = await createPolicyTestClient(
            `
        model M1 {
            id String @id @default(uuid())
            m2 M2?
        
            @@allow('all', true)
        }
        
        model M2 {
            id String @id @default(uuid())
            value Int
            m1 M1 @relation(fields: [m1Id], references:[id])
            m1Id String @unique
        
            @@allow('read', true)
            @@allow('create', true)
            @@allow('update', true)
            @@allow('delete', value > 1)
        }
        `,
        );

        await db.m1.create({
            data: {
                id: '1',
                m2: {
                    create: { id: '1', value: 1 },
                },
            },
        });

        // nested delete denied
        await expect(
            db.m1.update({
                where: { id: '1' },
                data: {
                    m2: { delete: true },
                },
            }),
        ).toBeRejectedNotFound();
        expect(await db.m2.findUnique({ where: { id: '1' } })).toBeTruthy();

        // update m2 so it can be deleted
        await db.m1.update({
            where: { id: '1' },
            data: {
                m2: { update: { value: 3 } },
            },
        });

        expect(
            await db.m1.update({
                where: { id: '1' },
                data: {
                    m2: { delete: true },
                },
            }),
        ).toBeTruthy();
        // check deleted
        expect(await db.m2.findUnique({ where: { id: '1' } })).toBeNull();
    });

    it('nested relation delete', async () => {
        const db = await createPolicyTestClient(
            `
        model User {
            id String @id @default(uuid())
            m1 M1?

            @@allow('all', true)
        }

        model M1 {
            id String @id @default(uuid())
            value Int
            user User? @relation(fields: [userId], references: [id])
            userId String? @unique
        
            @@allow('read,create,update', true)
            @@allow('delete', auth().id == 'user1' && value > 0)
        }
        `,
        );

        await db.$setAuth({ id: 'user1' }).m1.create({
            data: {
                id: 'm1',
                value: 1,
            },
        });

        await expect(
            db.$setAuth({ id: 'user2' }).user.create({
                data: {
                    id: 'user2',
                    m1: {
                        connect: { id: 'm1' },
                    },
                },
            }),
        ).toResolveTruthy();

        await expect(
            db.$setAuth({ id: 'user2' }).user.update({
                where: { id: 'user2' },
                data: {
                    m1: { delete: true },
                },
            }),
        ).toBeRejectedNotFound();

        await expect(
            db.$setAuth({ id: 'user1' }).user.create({
                data: {
                    id: 'user1',
                    m1: {
                        connect: { id: 'm1' },
                    },
                },
            }),
        ).toResolveTruthy();

        await expect(
            db.$setAuth({ id: 'user1' }).user.update({
                where: { id: 'user1' },
                data: {
                    m1: { delete: true },
                },
            }),
        ).toResolveTruthy();

        expect(await db.$unuseAll().m1.findMany()).toHaveLength(0);
    });
});
