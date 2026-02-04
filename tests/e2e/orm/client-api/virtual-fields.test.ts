import { createTestClient } from '@zenstackhq/testtools';
import { describe, expect, it } from 'vitest';

describe('Virtual fields tests', () => {
    it('works with sync virtual fields', async () => {
        const db = await createTestClient(
            `
model User {
    id Int @id @default(autoincrement())
    firstName String
    lastName String
    fullName String @virtual
}
`,
            {
                virtualFields: {
                    User: {
                        fullName: (row: any) => `${row.firstName} ${row.lastName}`,
                    },
                },
            } as any,
        );

        await expect(
            db.user.create({
                data: { id: 1, firstName: 'Alex', lastName: 'Smith' },
            }),
        ).resolves.toMatchObject({
            fullName: 'Alex Smith',
        });

        await expect(
            db.user.findUnique({
                where: { id: 1 },
            }),
        ).resolves.toMatchObject({
            fullName: 'Alex Smith',
        });

        await expect(
            db.user.findMany(),
        ).resolves.toEqual([
            expect.objectContaining({
                fullName: 'Alex Smith',
            }),
        ]);
    });

    it('works with async virtual fields', async () => {
        const db = await createTestClient(
            `
model Blob {
    id Int @id @default(autoincrement())
    blobName String
    sasUrl String @virtual
}
`,
            {
                virtualFields: {
                    Blob: {
                        sasUrl: async (row: any) => {
                            // Simulate async operation (e.g., generating SAS token)
                            await new Promise((resolve) => setTimeout(resolve, 10));
                            return `https://storage.example.com/${row.blobName}?sas=token123`;
                        },
                    },
                },
            } as any,
        );

        await expect(
            db.blob.create({
                data: { id: 1, blobName: 'my-file.pdf' },
            }),
        ).resolves.toMatchObject({
            sasUrl: 'https://storage.example.com/my-file.pdf?sas=token123',
        });
    });

    it('respects select clause - includes virtual field when selected', async () => {
        const db = await createTestClient(
            `
model User {
    id Int @id @default(autoincrement())
    firstName String
    lastName String
    fullName String @virtual
}
`,
            {
                virtualFields: {
                    User: {
                        fullName: (row: any) => `${row.firstName} ${row.lastName}`,
                    },
                },
            } as any,
        );

        await db.user.create({
            data: { id: 1, firstName: 'Alex', lastName: 'Smith' },
        });

        // When selecting the virtual field explicitly, it should be computed
        await expect(
            db.user.findUnique({
                where: { id: 1 },
                select: { id: true, fullName: true },
            }),
        ).resolves.toMatchObject({
            id: 1,
            fullName: 'Alex Smith',
        });
    });

    it('respects select clause - skips virtual field when not selected', async () => {
        let virtualFieldCalled = false;

        const db = await createTestClient(
            `
model User {
    id Int @id @default(autoincrement())
    firstName String
    lastName String
    fullName String @virtual
}
`,
            {
                virtualFields: {
                    User: {
                        fullName: (row: any) => {
                            virtualFieldCalled = true;
                            return `${row.firstName} ${row.lastName}`;
                        },
                    },
                },
            } as any,
        );

        await db.user.create({
            data: { id: 1, firstName: 'Alex', lastName: 'Smith' },
        });

        virtualFieldCalled = false;

        // When NOT selecting the virtual field, it should NOT be computed
        const result = await db.user.findUnique({
            where: { id: 1 },
            select: { id: true, firstName: true },
        });

        expect(result).toMatchObject({
            id: 1,
            firstName: 'Alex',
        });
        expect(result).not.toHaveProperty('fullName');
        expect(virtualFieldCalled).toBe(false);
    });

    it('works with optional virtual fields', async () => {
        const db = await createTestClient(
            `
model User {
    id Int @id @default(autoincrement())
    name String
    computedValue String? @virtual
}
`,
            {
                virtualFields: {
                    User: {
                        computedValue: () => null,
                    },
                },
            } as any,
        );

        await expect(
            db.user.create({
                data: { id: 1, name: 'Alex' },
            }),
        ).resolves.toMatchObject({
            computedValue: null,
        });
    });

    it('works with relations - virtual field in nested result', async () => {
        const db = await createTestClient(
            `
model User {
    id Int @id @default(autoincrement())
    name String
    displayName String @virtual
    posts Post[]
}

model Post {
    id Int @id @default(autoincrement())
    title String
    author User @relation(fields: [authorId], references: [id])
    authorId Int
}
`,
            {
                virtualFields: {
                    User: {
                        displayName: (row: any) => `@${row.name}`,
                    },
                },
            } as any,
        );

        await db.user.create({
            data: { id: 1, name: 'alex', posts: { create: { title: 'Post1' } } },
        });

        await expect(
            db.post.findFirst({
                include: { author: true },
            }),
        ).resolves.toMatchObject({
            author: expect.objectContaining({ displayName: '@alex' }),
        });
    });

    it('is typed correctly for non-optional fields', async () => {
        await createTestClient(
            `
model User {
    id Int @id @default(autoincrement())
    name String
    displayName String @virtual
}
`,
            {
                extraSourceFiles: {
                    main: `
import { ZenStackClient } from '@zenstackhq/orm';
import { schema } from './schema';

async function main() {
    const client = new ZenStackClient(schema, {
        dialect: {} as any,
        virtualFields: {
            User: {
                displayName: (row) => \`@\${row.name}\`,
            },
        }
    });

    const user = await client.user.create({
        data: { id: 1, name: 'Alex' }
    });
    console.log(user.displayName);
    // @ts-expect-error - virtual field should not be nullable
    user.displayName = null;
}

main();
`,
                },
            },
        );
    });

    it('virtual fields are excluded from where and orderBy types', async () => {
        await createTestClient(
            `
model Post {
    id Int @id @default(autoincrement())
    title String
    canEdit Boolean @virtual
}
`,
            {
                extraSourceFiles: {
                    main: `
import { ZenStackClient } from '@zenstackhq/orm';
import { schema } from './schema';

async function main() {
    const client = new ZenStackClient(schema, {
        dialect: {} as any,
        virtualFields: {
            Post: {
                canEdit: () => true,
            },
        }
    });

    // Virtual fields should be in the result type
    const post = await client.post.findFirst();
    const canEdit: boolean | undefined = post?.canEdit;

    // @ts-expect-error - virtual field should not be allowed in where
    await client.post.findMany({ where: { canEdit: true } });

    // @ts-expect-error - virtual field should not be allowed in orderBy
    await client.post.findMany({ orderBy: { canEdit: 'asc' } });

    // Regular fields should still work
    await client.post.findMany({ where: { title: 'test' } });
    await client.post.findMany({ orderBy: { title: 'asc' } });
}

main();
`,
                },
            },
        );
    });

    it('receives auth context in virtual field function', async () => {
        const db = await createTestClient(
            `
model User {
    id Int @id @default(autoincrement())
    name String
}

model Post {
    id Int @id @default(autoincrement())
    title String
    authorId Int
    canEdit Boolean @virtual
}
`,
            {
                virtualFields: {
                    Post: {
                        canEdit: (row: any, { auth }: any) => {
                            // User can edit if they are the author
                            return auth?.id === row.authorId;
                        },
                    },
                },
            } as any,
        );

        // Create a post
        await db.post.create({
            data: { id: 1, title: 'My Post', authorId: 1 },
        });

        // Without auth, canEdit should be false
        const postWithoutAuth = await db.post.findUnique({ where: { id: 1 } });
        expect(postWithoutAuth?.canEdit).toBe(false);

        // With auth as the author, canEdit should be true
        const dbWithAuth = db.$setAuth({ id: 1 });
        const postWithAuth = await dbWithAuth.post.findUnique({ where: { id: 1 } });
        expect(postWithAuth?.canEdit).toBe(true);

        // With auth as different user, canEdit should be false
        const dbWithOtherAuth = db.$setAuth({ id: 2 });
        const postWithOtherAuth = await dbWithOtherAuth.post.findUnique({ where: { id: 1 } });
        expect(postWithOtherAuth?.canEdit).toBe(false);
    });

    it('auth context works with nested relations', async () => {
        const db = await createTestClient(
            `
model User {
    id Int @id @default(autoincrement())
    name String
    posts Post[]
}

model Post {
    id Int @id @default(autoincrement())
    title String
    author User @relation(fields: [authorId], references: [id])
    authorId Int
    isOwnPost Boolean @virtual
}
`,
            {
                virtualFields: {
                    Post: {
                        isOwnPost: (row: any, { auth }: any) => auth?.id === row.authorId,
                    },
                },
            } as any,
        );

        await db.user.create({
            data: {
                id: 1,
                name: 'Alex',
                posts: { create: { id: 1, title: 'Post1' } },
            },
        });

        // Query posts through user relation with auth set
        const dbWithAuth = db.$setAuth({ id: 1 });
        const user = await dbWithAuth.user.findUnique({
            where: { id: 1 },
            include: { posts: true },
        });

        expect(user?.posts[0]?.isOwnPost).toBe(true);

        // With different auth
        const dbWithOtherAuth = db.$setAuth({ id: 2 });
        const userOther = await dbWithOtherAuth.user.findUnique({
            where: { id: 1 },
            include: { posts: true },
        });

        expect(userOther?.posts[0]?.isOwnPost).toBe(false);
    });

    it('works with relations and virtual fields on PostgreSQL (lateral join dialect)', async () => {
        // This test specifically targets the lateral join dialect used by PostgreSQL
        // to ensure virtual fields are properly excluded from SQL queries when
        // including relations with default select (no explicit select clause)
        const db = await createTestClient(
            `
model User {
    id Int @id @default(autoincrement())
    name String
    displayName String @virtual
    posts Post[]
}

model Post {
    id Int @id @default(autoincrement())
    title String
    author User @relation(fields: [authorId], references: [id])
    authorId Int
}
`,
            {
                provider: 'postgresql',
                virtualFields: {
                    User: {
                        displayName: (row: any) => `@${row.name}`,
                    },
                },
            } as any,
        );

        await db.user.create({
            data: { id: 1, name: 'alex', posts: { create: { title: 'Post1' } } },
        });

        // Include relation with default select - this triggers buildRelationObjectArgs
        // in the lateral join dialect which must properly exclude virtual fields
        await expect(
            db.post.findFirst({
                include: { author: true },
            }),
        ).resolves.toMatchObject({
            title: 'Post1',
            author: expect.objectContaining({
                name: 'alex',
                displayName: '@alex',
            }),
        });
    });

    it('works with virtual fields in delegate sub-models', async () => {
        // This test ensures virtual fields are properly excluded when building
        // delegate descendant JSON objects in buildSelectAllFields
        const db = await createTestClient(
            `
model Content {
    id Int @id @default(autoincrement())
    title String
    contentType String
    @@delegate(contentType)
}

model Post extends Content {
    body String
    preview String @virtual
}
`,
            {
                virtualFields: {
                    Post: {
                        preview: (row: any) => row.body?.substring(0, 50) ?? '',
                    },
                },
            } as any,
        );

        await db.post.create({
            data: { id: 1, title: 'My Post', body: 'This is the full body content of the post' },
        });

        // Query the base Content model - this triggers buildSelectAllFields which
        // builds JSON for delegate descendants (Post) and must exclude virtual fields
        await expect(
            db.content.findFirst({
                where: { id: 1 },
            }),
        ).resolves.toMatchObject({
            title: 'My Post',
            body: 'This is the full body content of the post',
            preview: 'This is the full body content of the post',
        });
    });
});
