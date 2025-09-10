import { describe, expect, it } from 'vitest';
import { createPolicyTestClient } from '../utils';

describe('Update policy tests', () => {
    describe('Scalar condition tests', () => {
        it('works with scalar field check', async () => {
            const db = await createPolicyTestClient(
                `
model Foo {
    id Int @id
    x  Int
    @@allow('update', x > 0)
    @@allow('create,read', true)
}
`,
            );

            await db.foo.create({ data: { id: 1, x: 0 } });
            await expect(db.foo.update({ where: { id: 1 }, data: { x: 1 } })).toBeRejectedNotFound();
            await db.foo.create({ data: { id: 2, x: 1 } });
            await expect(db.foo.update({ where: { id: 2 }, data: { x: 2 } })).resolves.toMatchObject({ x: 2 });

            await expect(
                db.$qb.updateTable('Foo').set({ x: 1 }).where('id', '=', 1).executeTakeFirst(),
            ).resolves.toMatchObject({ numUpdatedRows: 0n });
            await expect(
                db.$qb.updateTable('Foo').set({ x: 3 }).where('id', '=', 2).returningAll().execute(),
            ).resolves.toMatchObject([{ id: 2, x: 3 }]);
        });

        it('works with this scalar member check', async () => {
            const db = await createPolicyTestClient(
                `
model Foo {
    id Int @id
    x  Int
    @@allow('update', this.x > 0)
    @@allow('create,read', true)
}
`,
            );

            await db.foo.create({ data: { id: 1, x: 0 } });
            await expect(db.foo.update({ where: { id: 1 }, data: { x: 1 } })).toBeRejectedNotFound();
            await db.foo.create({ data: { id: 2, x: 1 } });
            await expect(db.foo.update({ where: { id: 2 }, data: { x: 2 } })).resolves.toMatchObject({ x: 2 });
        });

        it('denies by default', async () => {
            const db = await createPolicyTestClient(
                `
model Foo {
    id Int @id
    x  Int
    @@allow('create,read', true)
}
`,
            );

            await db.foo.create({ data: { id: 1, x: 0 } });
            await expect(db.foo.update({ where: { id: 1 }, data: { x: 1 } })).toBeRejectedNotFound();
        });

        it('works with deny rule', async () => {
            const db = await createPolicyTestClient(
                `
model Foo {
    id Int @id
    x  Int
    @@deny('update', x <= 0)
    @@allow('create,read,update', true)
}
`,
            );
            await db.foo.create({ data: { id: 1, x: 0 } });
            await expect(db.foo.update({ where: { id: 1 }, data: { x: 1 } })).toBeRejectedNotFound();
            await db.foo.create({ data: { id: 2, x: 1 } });
            await expect(db.foo.update({ where: { id: 2 }, data: { x: 2 } })).resolves.toMatchObject({ x: 2 });
        });

        it('works with mixed allow and deny rules', async () => {
            const db = await createPolicyTestClient(
                `
model Foo {
    id Int @id
    x  Int
    @@deny('update', x <= 0)
    @@allow('update', x <= 0 || x > 1)
    @@allow('create,read', true)
}
`,
            );

            await db.foo.create({ data: { id: 1, x: 0 } });
            await expect(db.foo.update({ where: { id: 1 }, data: { x: 1 } })).toBeRejectedNotFound();
            await db.foo.create({ data: { id: 2, x: 1 } });
            await expect(db.foo.update({ where: { id: 2 }, data: { x: 2 } })).toBeRejectedNotFound();
            await db.foo.create({ data: { id: 3, x: 2 } });
            await expect(db.foo.update({ where: { id: 3 }, data: { x: 3 } })).resolves.toMatchObject({ x: 3 });
        });

        it('works with auth check', async () => {
            const db = await createPolicyTestClient(
                `
type Auth {
    x Int
    @@auth
}

model Foo {
    id Int @id
    x  Int
    @@allow('update', x == auth().x)
    @@allow('create,read', true)
}
`,
            );
            await db.foo.create({ data: { id: 1, x: 1 } });
            await expect(db.$setAuth({ x: 0 }).foo.update({ where: { id: 1 }, data: { x: 2 } })).toBeRejectedNotFound();
            await expect(db.$setAuth({ x: 1 }).foo.update({ where: { id: 1 }, data: { x: 2 } })).resolves.toMatchObject(
                {
                    x: 2,
                },
            );
        });
    });

    describe('Relation condition tests', () => {
        it('works with to-one relation check owner side', async () => {
            const db = await createPolicyTestClient(
                `
model User {
    id Int @id
    name String
    profile Profile?
    @@allow('all', true)
}

model Profile {
    id Int @id
    bio String
    user User @relation(fields: [userId], references: [id])
    userId Int @unique
    @@allow('create,read', true)
    @@allow('update', user.name == 'User2')
}
`,
            );

            await db.user.create({ data: { id: 1, name: 'User1', profile: { create: { id: 1, bio: 'Bio1' } } } });
            await expect(db.profile.update({ where: { id: 1 }, data: { bio: 'UpdatedBio1' } })).toBeRejectedNotFound();

            await db.user.create({ data: { id: 2, name: 'User2', profile: { create: { id: 2, bio: 'Bio2' } } } });
            await expect(db.profile.update({ where: { id: 2 }, data: { bio: 'UpdatedBio2' } })).resolves.toMatchObject({
                bio: 'UpdatedBio2',
            });
        });

        it('works with to-one relation check owner side', async () => {
            const db = await createPolicyTestClient(
                `
model User {
    id Int @id
    name String
    profile Profile @relation(fields: [profileId], references: [id])
    profileId Int @unique
    @@allow('all', true)
}

model Profile {
    id Int @id
    bio String
    user User?
    @@allow('create,read', true)
    @@allow('update', user.name == 'User2')
}
`,
            );

            await db.user.create({ data: { id: 1, name: 'User1', profile: { create: { id: 1, bio: 'Bio1' } } } });
            await expect(db.profile.update({ where: { id: 1 }, data: { bio: 'UpdatedBio1' } })).toBeRejectedNotFound();

            await db.user.create({ data: { id: 2, name: 'User2', profile: { create: { id: 2, bio: 'Bio2' } } } });
            await expect(db.profile.update({ where: { id: 2 }, data: { bio: 'UpdatedBio2' } })).resolves.toMatchObject({
                bio: 'UpdatedBio2',
            });
        });

        it('works with to-many relation check some', async () => {
            const db = await createPolicyTestClient(
                `
model User {
    id Int @id
    name String
    posts Post[]
    @@allow('create,read', true)
    @@allow('update', posts?[published])
}

model Post {
    id Int @id
    title String
    published Boolean
    author User @relation(fields: [authorId], references: [id])
    authorId Int
    @@allow('all', true)
}
`,
            );

            await db.user.create({ data: { id: 1, name: 'User1' } });
            await expect(db.user.update({ where: { id: 1 }, data: { name: 'UpdatedUser1' } })).toBeRejectedNotFound();

            await db.user.create({
                data: { id: 2, name: 'User2', posts: { create: { id: 1, title: 'Post1', published: false } } },
            });
            await expect(db.user.update({ where: { id: 2 }, data: { name: 'UpdatedUser2' } })).toBeRejectedNotFound();

            await db.user.create({
                data: {
                    id: 3,
                    name: 'User3',
                    posts: {
                        create: [
                            { id: 2, title: 'Post2', published: false },
                            { id: 3, title: 'Post3', published: true },
                        ],
                    },
                },
            });
            await expect(db.user.update({ where: { id: 3 }, data: { name: 'UpdatedUser3' } })).toResolveTruthy();
        });

        it('works with to-many relation check all', async () => {
            const db = await createPolicyTestClient(
                `
model User {
    id Int @id
    name String
    posts Post[]
    @@allow('create,read', true)
    @@allow('update', posts![published])
}

model Post {
    id Int @id
    title String
    published Boolean
    author User @relation(fields: [authorId], references: [id])
    authorId Int
    @@allow('all', true)
}
`,
            );

            await db.user.create({ data: { id: 1, name: 'User1' } });
            await expect(db.user.update({ where: { id: 1 }, data: { name: 'UpdatedUser1' } })).toResolveTruthy();

            await db.user.create({
                data: {
                    id: 2,
                    name: 'User2',
                    posts: {
                        create: [
                            { id: 1, title: 'Post1', published: false },
                            { id: 2, title: 'Post2', published: true },
                        ],
                    },
                },
            });
            await expect(db.user.update({ where: { id: 2 }, data: { name: 'UpdatedUser2' } })).toBeRejectedNotFound();

            await db.user.create({
                data: {
                    id: 3,
                    name: 'User3',
                    posts: {
                        create: [
                            { id: 3, title: 'Post3', published: true },
                            { id: 4, title: 'Post4', published: true },
                        ],
                    },
                },
            });
            await expect(db.user.update({ where: { id: 3 }, data: { name: 'UpdatedUser3' } })).toResolveTruthy();
        });

        it('works with to-many relation check none', async () => {
            const db = await createPolicyTestClient(
                `
model User {
    id Int @id
    name String
    posts Post[]
    @@allow('create,read', true)
    @@allow('update', posts^[published])
}

model Post {
    id Int @id
    title String
    published Boolean
    author User @relation(fields: [authorId], references: [id])
    authorId Int
    @@allow('all', true)
}
`,
            );

            await db.user.create({ data: { id: 1, name: 'User1' } });
            await expect(db.user.update({ where: { id: 1 }, data: { name: 'UpdatedUser1' } })).toResolveTruthy();

            await db.user.create({
                data: {
                    id: 2,
                    name: 'User2',
                    posts: {
                        create: [
                            { id: 1, title: 'Post1', published: false },
                            { id: 2, title: 'Post2', published: true },
                        ],
                    },
                },
            });
            await expect(db.user.update({ where: { id: 2 }, data: { name: 'UpdatedUser2' } })).toBeRejectedNotFound();

            await db.user.create({
                data: {
                    id: 3,
                    name: 'User3',
                    posts: {
                        create: [
                            { id: 3, title: 'Post3', published: false },
                            { id: 4, title: 'Post4', published: false },
                        ],
                    },
                },
            });
            await expect(db.user.update({ where: { id: 3 }, data: { name: 'UpdatedUser3' } })).toResolveTruthy();
        });
    });

    describe('Nested update tests', () => {
        it('works with nested update owner side', async () => {
            const db = await createPolicyTestClient(
                `
model User {
    id Int @id
    profile Profile?
    @@allow('all', true)
}

model Profile {
    id Int @id
    bio String
    private Boolean
    user User? @relation(fields: [userId], references: [id])
    userId Int? @unique
    @@allow('create,read', true)
    @@allow('update', !private)
}
`,
            );

            await db.user.create({ data: { id: 1, profile: { create: { id: 1, bio: 'Bio1', private: true } } } });
            await expect(
                db.user.update({
                    where: { id: 1 },
                    data: { profile: { update: { bio: 'UpdatedBio1' } } },
                }),
            ).toBeRejectedNotFound();

            await db.user.create({ data: { id: 2, profile: { create: { id: 2, bio: 'Bio2', private: false } } } });
            await expect(
                db.user.update({
                    where: { id: 2 },
                    data: { profile: { update: { bio: 'UpdatedBio2' } } },
                    include: { profile: true },
                }),
            ).resolves.toMatchObject({
                profile: {
                    bio: 'UpdatedBio2',
                },
            });
        });

        it('works with nested update non-owner side', async () => {
            const db = await createPolicyTestClient(
                `
model User {
    id Int @id
    profile Profile @relation(fields: [profileId], references: [id])
    profileId Int @unique
    @@allow('all', true)
}

model Profile {
    id Int @id
    bio String
    private Boolean
    user User?
    @@allow('create,read', true)
    @@allow('update', !private)
}
`,
            );

            await db.user.create({ data: { id: 1, profile: { create: { id: 1, bio: 'Bio1', private: true } } } });
            await expect(
                db.user.update({
                    where: { id: 1 },
                    data: { profile: { update: { bio: 'UpdatedBio1' } } },
                }),
            ).toBeRejectedNotFound();

            await db.user.create({ data: { id: 2, profile: { create: { id: 2, bio: 'Bio2', private: false } } } });
            await expect(
                db.user.update({
                    where: { id: 2 },
                    data: { profile: { update: { bio: 'UpdatedBio2' } } },
                    include: { profile: true },
                }),
            ).resolves.toMatchObject({
                profile: {
                    bio: 'UpdatedBio2',
                },
            });
        });
    });

    describe('Relation manipulation tests', () => {
        it('works with connect/disconnect/create owner side', async () => {
            const db = await createPolicyTestClient(
                `
model User {
    id Int @id
    profile Profile?
    @@allow('all', true)
}

model Profile {
    id Int @id
    private Boolean
    user User? @relation(fields: [userId], references: [id])
    userId Int? @unique
    @@allow('create,read', true)
    @@allow('update', !private)
}
`,
            );

            await db.user.create({ data: { id: 1 } });

            await db.profile.create({ data: { id: 1, private: true } });
            await expect(
                db.user.update({
                    where: { id: 1 },
                    data: { profile: { connect: { id: 1 } } },
                    include: { profile: true },
                }),
            ).toBeRejectedNotFound();

            await db.profile.create({ data: { id: 2, private: false } });
            await expect(
                db.user.update({
                    where: { id: 1 },
                    data: { profile: { connect: { id: 2 } } },
                    include: { profile: true },
                }),
            ).resolves.toMatchObject({
                profile: {
                    id: 2,
                },
            });
            await expect(
                db.user.update({
                    where: { id: 1 },
                    data: { profile: { disconnect: true } },
                    include: { profile: true },
                }),
            ).resolves.toMatchObject({
                profile: null,
            });
            // reconnect
            await db.user.update({ where: { id: 1 }, data: { profile: { connect: { id: 2 } } } });
            // set private
            await db.profile.update({ where: { id: 2 }, data: { private: true } });
            // disconnect should have no effect since update is not allowed
            await expect(
                db.user.update({
                    where: { id: 1 },
                    data: { profile: { disconnect: true } },
                    include: { profile: true },
                }),
            ).resolves.toMatchObject({ profile: { id: 2 } });

            await db.profile.create({ data: { id: 3, private: true } });
            await expect(
                db.profile.update({
                    where: { id: 3 },
                    data: { user: { create: { id: 2 } } },
                }),
            ).toBeRejectedNotFound();
        });

        it('works with connect/disconnect/create non-owner side', async () => {
            const db = await createPolicyTestClient(
                `
model User {
    id Int @id
    profile Profile? @relation(fields: [profileId], references: [id])
    profileId Int? @unique
    private Boolean
    @@allow('create,read', true)
    @@allow('update', !private)
}

model Profile {
    id Int @id
    user User?
    @@allow('all', true)
}
`,
            );

            await db.user.create({ data: { id: 1, private: true } });
            await db.profile.create({ data: { id: 1 } });
            await expect(
                db.user.update({
                    where: { id: 1 },
                    data: { profile: { connect: { id: 1 } } },
                    include: { profile: true },
                }),
            ).toBeRejectedNotFound();

            await db.user.create({ data: { id: 2, private: false } });
            await db.profile.create({ data: { id: 2 } });
            await expect(
                db.user.update({
                    where: { id: 2 },
                    data: { profile: { connect: { id: 2 } } },
                    include: { profile: true },
                }),
            ).resolves.toMatchObject({
                profile: {
                    id: 2,
                },
            });
            await expect(
                db.user.update({
                    where: { id: 2 },
                    data: { profile: { disconnect: true } },
                    include: { profile: true },
                }),
            ).resolves.toMatchObject({
                profile: null,
            });
            // reconnect
            await db.user.update({ where: { id: 2 }, data: { profile: { connect: { id: 2 } } } });
            // set private
            await db.user.update({ where: { id: 2 }, data: { private: true } });
            // disconnect should be rejected since update is not allowed
            await expect(
                db.user.update({
                    where: { id: 2 },
                    data: { profile: { disconnect: true } },
                    include: { profile: true },
                }),
            ).toBeRejectedNotFound();

            await db.profile.create({ data: { id: 3 } });
            await expect(
                db.profile.update({
                    where: { id: 3 },
                    data: { user: { create: { id: 3, private: true } } },
                }),
            ).toResolveTruthy();
        });
    });

    // describe('Upsert tests', () => {});

    // describe('Update many tests', () => {});
});
