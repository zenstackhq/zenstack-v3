import { describe, expect, it } from 'vitest';
import { createPolicyTestClient } from '@zenstackhq/testtools';

describe('Relation checker', () => {
    it('should work for read', async () => {
        const db = await createPolicyTestClient(
            `
            model User {
                id Int @id @default(autoincrement())
                profile Profile?
                public Boolean
                @@allow('read', public)
            }

            model Profile {
                id Int @id @default(autoincrement())
                user User @relation(fields: [userId], references: [id])
                userId Int @unique
                age Int
                @@allow('read', check(user, 'read'))
            }
            `,
        );

        await db.$unuseAll().user.create({
            data: {
                id: 1,
                public: true,
                profile: {
                    create: { age: 18 },
                },
            },
        });

        await db.$unuseAll().user.create({
            data: {
                id: 2,
                public: false,
                profile: {
                    create: { age: 20 },
                },
            },
        });

        await expect(db.profile.findMany()).resolves.toHaveLength(1);
    });

    it('should work for simple create', async () => {
        const db = await createPolicyTestClient(
            `
            model User {
                id Int @id @default(autoincrement())
                profile Profile?
                public Boolean
                @@allow('create', true)
                @@allow('read', public)
            }

            model Profile {
                id Int @id @default(autoincrement())
                user User @relation(fields: [userId], references: [id])
                userId Int @unique
                age Int
                @@allow('read', true)
                @@allow('create', check(user, 'read'))
            }
            `,
        );

        await db.$unuseAll().user.create({
            data: {
                id: 1,
                public: true,
            },
        });

        await db.$unuseAll().user.create({
            data: {
                id: 2,
                public: false,
            },
        });

        await expect(db.profile.create({ data: { user: { connect: { id: 1 } }, age: 18 } })).toResolveTruthy();
        await expect(db.profile.create({ data: { user: { connect: { id: 2 } }, age: 18 } })).toBeRejectedByPolicy();
    });

    it('should work for nested create', async () => {
        const db = await createPolicyTestClient(
            `
            model User {
                id Int @id @default(autoincrement())
                profile Profile?
                public Boolean
                @@allow('create', true)
                @@allow('read', public)
            }

            model Profile {
                id Int @id @default(autoincrement())
                user User @relation(fields: [userId], references: [id])
                userId Int @unique
                age Int
                @@allow('read', true)
                @@allow('create', age < 30 && check(user, 'read'))
            }
            `,
        );

        await expect(
            db.user.create({
                data: {
                    id: 1,
                    public: true,
                    profile: {
                        create: { age: 18 },
                    },
                },
            }),
        ).toResolveTruthy();

        await expect(
            db.user.create({
                data: {
                    id: 2,
                    public: false,
                    profile: {
                        create: { age: 18 },
                    },
                },
            }),
        ).toBeRejectedByPolicy();

        await expect(
            db.user.create({
                data: {
                    id: 3,
                    public: true,
                    profile: {
                        create: { age: 30 },
                    },
                },
            }),
        ).toBeRejectedByPolicy();
    });

    it('should work for update', async () => {
        const db = await createPolicyTestClient(
            `
            model User {
                id Int @id @default(autoincrement())
                profile Profile?
                public Boolean
                @@allow('create', true)
                @@allow('read', public)
            }

            model Profile {
                id Int @id @default(autoincrement())
                user User @relation(fields: [userId], references: [id])
                userId Int @unique
                age Int
                @@allow('read', true)
                @@allow('update', check(user, 'read') && age < 30)
            }
            `,
        );

        await db.$unuseAll().user.create({
            data: {
                id: 1,
                public: true,
                profile: {
                    create: { id: 1, age: 18 },
                },
            },
        });

        await db.$unuseAll().user.create({
            data: {
                id: 2,
                public: false,
                profile: {
                    create: { id: 2, age: 20 },
                },
            },
        });

        await db.$unuseAll().user.create({
            data: {
                id: 3,
                public: true,
                profile: {
                    create: { id: 3, age: 30 },
                },
            },
        });

        await expect(db.profile.update({ where: { id: 1 }, data: { age: 21 } })).toResolveTruthy();
        await expect(db.profile.update({ where: { id: 2 }, data: { age: 21 } })).toBeRejectedNotFound();
        await expect(db.profile.update({ where: { id: 3 }, data: { age: 21 } })).toBeRejectedNotFound();
    });

    it('should work for delete', async () => {
        const db = await createPolicyTestClient(
            `
            model User {
                id Int @id @default(autoincrement())
                profile Profile?
                public Boolean
                @@allow('create', true)
                @@allow('read', public)
            }

            model Profile {
                id Int @id @default(autoincrement())
                user User @relation(fields: [userId], references: [id])
                userId Int @unique
                age Int
                @@allow('read', true)
                @@allow('delete', check(user, 'read') && age < 30)
            }
            `,
        );

        await db.$unuseAll().user.create({
            data: {
                id: 1,
                public: true,
                profile: {
                    create: { id: 1, age: 18 },
                },
            },
        });

        await db.$unuseAll().user.create({
            data: {
                id: 2,
                public: false,
                profile: {
                    create: { id: 2, age: 20 },
                },
            },
        });

        await db.$unuseAll().user.create({
            data: {
                id: 3,
                public: true,
                profile: {
                    create: { id: 3, age: 30 },
                },
            },
        });

        await expect(db.profile.delete({ where: { id: 1 } })).toResolveTruthy();
        await expect(db.profile.delete({ where: { id: 2 } })).toBeRejectedNotFound();
        await expect(db.profile.delete({ where: { id: 3 } })).toBeRejectedNotFound();
    });

    // TODO: field-level policy support
    it.skip('should work for field-level', async () => {
        const db = await createPolicyTestClient(
            `
            model User {
                id Int @id @default(autoincrement())
                profile Profile?
                public Boolean
                @@allow('read', public)
            }

            model Profile {
                id Int @id @default(autoincrement())
                user User @relation(fields: [userId], references: [id])
                userId Int @unique
                age Int @allow('read', age < 30 && check(user, 'read'))
                @@allow('all', true)
            }
            `,
        );

        await db.$unuseAll().user.create({
            data: {
                id: 1,
                public: true,
                profile: {
                    create: { age: 18 },
                },
            },
        });

        await db.$unuseAll().user.create({
            data: {
                id: 2,
                public: false,
                profile: {
                    create: { age: 20 },
                },
            },
        });

        await db.$unuseAll().user.create({
            data: {
                id: 3,
                public: true,
                profile: {
                    create: { age: 30 },
                },
            },
        });

        const p1 = await db.profile.findUnique({ where: { id: 1 } });
        expect(p1.age).toBe(18);
        const p2 = await db.profile.findUnique({ where: { id: 2 } });
        expect(p2.age).toBeUndefined();
        const p3 = await db.profile.findUnique({ where: { id: 3 } });
        expect(p3.age).toBeUndefined();
    });

    // TODO: field-level policy support
    it.skip('should work for field-level with override', async () => {
        const db = await createPolicyTestClient(
            `
            model User {
                id Int @id @default(autoincrement())
                profile Profile?
                public Boolean
                @@allow('read', public)
            }

            model Profile {
                id Int @id @default(autoincrement())
                user User @relation(fields: [userId], references: [id])
                userId Int @unique
                age Int @allow('read', age < 30 && check(user, 'read'), true)
            }
            `,
        );

        await db.$unuseAll().user.create({
            data: {
                id: 1,
                public: true,
                profile: {
                    create: { age: 18 },
                },
            },
        });

        await db.$unuseAll().user.create({
            data: {
                id: 2,
                public: false,
                profile: {
                    create: { age: 20 },
                },
            },
        });

        await db.$unuseAll().user.create({
            data: {
                id: 3,
                public: true,
                profile: {
                    create: { age: 30 },
                },
            },
        });

        const p1 = await db.profile.findUnique({ where: { id: 1 }, select: { age: true } });
        expect(p1.age).toBe(18);
        const p2 = await db.profile.findUnique({ where: { id: 2 }, select: { age: true } });
        expect(p2).toBeNull();
        const p3 = await db.profile.findUnique({ where: { id: 3 }, select: { age: true } });
        expect(p3).toBeNull();
    });

    it('should work for cross-model field comparison', async () => {
        const db = await createPolicyTestClient(
            `
            model User {
                id Int @id @default(autoincrement())
                profile Profile?
                age Int
                @@allow('read', true)
                @@allow('update', age == profile.age)
            }

            model Profile {
                id Int @id @default(autoincrement())
                user User @relation(fields: [userId], references: [id])
                userId Int @unique
                age Int
                @@allow('read', true)
                @@allow('update', check(user, 'update') && age < 30)
            }
            `,
        );

        await db.$unuseAll().user.create({
            data: {
                id: 1,
                age: 18,
                profile: {
                    create: { id: 1, age: 18 },
                },
            },
        });

        await db.$unuseAll().user.create({
            data: {
                id: 2,
                age: 18,
                profile: {
                    create: { id: 2, age: 20 },
                },
            },
        });

        await db.$unuseAll().user.create({
            data: {
                id: 3,
                age: 30,
                profile: {
                    create: { id: 3, age: 30 },
                },
            },
        });

        await expect(db.profile.update({ where: { id: 1 }, data: { age: 21 } })).toResolveTruthy();
        await expect(db.profile.update({ where: { id: 2 }, data: { age: 21 } })).toBeRejectedNotFound();
        await expect(db.profile.update({ where: { id: 3 }, data: { age: 21 } })).toBeRejectedNotFound();
    });

    it('should work for implicit specific operations', async () => {
        const db = await createPolicyTestClient(
            `
            model User {
                id Int @id @default(autoincrement())
                profile Profile?
                public Boolean
                @@allow('read', public)
                @@allow('create', true)
            }

            model Profile {
                id Int @id @default(autoincrement())
                user User @relation(fields: [userId], references: [id])
                userId Int @unique
                age Int
                @@allow('read', check(user))
                @@allow('create', check(user))
            }
            `,
        );

        await db.$unuseAll().user.create({
            data: {
                id: 1,
                public: true,
                profile: {
                    create: { age: 18 },
                },
            },
        });

        await db.$unuseAll().user.create({
            data: {
                id: 2,
                public: false,
                profile: {
                    create: { age: 20 },
                },
            },
        });

        await expect(db.profile.findMany()).resolves.toHaveLength(1);

        await db.$unuseAll().user.create({
            data: {
                id: 3,
                public: true,
            },
        });
        await expect(db.profile.create({ data: { user: { connect: { id: 3 } }, age: 18 } })).toResolveTruthy();

        await db.$unuseAll().user.create({
            data: {
                id: 4,
                public: false,
            },
        });
        await expect(db.profile.create({ data: { user: { connect: { id: 4 } }, age: 18 } })).toBeRejectedByPolicy();
    });

    it('should work for implicit all operations', async () => {
        const db = await createPolicyTestClient(
            `
            model User {
                id Int @id @default(autoincrement())
                profile Profile?
                public Boolean
                @@allow('all', public)
            }

            model Profile {
                id Int @id @default(autoincrement())
                user User @relation(fields: [userId], references: [id])
                userId Int @unique
                age Int
                @@allow('all', check(user))
            }
            `,
        );

        await db.$unuseAll().user.create({
            data: {
                id: 1,
                public: true,
                profile: {
                    create: { age: 18 },
                },
            },
        });

        await db.$unuseAll().user.create({
            data: {
                id: 2,
                public: false,
                profile: {
                    create: { age: 20 },
                },
            },
        });

        await expect(db.profile.findMany()).resolves.toHaveLength(1);

        await db.$unuseAll().user.create({
            data: {
                id: 3,
                public: true,
            },
        });
        await expect(db.profile.create({ data: { user: { connect: { id: 3 } }, age: 18 } })).toResolveTruthy();

        await db.$unuseAll().user.create({
            data: {
                id: 4,
                public: false,
            },
        });
        await expect(db.profile.create({ data: { user: { connect: { id: 4 } }, age: 18 } })).toBeRejectedByPolicy();
    });

    it('should report error for invalid args', async () => {
        await expect(
            createPolicyTestClient(
                `
            model User {
                id Int @id @default(autoincrement())
                public Boolean
                @@allow('read', check(public))
            }
            `,
            ),
        ).rejects.toThrow(/argument must be a relation field/);

        await expect(
            createPolicyTestClient(
                `
            model User {
                id Int @id @default(autoincrement())
                posts Post[]
                @@allow('read', check(posts))
            }
            model Post {
                id Int @id @default(autoincrement())
                user User @relation(fields: [userId], references: [id])
                userId Int
            }
            `,
            ),
        ).rejects.toThrow(/argument cannot be an array field/);

        await expect(
            createPolicyTestClient(
                `
            model User {
                id Int @id @default(autoincrement())
                profile Profile?
                @@allow('read', check(profile.details))
            }

            model Profile {
                id Int @id @default(autoincrement())
                user User @relation(fields: [userId], references: [id])
                userId Int
                details ProfileDetails?
            }

            model ProfileDetails {
                id Int @id @default(autoincrement())
                profile Profile @relation(fields: [profileId], references: [id])
                profileId Int
                age Int
            }
            `,
            ),
        ).rejects.toThrow(/argument must be a relation field/);

        await expect(
            createPolicyTestClient(
                `
            model User {
                id Int @id @default(autoincrement())
                posts Post[]
                @@allow('read', check(posts, 'all'))
            }
            model Post {
                id Int @id @default(autoincrement())
                user User @relation(fields: [userId], references: [id])
                userId Int
            }
            `,
            ),
        ).rejects.toThrow(/argument must be a "read", "create", "update", or "delete"/);
    });

    it('should report error for cyclic relation check', async () => {
        await expect(
            createPolicyTestClient(
                `
            model User {
                id Int @id @default(autoincrement())
                profile Profile?
                profileDetails ProfileDetails?
                public Boolean
                @@allow('read', check(profile))
            }

            model Profile {
                id Int @id @default(autoincrement())
                user User @relation(fields: [userId], references: [id])
                userId Int @unique
                details ProfileDetails?
                @@allow('read', check(details))
            }

            model ProfileDetails {
                id Int @id @default(autoincrement())
                profile Profile @relation(fields: [profileId], references: [id])
                profileId Int @unique
                user User @relation(fields: [userId], references: [id])
                userId Int @unique
                age Int
                @@allow('read', check(user))    
            }
            `,
            ),
        ).rejects.toThrow(/cyclic dependency/);
    });

    it('should report error for cyclic relation check indirect', async () => {
        await expect(
            createPolicyTestClient(
                `
            model User {
                id Int @id @default(autoincrement())
                profile Profile?
                public Boolean
                @@allow('read', check(profile))
            }

            model Profile {
                id Int @id @default(autoincrement())
                user User @relation(fields: [userId], references: [id])
                userId Int @unique
                details ProfileDetails?
                @@allow('read', check(details))
            }

            model ProfileDetails {
                id Int @id @default(autoincrement())
                profile Profile @relation(fields: [profileId], references: [id])
                profileId Int @unique
                age Int
                @@allow('read', check(profile))    
            }
            `,
            ),
        ).rejects.toThrow(/cyclic dependency/);
    });

    it('should work for query builder', async () => {
        const db = await createPolicyTestClient(
            `
            model User {
                id Int @id @default(autoincrement())
                profile Profile?
                public Boolean
                @@allow('read', public)
            }

            model Profile {
                id Int @id @default(autoincrement())
                user User @relation(fields: [userId], references: [id])
                userId Int @unique
                age Int
                @@allow('read', check(user))
            }
            `,
        );

        await db.$unuseAll().user.create({
            data: {
                id: 1,
                public: true,
                profile: {
                    create: { age: 18 },
                },
            },
        });

        await db.$unuseAll().user.create({
            data: {
                id: 2,
                public: false,
                profile: {
                    create: { age: 20 },
                },
            },
        });

        await expect(db.$qb.selectFrom('Profile as p').selectAll('p').execute()).resolves.toHaveLength(1);
    });
});
