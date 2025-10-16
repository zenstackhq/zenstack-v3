import { describe, expect, it } from 'vitest';
import { createPolicyTestClient } from '@zenstackhq/testtools';

describe('empty policy tests', () => {
    it('works with simple operations', async () => {
        const db = await createPolicyTestClient(
            `
        model Model {
            id String @id @default(uuid())
            value Int
        }
        `,
        );

        const rawDb = db.$unuseAll();
        await rawDb.model.create({ data: { id: '1', value: 0 } });

        expect(await db.model.findMany()).toHaveLength(0);
        expect(await db.model.findUnique({ where: { id: '1' } })).toBeNull();
        expect(await db.model.findFirst({ where: { id: '1' } })).toBeNull();
        await expect(db.model.findUniqueOrThrow({ where: { id: '1' } })).toBeRejectedNotFound();
        await expect(db.model.findFirstOrThrow({ where: { id: '1' } })).toBeRejectedNotFound();

        await expect(db.model.create({ data: { value: 1 } })).toBeRejectedByPolicy();
        await expect(db.model.createMany({ data: [{ value: 1 }] })).toBeRejectedByPolicy();

        await expect(db.model.update({ where: { id: '1' }, data: { value: 1 } })).toBeRejectedNotFound();
        await expect(db.model.updateMany({ data: { value: 1 } })).resolves.toMatchObject({ count: 0 });
        await expect(
            db.model.upsert({
                where: { id: '1' },
                create: { value: 1 },
                update: { value: 1 },
            }),
        ).toBeRejectedByPolicy();

        await expect(db.model.delete({ where: { id: '1' } })).toBeRejectedNotFound();
        await expect(db.model.deleteMany()).resolves.toMatchObject({
            count: 0,
        });

        await expect(db.model.aggregate({ _avg: { value: true } })).resolves.toEqual(
            expect.objectContaining({ _avg: { value: null } }),
        );
        await expect(db.model.groupBy({ by: ['id'], _avg: { value: true } })).resolves.toHaveLength(0);
        await expect(db.model.count()).resolves.toEqual(0);
    });

    it('to-many write', async () => {
        const db = await createPolicyTestClient(
            `
        model M1 {
            id String @id @default(uuid())
            m2 M2[]

            @@allow('all', true)
        }

        model M2 {
            id String @id @default(uuid())
            m1 M1 @relation(fields: [m1Id], references:[id])
            m1Id String
        }
        `,
        );

        await expect(
            db.m1.create({
                data: {
                    m2: {
                        create: [{}],
                    },
                },
            }),
        ).toBeRejectedByPolicy();
    });

    it('to-one write', async () => {
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
        }
        `,
        );

        await expect(
            db.m1.create({
                data: {
                    m2: {
                        create: {},
                    },
                },
            }),
        ).toBeRejectedByPolicy();
    });
});
