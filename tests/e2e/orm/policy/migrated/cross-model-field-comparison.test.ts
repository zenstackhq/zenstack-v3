import { describe, expect, it } from 'vitest';
import { createPolicyTestClient } from '@zenstackhq/testtools';

describe('cross-model field comparison tests', () => {
    it('works with to-one relation', async () => {
        const db = await createPolicyTestClient(
            `
        model User {
            id Int @id
            profile Profile @relation(fields: [profileId], references: [id])
            profileId Int  @unique
            age Int

            @@allow('all', age == profile.age)
            @@deny('update', age > 100)
        }

        model Profile {
            id Int @id
            age Int
            user User?

            @@allow('all', true)
        }
        `,
        );

        const rawDb = db.$unuseAll();

        const reset = async () => {
            await rawDb.user.deleteMany();
            await rawDb.profile.deleteMany();
        };

        // create
        await expect(
            db.user.create({
                data: {
                    id: 1,
                    age: 18,
                    profile: { create: { id: 1, age: 20 } },
                },
            }),
        ).toBeRejectedByPolicy();
        await expect(rawDb.user.findUnique({ where: { id: 1 } })).toResolveNull();
        await expect(
            db.user.create({
                data: {
                    id: 1,
                    age: 18,
                    profile: { create: { id: 1, age: 18 } },
                },
            }),
        ).toResolveTruthy();
        await expect(rawDb.user.findUnique({ where: { id: 1 } })).toResolveTruthy();
        await reset();

        // createMany
        const profile = await rawDb.profile.create({
            data: { id: 1, age: 20 },
        });
        await expect(
            db.user.createMany({
                data: [{ id: 1, age: 18, profileId: profile.id }],
            }),
        ).toBeRejectedByPolicy();
        await expect(rawDb.user.findUnique({ where: { id: 1 } })).toResolveNull();
        await expect(
            db.user.createMany({
                data: { id: 1, age: 20, profileId: profile.id },
            }),
        ).toResolveTruthy();
        await expect(rawDb.user.findUnique({ where: { id: 1 } })).toResolveTruthy();
        await reset();

        // read
        await rawDb.user.create({
            data: { id: 1, age: 18, profile: { create: { id: 1, age: 18 } } },
        });
        await expect(db.user.findUnique({ where: { id: 1 } })).toResolveTruthy();
        await expect(db.user.findMany()).resolves.toHaveLength(1);
        await rawDb.user.update({ where: { id: 1 }, data: { age: 20 } });
        await expect(db.user.findUnique({ where: { id: 1 } })).toResolveNull();
        await expect(db.user.findMany()).resolves.toHaveLength(0);
        await reset();

        // update
        await rawDb.user.create({
            data: { id: 1, age: 18, profile: { create: { id: 1, age: 18 } } },
        });
        // update should succeed but read back is rejected
        await expect(db.user.update({ where: { id: 1 }, data: { age: 20 } })).toBeRejectedByPolicy();
        await expect(rawDb.user.findUnique({ where: { id: 1 } })).resolves.toMatchObject({ age: 20 });
        await expect(db.user.update({ where: { id: 1 }, data: { age: 18 } })).toBeRejectedNotFound();
        await reset();

        // // post update
        // await rawDb.user.create({
        //     data: { id: 1, age: 18, profile: { create: { id: 1, age: 18 } } },
        // });
        // await expect(
        //     db.user.update({ where: { id: 1 }, data: { age: 15 } })
        // ).toBeRejectedByPolicy();
        // await expect(
        //     db.user.update({ where: { id: 1 }, data: { age: 20 } })
        // ).toResolveTruthy();
        // await reset();

        // TODO: upsert support
        // // upsert
        // await rawDb.user.create({
        //     data: { id: 1, age: 18, profile: { create: { id: 1, age: 20 } } },
        // });
        // await expect(
        //     db.user.upsert({
        //         where: { id: 1 },
        //         create: { id: 1, age: 25 },
        //         update: { age: 25 },
        //     })
        // ).toBeRejectedByPolicy();
        // await expect(
        //     db.user.upsert({
        //         where: { id: 2 },
        //         create: {
        //             id: 2,
        //             age: 18,
        //             profile: { create: { id: 2, age: 25 } },
        //         },
        //         update: { age: 25 },
        //     })
        // ).toBeRejectedByPolicy();
        // await rawDb.user.update({ where: { id: 1 }, data: { age: 20 } });
        // await expect(
        //     db.user.upsert({
        //         where: { id: 1 },
        //         create: { id: 1, age: 25 },
        //         update: { age: 25 },
        //     })
        // ).toResolveTruthy();
        // await expect(
        //     rawDb.user.findUnique({ where: { id: 1 } })
        // ).resolves.toMatchObject({ age: 25 });
        // await expect(
        //     db.user.upsert({
        //         where: { id: 2 },
        //         create: {
        //             id: 2,
        //             age: 25,
        //             profile: { create: { id: 2, age: 25 } },
        //         },
        //         update: { age: 25 },
        //     })
        // ).toResolveTruthy();
        // await expect(rawDb.user.findMany()).resolves.toHaveLength(2);
        // await reset();

        // updateMany
        await rawDb.user.create({
            data: { id: 1, age: 18, profile: { create: { id: 1, age: 20 } } },
        });
        // non updatable
        await expect(db.user.updateMany({ data: { age: 18 } })).resolves.toMatchObject({ count: 0 });
        await rawDb.user.create({
            data: { id: 2, age: 25, profile: { create: { id: 2, age: 25 } } },
        });
        // one of the two is updatable
        await expect(db.user.updateMany({ data: { age: 30 } })).resolves.toMatchObject({ count: 1 });
        await expect(rawDb.user.findUnique({ where: { id: 1 } })).resolves.toMatchObject({ age: 18 });
        await expect(rawDb.user.findUnique({ where: { id: 2 } })).resolves.toMatchObject({ age: 30 });
        await reset();

        // delete
        await rawDb.user.create({
            data: { id: 1, age: 18, profile: { create: { id: 1, age: 20 } } },
        });
        await expect(db.user.delete({ where: { id: 1 } })).toBeRejectedNotFound();
        await expect(rawDb.user.findMany()).resolves.toHaveLength(1);
        await rawDb.user.update({ where: { id: 1 }, data: { age: 20 } });
        await expect(db.user.delete({ where: { id: 1 } })).toResolveTruthy();
        await expect(rawDb.user.findMany()).resolves.toHaveLength(0);
        await reset();

        // deleteMany
        await rawDb.user.create({
            data: { id: 1, age: 18, profile: { create: { id: 1, age: 20 } } },
        });
        await expect(db.user.deleteMany()).resolves.toMatchObject({ count: 0 });
        await rawDb.user.create({
            data: { id: 2, age: 25, profile: { create: { id: 2, age: 25 } } },
        });
        // one of the two is deletable
        await expect(db.user.deleteMany()).resolves.toMatchObject({ count: 1 });
        await expect(rawDb.user.findMany()).resolves.toHaveLength(1);
    });
});
