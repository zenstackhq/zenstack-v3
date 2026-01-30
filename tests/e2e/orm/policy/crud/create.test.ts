import { createPolicyTestClient } from '@zenstackhq/testtools';
import { describe, expect, it } from 'vitest';

describe('Policy create tests', () => {
    it('works with scalar field check', async () => {
        const db = await createPolicyTestClient(
            `
model Foo {
    id Int @id @default(autoincrement())
    x  Int
    @@allow('create', x > 0)
    @@allow('read', true)
}
`,
        );
        await expect(db.foo.create({ data: { x: 0 } })).toBeRejectedByPolicy();
        await expect(db.foo.create({ data: { x: 1 } })).resolves.toMatchObject({ x: 1 });

        await expect(db.$qb.insertInto('Foo').values({ x: 0 }).executeTakeFirst()).toBeRejectedByPolicy();

        await expect(db.$qb.insertInto('Foo').values({ x: 1 }).executeTakeFirst()).toResolveTruthy();

        await expect(db.foo.findMany({ where: { x: 1 } })).resolves.toHaveLength(2);
    });

    it('works with this scalar member check', async () => {
        const db = await createPolicyTestClient(
            `
model Foo {
    id Int @id @default(autoincrement())
    x  Int
    @@allow('create', this.x > 0)
    @@allow('read', true)
}
`,
        );
        await expect(db.foo.create({ data: { x: 0 } })).toBeRejectedByPolicy();
        await expect(db.foo.create({ data: { x: 1 } })).resolves.toMatchObject({ x: 1 });
    });

    it('denies by default', async () => {
        const db = await createPolicyTestClient(
            `
model Foo {
    id Int @id @default(autoincrement())
    x  Int
}
`,
        );
        await expect(db.foo.create({ data: { x: 0 } })).toBeRejectedByPolicy();
    });

    it('works with deny rule', async () => {
        const db = await createPolicyTestClient(
            `
model Foo {
    id Int @id @default(autoincrement())
    x  Int
    @@deny('create', x <= 0)
    @@allow('create,read', true)
}
`,
        );
        await expect(db.foo.create({ data: { x: 0 } })).toBeRejectedByPolicy();
        await expect(db.foo.create({ data: { x: 1 } })).resolves.toMatchObject({ x: 1 });
    });

    it('works with mixed allow and deny rules', async () => {
        const db = await createPolicyTestClient(
            `
model Foo {
    id Int @id @default(autoincrement())
    x  Int
    @@deny('create', x <= 0)
    @@allow('create', x <= 0 || x > 1)
    @@allow('read', true)
}
`,
        );
        await expect(db.foo.create({ data: { x: 0 } })).toBeRejectedByPolicy();
        await expect(db.foo.create({ data: { x: 1 } })).toBeRejectedByPolicy();
        await expect(db.foo.create({ data: { x: 2 } })).resolves.toMatchObject({ x: 2 });
    });

    it('works with non-provided fields', async () => {
        const db = await createPolicyTestClient(
            `
model Foo {
    id Int @id @default(autoincrement())
    x  Int @default(0)
    @@allow('create', x > 0)
    @@allow('read', true)
}
`,
        );
        await expect(db.foo.create({ data: {} })).toBeRejectedByPolicy();
        await expect(db.foo.create({ data: { x: 1 } })).toResolveTruthy();
    });

    it('works with db-generated fields', async () => {
        const db = await createPolicyTestClient(
            `
model Foo {
    id Int @id @default(autoincrement())
    @@allow('create', id > 0)
    @@allow('read', true)
}
`,
        );
        await expect(db.foo.create({ data: {} })).toBeRejectedByPolicy();
        await expect(db.foo.create({ data: { id: 1 } })).toResolveTruthy();
    });

    it('rejects non-owned relation reference', async () => {
        await expect(
            createPolicyTestClient(
                `
model User {
    id Int @id
    profile Profile?
    @@allow('create', profile == null)
    @@allow('read', true)
}

model Profile {
    id Int @id
    name String
    user User @relation(fields: [userId], references: [id])
    userId Int @unique
}
            `,
            ),
        ).rejects.toThrow('non-owned relation fields are not allowed in "create" rules');
    });

    it('works with auth check', async () => {
        const db = await createPolicyTestClient(
            `
type Auth {
    x Int
    @@auth
}

model Foo {
    id Int @id @default(autoincrement())
    x  Int
    @@allow('create', x == auth().x)
    @@allow('read', true)
}
`,
        );
        await expect(db.foo.create({ data: { x: 0 } })).toBeRejectedByPolicy();
        await expect(db.$setAuth({ x: 0 }).foo.create({ data: { x: 1 } })).toBeRejectedByPolicy();
        await expect(db.$setAuth({ x: 1 }).foo.create({ data: { x: 1 } })).resolves.toMatchObject({ x: 1 });
    });

    it('works with owned to-one relation reference', async () => {
        const db = await createPolicyTestClient(
            `
model User {
    id Int @id
    profile Profile?
    @@allow('all', true)
}

model Profile {
    id Int @id
    user User? @relation(fields: [userId], references: [id])
    userId Int? @unique

    @@deny('all', auth() == null)
    @@allow('create', user.id == auth().id)
    @@allow('read', true)
}
            `,
        );

        await db.user.create({ data: { id: 1 } });
        await expect(db.profile.create({ data: { id: 1 } })).toBeRejectedByPolicy();
        await expect(db.$setAuth({ id: 0 }).profile.create({ data: { id: 1, userId: 1 } })).toBeRejectedByPolicy();
        await expect(db.$setAuth({ id: 1 }).profile.create({ data: { id: 1, userId: 1 } })).resolves.toMatchObject({
            id: 1,
        });

        await expect(db.profile.create({ data: { id: 2, user: { create: { id: 2 } } } })).toBeRejectedByPolicy();
        await expect(db.user.findUnique({ where: { id: 2 } })).toResolveNull();
        await expect(
            db
                .$setAuth({ id: 2 })
                .profile.create({ data: { id: 2, user: { create: { id: 2 } } }, include: { user: true } }),
        ).resolves.toMatchObject({
            id: 2,
            user: {
                id: 2,
            },
        });

        await db.user.create({ data: { id: 3 } });
        await expect(
            db.$setAuth({ id: 2 }).profile.create({ data: { id: 3, user: { connect: { id: 3 } } } }),
        ).toBeRejectedByPolicy();
        await expect(
            db.$setAuth({ id: 3 }).profile.create({ data: { id: 3, user: { connect: { id: 3 } } } }),
        ).toResolveTruthy();

        await expect(db.$setAuth({ id: 4 }).profile.create({ data: { id: 2, userId: 4 } })).toBeRejectedByPolicy();
    });

    it('works with nested create owner side', async () => {
        const db = await createPolicyTestClient(
            `
model User {
    id Int @id
    profile Profile?
    @@allow('all', true)
}

model Profile {
    id Int @id
    user User? @relation(fields: [userId], references: [id])
    userId Int? @unique

    @@deny('all', auth() == null)
    @@allow('create', user.id == auth().id)
    @@allow('read', true)
}
            `,
        );

        await expect(db.user.create({ data: { id: 1, profile: { create: { id: 1 } } } })).toBeRejectedByPolicy();
        await expect(
            db
                .$setAuth({ id: 1 })
                .user.create({ data: { id: 1, profile: { create: { id: 1 } } }, include: { profile: true } }),
        ).resolves.toMatchObject({
            id: 1,
            profile: {
                id: 1,
            },
        });
    });

    it('works with nested create non-owner side', async () => {
        const db = await createPolicyTestClient(
            `
model User {
    id Int @id
    profile Profile?
    @@deny('all', auth() == null)
    @@allow('create', this.id == auth().id)
    @@allow('read', true)
}

model Profile {
    id Int @id
    user User? @relation(fields: [userId], references: [id])
    userId Int? @unique
    @@allow('all', true)
}
            `,
        );

        await expect(db.profile.create({ data: { id: 1, user: { create: { id: 1 } } } })).toBeRejectedByPolicy();
        await expect(
            db
                .$setAuth({ id: 1 })
                .profile.create({ data: { id: 1, user: { create: { id: 1 } } }, include: { user: true } }),
        ).resolves.toMatchObject({
            id: 1,
            user: {
                id: 1,
            },
        });
    });

    it('works with unnamed many-to-many relation', async () => {
        const db = await createPolicyTestClient(
            `
model User {
    id Int @id
    groups Group[]
    private Boolean
    @@allow('create,read', true)
    @@allow('update', !private)
}

model Group {
    id Int @id
    private Boolean
    users User[]
    @@allow('create,read', true)
    @@allow('update', !private)
}
            `,
            { usePrismaPush: true },
        );

        await expect(
            db.user.create({
                data: { id: 1, private: false, groups: { create: [{ id: 1, private: false }] } },
            }),
        ).toResolveTruthy();

        await expect(
            db.user.create({
                data: { id: 2, private: true, groups: { create: [{ id: 2, private: false }] } },
            }),
        ).toBeRejectedByPolicy();

        await expect(
            db.user.create({
                data: { id: 2, private: false, groups: { create: [{ id: 2, private: true }] } },
            }),
        ).toBeRejectedByPolicy();

        await expect(
            db.user.create({
                data: { id: 2, private: true, groups: { create: [{ id: 2, private: true }] } },
            }),
        ).toBeRejectedByPolicy();
    });

    it('works with named many-to-many relation', async () => {
        const db = await createPolicyTestClient(
            `
model User {
    id Int @id
    groups Group[] @relation("UserGroups")
    private Boolean
    @@allow('create,read', true)
    @@allow('update', !private)
}

model Group {
    id Int @id
    private Boolean
    users User[] @relation("UserGroups")
    @@allow('create,read', true)
    @@allow('update', !private)
}
            `,
            { usePrismaPush: true },
        );

        await expect(
            db.user.create({
                data: { id: 1, private: false, groups: { create: [{ id: 1, private: false }] } },
            }),
        ).toResolveTruthy();

        await expect(
            db.user.create({
                data: { id: 2, private: true, groups: { create: [{ id: 2, private: false }] } },
            }),
        ).toBeRejectedByPolicy();

        await expect(
            db.user.create({
                data: { id: 2, private: false, groups: { create: [{ id: 2, private: true }] } },
            }),
        ).toBeRejectedByPolicy();

        await expect(
            db.user.create({
                data: { id: 2, private: true, groups: { create: [{ id: 2, private: true }] } },
            }),
        ).toBeRejectedByPolicy();
    });
});
