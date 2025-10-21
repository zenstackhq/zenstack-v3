import { createTestClient } from '@zenstackhq/testtools';
import { describe, expect, it } from 'vitest';

describe('Computed fields tests', () => {
    it('works with non-optional fields', async () => {
        const db = await createTestClient(
            `
model User {
    id Int @id @default(autoincrement())
    name String
    upperName String @computed
}
`,
            {
                computedFields: {
                    User: {
                        upperName: (eb: any) => eb.fn('upper', ['name']),
                    },
                },
            } as any,
        );

        await expect(
            db.user.create({
                data: { id: 1, name: 'Alex' },
            }),
        ).resolves.toMatchObject({
            upperName: 'ALEX',
        });

        await expect(
            db.user.findUnique({
                where: { id: 1 },
                select: { upperName: true },
            }),
        ).resolves.toMatchObject({
            upperName: 'ALEX',
        });

        await expect(
            db.user.findFirst({
                where: { upperName: 'ALEX' },
            }),
        ).resolves.toMatchObject({
            upperName: 'ALEX',
        });

        await expect(
            db.user.findFirst({
                where: { upperName: 'Alex' },
            }),
        ).toResolveNull();

        await expect(
            db.user.findFirst({
                orderBy: { upperName: 'desc' },
            }),
        ).resolves.toMatchObject({
            upperName: 'ALEX',
        });

        await expect(
            db.user.findFirst({
                orderBy: { upperName: 'desc' },
                take: 1,
            }),
        ).resolves.toMatchObject({
            upperName: 'ALEX',
        });

        await expect(
            db.user.aggregate({
                _count: { upperName: true },
            }),
        ).resolves.toMatchObject({
            _count: { upperName: 1 },
        });

        await expect(
            db.user.groupBy({
                by: ['upperName'],
                _count: { upperName: true },
                _max: { upperName: true },
            }),
        ).resolves.toEqual([
            expect.objectContaining({
                _count: { upperName: 1 },
                _max: { upperName: 'ALEX' },
            }),
        ]);
    });

    it('is typed correctly for non-optional fields', async () => {
        await createTestClient(
            `
model User {
    id Int @id @default(autoincrement())
    name String
    upperName String @computed
}
`,
            {
                extraSourceFiles: {
                    main: `
import { ZenStackClient } from '@zenstackhq/runtime';
import { schema } from './schema';

async function main() {
    const client = new ZenStackClient(schema, {
        dialect: {} as any,
        computedFields: {
            User: {
                upperName: (eb) => eb.fn('upper', ['name']),
            },
        }
    });

    const user = await client.user.create({
        data: { id: 1, name: 'Alex' }
    });
    console.log(user.upperName);
    // @ts-expect-error
    user.upperName = null;
}

main();
`,
                },
            },
        );
    });

    it('works with optional fields', async () => {
        const db = await createTestClient(
            `
model User {
    id Int @id @default(autoincrement())
    name String
    upperName String? @computed
}
`,
            {
                computedFields: {
                    User: {
                        upperName: (eb: any) => eb.lit(null),
                    },
                },
            } as any,
        );

        await expect(
            db.user.create({
                data: { id: 1, name: 'Alex' },
            }),
        ).resolves.toMatchObject({
            upperName: null,
        });
    });

    it('is typed correctly for optional fields', async () => {
        await createTestClient(
            `
model User {
    id Int @id @default(autoincrement())
    name String
    upperName String? @computed
}
`,
            {
                extraSourceFiles: {
                    main: `
import { ZenStackClient } from '@zenstackhq/runtime';
import { schema } from './schema';

async function main() {
    const client = new ZenStackClient(schema, {
        dialect: {} as any,
        computedFields: {
            User: {
                upperName: (eb) => eb.lit(null),
            },
        }
    });

    const user = await client.user.create({
        data: { id: 1, name: 'Alex' }
    });
    console.log(user.upperName);
    user.upperName = null;
}

main();
`,
                },
            },
        );
    });

    it('works with read from a relation', async () => {
        const db = await createTestClient(
            `
model User {
    id Int @id @default(autoincrement())
    name String
    posts Post[]
    postCount Int @computed
}

model Post {
    id Int @id @default(autoincrement())
    title String
    author User @relation(fields: [authorId], references: [id])
    authorId Int
}
`,
            {
                computedFields: {
                    User: {
                        postCount: (eb: any, context: { modelAlias: string }) =>
                            eb
                                .selectFrom('Post')
                                .whereRef('Post.authorId', '=', eb.ref(`${context.modelAlias}.id`))
                                .select(() => eb.fn.countAll().as('count')),
                    },
                },
            } as any,
        );

        await db.user.create({
            data: { id: 1, name: 'Alex', posts: { create: { title: 'Post1' } } },
        });

        await expect(db.post.findFirst({ select: { id: true, author: true } })).resolves.toMatchObject({
            author: expect.objectContaining({ postCount: 1 }),
        });
    });

    it('allows sub models to use computed fields from delegate base', async () => {
        const db = await createTestClient(
            `
model Content {
    id Int @id @default(autoincrement())
    title String
    isNews Boolean @computed
    contentType String
    @@delegate(contentType)
}

model Post extends Content {
    body String
}
`,
            {
                computedFields: {
                    Content: {
                        isNews: (eb: any) => eb('title', 'like', '%news%'),
                    },
                },
            } as any,
        );

        const posts = await db.post.createManyAndReturn({
            data: [
                { id: 1, title: 'latest news', body: 'some news content' },
                { id: 2, title: 'random post', body: 'some other content' },
            ],
        });
        expect(posts).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ id: 1, isNews: true }),
                expect.objectContaining({ id: 2, isNews: false }),
            ]),
        );
    });
});
