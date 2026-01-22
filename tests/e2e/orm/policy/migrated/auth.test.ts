import { describe, expect, it } from 'vitest';
import { createPolicyTestClient } from '@zenstackhq/testtools';

describe('auth() tests', () => {
    it('works with string id non-null test', async () => {
        const db = await createPolicyTestClient(
            `
 model User {
    id String @id @default(uuid())
}

model Post {
    id String @id @default(uuid())
    title String

    @@allow('read', true)
    @@allow('create', auth() != null)
}
`,
        );

        await expect(db.post.create({ data: { title: 'abc' } })).toBeRejectedByPolicy();

        const authDb = db.$setAuth({ id: 'user1' });
        await expect(authDb.post.create({ data: { title: 'abc' } })).toResolveTruthy();
    });

    it('works with string id id test', async () => {
        const db = await createPolicyTestClient(
            `
        model User {
            id String @id @default(uuid())
        }

        model Post {
            id String @id @default(uuid())
            title String

            @@allow('read', true)
            @@allow('create', auth().id != null)
        }
        `,
        );

        await expect(db.post.create({ data: { title: 'abc' } })).toBeRejectedByPolicy();

        const authDb = db.$setAuth({ id: 'user1' });
        await expect(authDb.post.create({ data: { title: 'abc' } })).toResolveTruthy();
    });

    it('works with int id', async () => {
        const db = await createPolicyTestClient(
            `
        model User {
            id Int @id @default(autoincrement())
        }

        model Post {
            id String @id @default(uuid())
            title String

            @@allow('read', true)
            @@allow('create', auth() != null)
        }
        `,
        );

        await expect(db.post.create({ data: { title: 'abc' } })).toBeRejectedByPolicy();

        const authDb = db.$setAuth({ id: 'user1' });
        await expect(authDb.post.create({ data: { title: 'abc' } })).toResolveTruthy();
    });

    it('works with field comparison', async () => {
        const db = await createPolicyTestClient(
            `
        model User {
            id String @id @default(uuid())
            posts Post[]

            @@allow('all', true)
        }

        model Post {
            id String @id @default(uuid())
            title String
            author User @relation(fields: [authorId], references: [id])
            authorId String

            @@allow('create,read', true)
            @@allow('update', auth().id == author.id)
        }
        `,
        );

        await expect(db.user.create({ data: { id: 'user1' } })).toResolveTruthy();
        await expect(
            db.post.create({
                data: { id: '1', title: 'abc', authorId: 'user1' },
            }),
        ).toResolveTruthy();

        await expect(db.post.update({ where: { id: '1' }, data: { title: 'bcd' } })).toBeRejectedNotFound();

        const authDb2 = db.$setAuth({ id: 'user1' });
        await expect(authDb2.post.update({ where: { id: '1' }, data: { title: 'bcd' } })).toResolveTruthy();
    });

    it('works with undefined user non-id field', async () => {
        const db = await createPolicyTestClient(
            `
        model User {
            id String @id @default(uuid())
            posts Post[]
            role String

            @@allow('all', true)
        }

        model Post {
            id String @id @default(uuid())
            title String
            author User @relation(fields: [authorId], references: [id])
            authorId String

            @@allow('create,read', true)
            @@allow('update', auth().role == 'ADMIN')
        }
        `,
        );

        await expect(db.user.create({ data: { id: 'user1', role: 'USER' } })).toResolveTruthy();
        await expect(
            db.post.create({
                data: { id: '1', title: 'abc', authorId: 'user1' },
            }),
        ).toResolveTruthy();
        await expect(db.post.update({ where: { id: '1' }, data: { title: 'bcd' } })).toBeRejectedNotFound();

        const authDb = db.$setAuth({ id: 'user1', role: 'USER' });
        await expect(authDb.post.update({ where: { id: '1' }, data: { title: 'bcd' } })).toBeRejectedNotFound();

        const authDb1 = db.$setAuth({ id: 'user2', role: 'ADMIN' });
        await expect(authDb1.post.update({ where: { id: '1' }, data: { title: 'bcd' } })).toResolveTruthy();
    });

    it('works with non User auth model', async () => {
        const db = await createPolicyTestClient(
            `
        model Foo {
            id String @id @default(uuid())
            role String

            @@auth()
        }

        model Post {
            id String @id @default(uuid())
            title String

            @@allow('read', true)
            @@allow('create', auth().role == 'ADMIN')
        }
        `,
        );

        const userDb = db.$setAuth({ id: 'user1', role: 'USER' });
        await expect(userDb.post.create({ data: { title: 'abc' } })).toBeRejectedByPolicy();

        const adminDb = db.$setAuth({ id: 'user1', role: 'ADMIN' });
        await expect(adminDb.post.create({ data: { title: 'abc' } })).toResolveTruthy();
    });

    it('works with collection predicate', async () => {
        const db = await createPolicyTestClient(
            `
        model User {
            id String @id @default(uuid())
            posts Post[]

            @@allow('all', true)
        }

        model Post {
            id String @id @default(uuid())
            title String
            published Boolean @default(false)
            author User @relation(fields: [authorId], references: [id])
            authorId String
            comments Comment[]

            @@allow('read', true)
            @@allow('create', auth().posts?[published && comments![published]])
        }

        model Comment {
            id String @id @default(uuid())
            published Boolean @default(false)
            post Post @relation(fields: [postId], references: [id])
            postId String

            @@allow('all', true)
        }
        `,
        );

        const rawDb = db.$unuseAll();

        const user = await rawDb.user.create({ data: {} });

        const createPayload = {
            data: { title: 'Post 1', author: { connect: { id: user.id } } },
        };

        // no post
        await expect(db.$setAuth({ id: '1' }).post.create(createPayload)).toBeRejectedByPolicy();

        // post not published
        await expect(
            db
                .$setAuth({
                    id: '1',
                    posts: [{ id: '1', published: false }],
                })
                .post.create(createPayload),
        ).toBeRejectedByPolicy();

        // no comments
        await expect(
            db
                .$setAuth({
                    id: '1',
                    posts: [{ id: '1', published: true }],
                })
                .post.create(createPayload),
        ).toBeRejectedByPolicy();

        // not all comments published
        await expect(
            db
                .$setAuth({
                    id: '1',
                    posts: [
                        {
                            id: '1',
                            published: true,
                            comments: [
                                { id: '1', published: true },
                                { id: '2', published: false },
                            ],
                        },
                    ],
                })
                .post.create(createPayload),
        ).toBeRejectedByPolicy();

        // comments published but parent post is not
        await expect(
            db
                .$setAuth({
                    id: '1',
                    posts: [
                        {
                            id: '1',
                            published: false,
                            comments: [{ id: '1', published: true }],
                        },
                        { id: '2', published: true },
                    ],
                })
                .post.create(createPayload),
        ).toBeRejectedByPolicy();

        await expect(
            db
                .$setAuth({
                    id: '1',
                    posts: [
                        {
                            id: '1',
                            published: true,
                            comments: [{ id: '1', published: true }],
                        },
                        { id: '2', published: false },
                    ],
                })
                .post.create(createPayload),
        ).toResolveTruthy();

        // no comments ("every" evaluates to true in this case)
        await expect(
            db
                .$setAuth({
                    id: '1',
                    posts: [{ id: '1', published: true, comments: [] }],
                })
                .post.create(createPayload),
        ).toResolveTruthy();
    });

    it('works with using auth value as default for literal fields', async () => {
        const db = await createPolicyTestClient(
            `
        model User {
            id String @id
            name String
            score Int

        }

        model Post {
            id String @id @default(uuid())
            title String
            score Int? @default(auth().score)
            authorName String? @default(auth().name)

            @@allow('all', true)
        }
        `,
        );

        const userDb = db.$setAuth({ id: '1', name: 'user1', score: 10 });
        await expect(userDb.post.create({ data: { title: 'abc' } })).toResolveTruthy();
        await expect(userDb.post.findMany()).resolves.toHaveLength(1);
        await expect(userDb.post.count({ where: { authorName: 'user1', score: 10 } })).resolves.toBe(1);

        await expect(userDb.post.createMany({ data: [{ title: 'def' }] })).resolves.toMatchObject({ count: 1 });

        if (userDb.$schema.provider.type !== 'mysql') {
            const r = await userDb.post.createManyAndReturn({
                data: [{ title: 'xxx' }, { title: 'yyy' }],
            });
            expect(r).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ title: 'xxx', score: 10 }),
                    expect.objectContaining({ title: 'yyy', score: 10 }),
                ]),
            );
        }
    });

    it('respects explicitly passed field values even when default is set', async () => {
        const db = await createPolicyTestClient(
            `
        model User {
            id String @id
            name String

        }

        model Post {
            id String @id @default(uuid())
            authorName String? @default(auth().name)

            @@allow('all', true)
        }
        `,
        );

        const userContextName = 'user1';
        const overrideName = 'no-default-auth-name';
        const userDb = db.$setAuth({ id: '1', name: userContextName });
        await expect(userDb.post.create({ data: { authorName: overrideName } })).toResolveTruthy();
        await expect(userDb.post.count({ where: { authorName: overrideName } })).resolves.toBe(1);

        await expect(userDb.post.createMany({ data: [{ authorName: overrideName }] })).toResolveTruthy();
        await expect(userDb.post.count({ where: { authorName: overrideName } })).resolves.toBe(2);

        if (userDb.$schema.provider.type !== 'mysql') {
            const r = await userDb.post.createManyAndReturn({
                data: [{ authorName: overrideName }],
            });
            expect(r[0]).toMatchObject({ authorName: overrideName });
        }
    });

    it('works with using auth value as default for foreign key', async () => {
        const anonDb = await createPolicyTestClient(
            `
        model User {
            id String @id
            email String @unique
            posts Post[]

            @@allow('all', true)

        }

        model Post {
            id String @id @default(uuid())
            title String
            author User @relation(fields: [authorId], references: [id])
            authorId String @default(auth().id)

            @@allow('all', true)
        }
        `,
        );

        const rawDb = anonDb.$unuseAll();
        await rawDb.user.create({
            data: { id: 'userId-1', email: 'user1@abc.com' },
        });
        await rawDb.user.create({
            data: { id: 'userId-2', email: 'user2@abc.com' },
        });

        const db = anonDb.$setAuth({ id: 'userId-1' });

        // default auth effective
        await expect(db.post.create({ data: { title: 'post1' } })).resolves.toMatchObject({ authorId: 'userId-1' });

        // default auth ineffective due to explicit connect
        await expect(
            db.post.create({
                data: {
                    title: 'post2',
                    author: { connect: { email: 'user1@abc.com' } },
                },
            }),
        ).resolves.toMatchObject({ authorId: 'userId-1' });

        // default auth ineffective due to explicit connect
        await expect(
            db.post.create({
                data: {
                    title: 'post3',
                    author: { connect: { email: 'user2@abc.com' } },
                },
            }),
        ).resolves.toMatchObject({ authorId: 'userId-2' });

        // TODO: upsert
        // await expect(
        //     db.post.upsert({
        //         where: { id: 'post4' },
        //         create: { id: 'post4', title: 'post4' },
        //         update: { title: 'post4' },
        //     })
        // ).resolves.toMatchObject({ authorId: 'userId-1' });

        // default auth effective for createMany
        await expect(db.post.createMany({ data: { title: 'post5' } })).resolves.toMatchObject({ count: 1 });
        const r = await db.post.findFirst({ where: { title: 'post5' } });
        expect(r).toMatchObject({ authorId: 'userId-1' });

        if (db.$schema.provider.type !== 'mysql') {
            // default auth effective for createManyAndReturn
            const r1 = await db.post.createManyAndReturn({
                data: { title: 'post6' },
            });
            expect(r1[0]).toMatchObject({ authorId: 'userId-1' });
        }
    });

    it('works with using nested auth value as default', async () => {
        const anonDb = await createPolicyTestClient(
            `
        model User {
            id String @id
            profile Profile?
            posts Post[]

            @@allow('all', true)
        }

        model Profile {
            id String @id @default(uuid())
            image Image?
            user User @relation(fields: [userId], references: [id])
            userId String @unique
        }

        model Image {
            id String @id @default(uuid())
            url String
            profile Profile @relation(fields: [profileId], references: [id])
            profileId String @unique
        }

        model Post {
            id String @id @default(uuid())
            title String
            defaultImageUrl String @default(auth().profile.image.url)
            author User @relation(fields: [authorId], references: [id])
            authorId String

            @@allow('all', true)
        }
        `,
        );
        const url = 'https://zenstack.dev';
        const db = anonDb.$setAuth({
            id: 'userId-1',
            profile: { image: { url } },
        });

        // top-level create
        await expect(db.user.create({ data: { id: 'userId-1' } })).toResolveTruthy();
        await expect(
            db.post.create({
                data: { title: 'abc', author: { connect: { id: 'userId-1' } } },
            }),
        ).resolves.toMatchObject({ defaultImageUrl: url });

        // nested create
        const result = await db.user.create({
            data: {
                id: 'userId-2',
                posts: {
                    create: [{ title: 'p1' }, { title: 'p2' }],
                },
            },
            include: { posts: true },
        });
        expect(result.posts).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ title: 'p1', defaultImageUrl: url }),
                expect.objectContaining({ title: 'p2', defaultImageUrl: url }),
            ]),
        );
    });

    it('works with using auth value as default with anonymous context', async () => {
        const db = await createPolicyTestClient(
            `
        model User {
            id String @id
            posts Post[]

            @@allow('all', true)
        }

        model Post {
            id String @id @default(uuid())
            title String
            author User @relation(fields: [authorId], references: [id])
            authorId String @default(auth().id)

            @@allow('all', true)
        }
        `,
        );

        await expect(db.user.create({ data: { id: 'userId-1' } })).toResolveTruthy();
        await expect(db.post.create({ data: { title: 'title' } })).rejects.toSatisfy((e) =>
            e.cause.message.toLowerCase().match(/(constraint)|(cannot be null)/),
        );
        await expect(db.post.findMany({})).toResolveTruthy();
    });

    it('works with using auth value as default in mixed checked and unchecked context', async () => {
        const anonDb = await createPolicyTestClient(
            `
        model User {
            id String @id
            posts Post[]

            @@allow('all', true)
        }

        model Post {
            id String @id @default(uuid())
            title String
            author User @relation(fields: [authorId], references: [id])
            authorId String @default(auth().id)

            stats Stats  @relation(fields: [statsId], references: [id])
            statsId String @unique

            @@allow('all', true)
        }

        model Stats {
            id String @id @default(uuid())
            viewCount Int @default(0)
            post Post?

            @@allow('all', true)
        }
        `,
        );

        const db = anonDb.$setAuth({ id: 'userId-1' });
        await db.user.create({ data: { id: 'userId-1' } });

        // unchecked context
        await db.stats.create({ data: { id: 'stats-1', viewCount: 10 } });
        await expect(db.post.create({ data: { title: 'title1', statsId: 'stats-1' } })).toResolveTruthy();

        await db.stats.create({ data: { id: 'stats-2', viewCount: 10 } });
        await expect(
            db.post.createMany({
                data: [{ title: 'title2', statsId: 'stats-2' }],
            }),
        ).resolves.toMatchObject({
            count: 1,
        });

        await db.stats.create({ data: { id: 'stats-3', viewCount: 10 } });

        if (db.$schema.provider.type !== 'mysql') {
            const r = await db.post.createManyAndReturn({
                data: [{ title: 'title3', statsId: 'stats-3' }],
            });
            expect(r[0]).toMatchObject({ statsId: 'stats-3' });
        }

        // checked context
        await db.stats.create({ data: { id: 'stats-4', viewCount: 10 } });
        await expect(
            db.post.create({
                data: {
                    title: 'title4',
                    stats: { connect: { id: 'stats-4' } },
                },
            }),
        ).toResolveTruthy();
    });
});
