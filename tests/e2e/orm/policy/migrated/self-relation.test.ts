import { describe, expect, it } from 'vitest';
import { createPolicyTestClient } from '@zenstackhq/testtools';

describe('Policy self relations tests', () => {
    it('one-to-one', async () => {
        const db = await createPolicyTestClient(
            `
            model User {
                id          Int     @id @default(autoincrement())
                value       Int
                successorId Int?    @unique
                successor   User?   @relation("BlogOwnerHistory", fields: [successorId], references: [id])
                predecessor User?   @relation("BlogOwnerHistory")

                @@allow('create,update', value > 0)
                @@allow('read', true)
            }
        `,
            { usePrismaPush: true },
        );

        // create denied
        await expect(
            db.user.create({
                data: {
                    value: 0,
                },
            }),
        ).toBeRejectedByPolicy();

        await expect(
            db.user.create({
                data: {
                    value: 1,
                    successor: {
                        create: {
                            value: 0,
                        },
                    },
                },
            }),
        ).toBeRejectedByPolicy();

        await expect(
            db.user.create({
                data: {
                    value: 1,
                    successor: {
                        create: {
                            value: 1,
                        },
                    },
                    predecessor: {
                        create: {
                            value: 0,
                        },
                    },
                },
            }),
        ).toBeRejectedByPolicy();

        await expect(
            db.user.create({
                data: {
                    value: 1,
                    successor: {
                        create: {
                            value: 1,
                        },
                    },
                    predecessor: {
                        create: {
                            value: 1,
                        },
                    },
                },
            }),
        ).toResolveTruthy();
    });

    it('one-to-many', async () => {
        const db = await createPolicyTestClient(
            `
            model User {
                id        Int     @id @default(autoincrement())
                value     Int
                teacherId Int?
                teacher   User?   @relation("TeacherStudents", fields: [teacherId], references: [id])
                students  User[]  @relation("TeacherStudents")

                @@allow('create,update', value > 0)
                @@allow('read', true)
            }
        `,
            { usePrismaPush: true },
        );

        // create denied
        await expect(
            db.user.create({
                data: {
                    value: 0,
                },
            }),
        ).toBeRejectedByPolicy();

        await expect(
            db.user.create({
                data: {
                    value: 1,
                    teacher: {
                        create: { value: 0 },
                    },
                },
            }),
        ).toBeRejectedByPolicy();

        await expect(
            db.user.create({
                data: {
                    value: 1,
                    teacher: {
                        create: { value: 1 },
                    },
                    students: {
                        create: [{ value: 0 }, { value: 1 }],
                    },
                },
            }),
        ).toBeRejectedByPolicy();

        await expect(
            db.user.create({
                data: {
                    value: 1,
                    teacher: {
                        create: { value: 1 },
                    },
                    students: {
                        create: [{ value: 1 }, { value: 2 }],
                    },
                },
            }),
        ).toResolveTruthy();
    });

    it('many-to-many', async () => {
        const db = await createPolicyTestClient(
            `
            model User {
                id         Int     @id @default(autoincrement())
                value      Int
                followedBy User[]  @relation("UserFollows")
                following  User[]  @relation("UserFollows")

                @@allow('create,update', value > 0)
                @@allow('read', true)                
            }
        `,
            { usePrismaPush: true },
        );

        // create denied
        await expect(
            db.user.create({
                data: {
                    value: 0,
                },
            }),
        ).toBeRejectedByPolicy();

        await expect(
            db.user.create({
                data: {
                    value: 1,
                    followedBy: { create: { value: 0 } },
                },
            }),
        ).toBeRejectedByPolicy();

        await expect(
            db.user.create({
                data: {
                    value: 1,
                    followedBy: { create: { value: 1 } },
                    following: { create: [{ value: 0 }, { value: 1 }] },
                },
            }),
        ).toBeRejectedByPolicy();

        await expect(
            db.user.create({
                data: {
                    value: 1,
                    followedBy: { create: { value: 1 } },
                    following: { create: [{ value: 1 }, { value: 2 }] },
                },
            }),
        ).toResolveTruthy();
    });
});
