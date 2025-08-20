import { sql } from 'kysely';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestClient } from '../utils';

const TEST_DB = 'client-api-computed-fields';

describe.each([{ provider: 'sqlite' as const }, { provider: 'postgresql' as const }])(
    'Computed fields tests',
    ({ provider }) => {
        let db: any;

        afterEach(async () => {
            await db?.$disconnect();
        });

        it('works with non-optional fields', async () => {
            db = await createTestClient(
                `
model User {
    id Int @id @default(autoincrement())
    name String
    upperName String @computed
}
`,
                {
                    provider,
                    dbName: TEST_DB,
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
                    take: -1,
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
            db = await createTestClient(
                `
model User {
    id Int @id @default(autoincrement())
    name String
    upperName String @computed
}
`,
                {
                    provider,
                    dbName: TEST_DB,
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
            db = await createTestClient(
                `
model User {
    id Int @id @default(autoincrement())
    name String
    upperName String? @computed
}
`,
                {
                    provider,
                    dbName: TEST_DB,
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
            db = await createTestClient(
                `
model User {
    id Int @id @default(autoincrement())
    name String
    upperName String? @computed
}
`,
                {
                    provider,
                    dbName: TEST_DB,
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
            db = await createTestClient(
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
                    provider,
                    dbName: TEST_DB,
                    computedFields: {
                        User: {
                            postCount: (eb: any, context: { currentModel: string }) =>
                                eb
                                    .selectFrom('Post')
                                    .whereRef('Post.authorId', '=', sql.ref(`${context.currentModel}.id`))
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
    },
);
