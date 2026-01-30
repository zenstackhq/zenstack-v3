import { createPolicyTestClient } from '@zenstackhq/testtools';
import { describe, expect, it } from 'vitest';

describe('Policy toplevel operations tests', () => {
    it('read tests', async () => {
        const db = await createPolicyTestClient(
            `
        model Model {
            id String @id @default(uuid())
            value Int
        
            @@allow('create', true)
            @@allow('read', value > 1)
        }
        `,
        );

        await expect(
            db.model.create({
                data: {
                    id: '1',
                    value: 1,
                },
            }),
        ).toBeRejectedByPolicy();
        const fromPrisma = await db.$unuseAll().model.findUnique({
            where: { id: '1' },
        });
        expect(fromPrisma).toBeTruthy();

        expect(await db.model.findMany()).toHaveLength(0);
        expect(await db.model.findUnique({ where: { id: '1' } })).toBeNull();
        expect(await db.model.findFirst({ where: { id: '1' } })).toBeNull();
        await expect(db.model.findUniqueOrThrow({ where: { id: '1' } })).toBeRejectedNotFound();
        await expect(db.model.findFirstOrThrow({ where: { id: '1' } })).toBeRejectedNotFound();

        const item2 = {
            id: '2',
            value: 2,
        };
        const r1 = await db.model.create({
            data: item2,
        });
        expect(r1).toBeTruthy();
        expect(await db.model.findMany()).toHaveLength(1);
        expect(await db.model.findUnique({ where: { id: '2' } })).toEqual(expect.objectContaining(item2));
        expect(await db.model.findFirst({ where: { id: '2' } })).toEqual(expect.objectContaining(item2));
        expect(await db.model.findUniqueOrThrow({ where: { id: '2' } })).toEqual(expect.objectContaining(item2));
        expect(await db.model.findFirstOrThrow({ where: { id: '2' } })).toEqual(expect.objectContaining(item2));
    });

    it('write tests', async () => {
        const db = await createPolicyTestClient(
            `
        model Model {
            id String @id @default(uuid())
            value Int
        
            @@allow('read', value > 1)
            @@allow('create', value > 0)
            @@allow('update', value > 1)
        }
        `,
        );

        // create denied
        await expect(
            db.model.create({
                data: {
                    value: 0,
                },
            }),
        ).toBeRejectedByPolicy();

        // can't read back
        await expect(
            db.model.create({
                data: {
                    id: '1',
                    value: 1,
                },
            }),
        ).toBeRejectedByPolicy();

        // success
        expect(
            await db.model.create({
                data: {
                    id: '2',
                    value: 2,
                },
            }),
        ).toBeTruthy();

        // update not found
        await expect(db.model.update({ where: { id: '3' }, data: { value: 5 } })).toBeRejectedNotFound();

        // update-many empty
        expect(
            await db.model.updateMany({
                where: { id: '3' },
                data: { value: 5 },
            }),
        ).toEqual(expect.objectContaining({ count: 0 }));

        // upsert
        expect(
            await db.model.upsert({
                where: { id: '3' },
                create: { id: '3', value: 5 },
                update: { value: 6 },
            }),
        ).toEqual(expect.objectContaining({ value: 5 }));

        // update denied
        await expect(
            db.model.update({
                where: { id: '1' },
                data: {
                    value: 3,
                },
            }),
        ).toBeRejectedNotFound();

        // update success
        expect(
            await db.model.update({
                where: { id: '2' },
                data: {
                    value: 3,
                },
            }),
        ).toBeTruthy();
    });

    it('update id tests', async () => {
        const db = await createPolicyTestClient(
            `
        model Model {
            id String @id @default(uuid())
            value Int
        
            @@allow('read', value > 1)
            @@allow('create', value > 0)
            @@allow('update', value > 1)
            @@allow('post-update', value > 2)
        }
        `,
        );

        await db.model.create({
            data: {
                id: '1',
                value: 2,
            },
        });

        // update denied
        await expect(
            db.model.update({
                where: { id: '1' },
                data: {
                    id: '2',
                    value: 1,
                },
            }),
        ).toBeRejectedByPolicy();

        if (db.$schema.provider.type !== 'mysql') {
            // update success
            await expect(
                db.model.update({
                    where: { id: '1' },
                    data: {
                        id: '2',
                        value: 3,
                    },
                }),
            ).resolves.toMatchObject({ id: '2', value: 3 });
        } else {
            // mysql doesn't support post-update with id updates
            await expect(
                db.model.update({
                    where: { id: '1' },
                    data: {
                        id: '2',
                        value: 3,
                    },
                }),
            ).toBeRejectedByPolicy();

            // force update
            await db.$unuseAll().model.update({
                where: { id: '1' },
                data: {
                    id: '2',
                    value: 3,
                },
            });
        }

        // upsert denied
        await expect(
            db.model.upsert({
                where: { id: '2' },
                update: {
                    id: '3',
                    value: 1,
                },
                create: {
                    id: '4',
                    value: 5,
                },
            }),
        ).toBeRejectedByPolicy();

        if (db.$schema.provider.type !== 'mysql') {
            // upsert success
            await expect(
                db.model.upsert({
                    where: { id: '2' },
                    update: {
                        id: '3',
                        value: 4,
                    },
                    create: {
                        id: '4',
                        value: 5,
                    },
                }),
            ).resolves.toMatchObject({ id: '3', value: 4 });
        }
    });

    it('delete tests', async () => {
        const db = await createPolicyTestClient(
            `
        model Model {
            id String @id @default(uuid())
            value Int
        
            @@allow('create', true)
            @@allow('read', value > 2)
            @@allow('delete', value > 1)
        }
        `,
        );

        await expect(db.model.delete({ where: { id: '1' } })).toBeRejectedNotFound();

        await expect(
            db.model.create({
                data: { id: '1', value: 1 },
            }),
        ).toBeRejectedByPolicy();

        await expect(db.model.delete({ where: { id: '1' } })).toBeRejectedNotFound();
        await expect(db.$unuseAll().model.findUnique({ where: { id: '1' } })).toResolveTruthy();

        await expect(
            db.model.create({
                data: { id: '2', value: 2 },
            }),
        ).toBeRejectedByPolicy();
        await expect(db.$unuseAll().model.findUnique({ where: { id: '2' } })).toBeTruthy();
        // deleted but unable to read back
        await expect(db.model.delete({ where: { id: '2' } })).toBeRejectedByPolicy();
        await expect(db.$unuseAll().model.findUnique({ where: { id: '2' } })).toResolveNull();

        await expect(
            db.model.create({
                data: { id: '2', value: 2 },
            }),
        ).toBeRejectedByPolicy();
        // only '2' is deleted, '1' is rejected by policy
        expect(await db.model.deleteMany()).toEqual(expect.objectContaining({ count: 1 }));
        expect(await db.$unuseAll().model.findUnique({ where: { id: '2' } })).toBeNull();
        expect(await db.$unuseAll().model.findUnique({ where: { id: '1' } })).toBeTruthy();

        expect(await db.model.deleteMany()).toEqual(expect.objectContaining({ count: 0 }));
    });
});
