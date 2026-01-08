import { createPolicyTestClient } from '@zenstackhq/testtools';
import { describe, expect, it } from 'vitest';

describe('field-level policy tests', () => {
    describe('mixin tests', () => {
        it('inherits field-level policies from mixins', async () => {
            const db = await createPolicyTestClient(
                `
        type Auth {
            id Int
            admin Boolean
            role String
            @@auth
        }

        type SecureFields {
            secretData String @allow('read', auth().admin) @allow('update', auth().admin)
            publicData String
        }

        type AuditFields {
            createdAt DateTime @default(now())
            createdBy String @allow('read', auth() != null) @deny('update', true)
        }

        model User {
            id Int @id @default(autoincrement())
            document Document?

            @@allow('all', true)
        }

        model Document with SecureFields AuditFields {
            id Int @id @default(autoincrement())
            title String
            owner User? @relation(fields: [ownerId], references: [id])
            ownerId Int? @unique

            @@allow('all', true)
        }

        model Report with SecureFields {
            id Int @id @default(autoincrement())
            name String
            sensitiveInfo String @allow('read', auth().role == 'MANAGER') @allow('update', auth().role == 'MANAGER')

            @@allow('all', true)
        }
        `,
            );

            // Create test data without policies
            await db.user.create({ data: { id: 1 } });
            await db.user.create({ data: { id: 2 } });
            await db.user.create({ data: { id: 3 } });

            await db.$unuseAll().document.create({
                data: {
                    id: 1,
                    title: 'Doc 1',
                    secretData: 'SECRET',
                    publicData: 'PUBLIC',
                    createdBy: 'user1',
                    ownerId: 1,
                },
            });

            await db.$unuseAll().report.create({
                data: {
                    id: 1,
                    name: 'Report 1',
                    secretData: 'REPORT_SECRET',
                    publicData: 'REPORT_PUBLIC',
                    sensitiveInfo: 'SENSITIVE',
                },
            });

            let r;

            // Test with anonymous user (no auth)
            const anonDb = db;

            r = await anonDb.document.findUnique({ where: { id: 1 } });
            expect(r.secretData).toBeNull(); // inherited from SecureFields mixin
            expect(r.publicData).toEqual('PUBLIC');
            expect(r.createdBy).toBeNull(); // inherited from AuditFields mixin
            expect(r.title).toEqual('Doc 1');

            r = await anonDb.report.findUnique({ where: { id: 1 } });
            expect(r.secretData).toBeNull(); // inherited from SecureFields mixin
            expect(r.publicData).toEqual('REPORT_PUBLIC');
            expect(r.sensitiveInfo).toBeNull(); // Report's own field policy

            // Test with regular authenticated user
            const userDb = db.$setAuth({ id: 1, admin: false, role: 'USER' });

            r = await userDb.document.findUnique({ where: { id: 1 } });
            expect(r.secretData).toBeNull(); // not admin
            expect(r.publicData).toEqual('PUBLIC');
            expect(r.createdBy).toEqual('user1'); // authenticated
            expect(r.title).toEqual('Doc 1');

            r = await userDb.report.findUnique({ where: { id: 1 } });
            expect(r.secretData).toBeNull(); // not admin
            expect(r.publicData).toEqual('REPORT_PUBLIC');
            expect(r.sensitiveInfo).toBeNull(); // not MANAGER

            // Test with admin user
            const adminDb = db.$setAuth({ id: 2, admin: true, role: 'ADMIN' });

            r = await adminDb.document.findUnique({ where: { id: 1 } });
            expect(r.secretData).toEqual('SECRET'); // admin can read
            expect(r.publicData).toEqual('PUBLIC');
            expect(r.createdBy).toEqual('user1');
            expect(r.title).toEqual('Doc 1');

            r = await adminDb.report.findUnique({ where: { id: 1 } });
            expect(r.secretData).toEqual('REPORT_SECRET'); // admin can read
            expect(r.publicData).toEqual('REPORT_PUBLIC');
            expect(r.sensitiveInfo).toBeNull(); // not MANAGER

            // Test with manager user
            const managerDb = db.$setAuth({ id: 3, admin: false, role: 'MANAGER' });

            r = await managerDb.report.findUnique({ where: { id: 1 } });
            expect(r.secretData).toBeNull(); // not admin
            expect(r.publicData).toEqual('REPORT_PUBLIC');
            expect(r.sensitiveInfo).toEqual('SENSITIVE'); // MANAGER can read

            // Test with select queries
            r = await anonDb.document.findUnique({
                where: { id: 1 },
                select: { secretData: true, publicData: true, createdBy: true },
            });
            expect(r.secretData).toBeNull();
            expect(r.publicData).toEqual('PUBLIC');
            expect(r.createdBy).toBeNull();

            r = await adminDb.document.findUnique({
                where: { id: 1 },
                select: { secretData: true, publicData: true, createdBy: true },
            });
            expect(r.secretData).toEqual('SECRET');
            expect(r.publicData).toEqual('PUBLIC');
            expect(r.createdBy).toEqual('user1');

            // Test with query builder
            await expect(
                anonDb.$qb.selectFrom('Document').selectAll().where('id', '=', 1).executeTakeFirst(),
            ).resolves.toMatchObject({
                id: 1,
                title: 'Doc 1',
                secretData: null,
                publicData: 'PUBLIC',
                createdBy: null,
            });

            await expect(
                adminDb.$qb.selectFrom('Document').selectAll().where('id', '=', 1).executeTakeFirst(),
            ).resolves.toMatchObject({
                id: 1,
                title: 'Doc 1',
                secretData: 'SECRET',
                publicData: 'PUBLIC',
                createdBy: 'user1',
            });

            // Test create operations with read-back
            r = await anonDb.document.create({
                data: {
                    id: 2,
                    title: 'Doc 2',
                    secretData: 'SECRET2',
                    publicData: 'PUBLIC2',
                    createdBy: 'user2',
                    ownerId: 2,
                },
            });
            expect(r.secretData).toBeNull(); // created but can't read back
            expect(r.createdBy).toBeNull();
            expect(r.publicData).toEqual('PUBLIC2');

            r = await adminDb.document.create({
                data: {
                    id: 3,
                    title: 'Doc 3',
                    secretData: 'SECRET3',
                    publicData: 'PUBLIC3',
                    createdBy: 'user3',
                    ownerId: 3,
                },
            });
            expect(r.secretData).toEqual('SECRET3'); // admin can read back
            expect(r.createdBy).toEqual('user3');
            expect(r.publicData).toEqual('PUBLIC3');

            // Test update operations with inherited field-level policies

            // Non-admin cannot update secretData (inherited from SecureFields mixin)
            await expect(
                userDb.document.update({
                    where: { id: 1 },
                    data: { secretData: 'UPDATED_SECRET' },
                }),
            ).toBeRejectedByPolicy();

            // Non-admin can update publicData (no restrictions)
            await expect(
                userDb.document.update({
                    where: { id: 1 },
                    data: { publicData: 'UPDATED_PUBLIC' },
                }),
            ).toResolveTruthy();

            // No one can update createdBy (deny policy from AuditFields mixin)
            await expect(
                adminDb.document.update({
                    where: { id: 1 },
                    data: { createdBy: 'UPDATED_USER' },
                }),
            ).toBeRejectedByPolicy();

            // Admin can update secretData (inherited policy from SecureFields mixin)
            r = await adminDb.document.update({
                where: { id: 1 },
                data: { secretData: 'ADMIN_UPDATED_SECRET' },
            });
            expect(r.secretData).toEqual('ADMIN_UPDATED_SECRET');
            expect(r.publicData).toEqual('UPDATED_PUBLIC'); // from previous update

            // Verify that updating only allowed fields works
            await expect(
                userDb.document.update({
                    where: { id: 1 },
                    data: { title: 'Updated Title' },
                }),
            ).toResolveTruthy();

            // Test with Report model - combine inherited and model-specific update policies
            await db.$unuseAll().report.update({
                where: { id: 1 },
                data: { sensitiveInfo: 'ORIGINAL_SENSITIVE' },
            });

            // Non-manager cannot update sensitiveInfo (model-specific policy)
            await expect(
                userDb.report.update({
                    where: { id: 1 },
                    data: { sensitiveInfo: 'UPDATED_SENSITIVE' },
                }),
            ).toBeRejectedByPolicy();

            // Non-admin cannot update secretData (inherited policy)
            await expect(
                managerDb.report.update({
                    where: { id: 1 },
                    data: { secretData: 'MANAGER_UPDATED_SECRET' },
                }),
            ).toBeRejectedByPolicy();

            // Manager can update sensitiveInfo but not secretData
            await expect(
                managerDb.report.update({
                    where: { id: 1 },
                    data: { sensitiveInfo: 'MANAGER_UPDATED_SENSITIVE' },
                }),
            ).toResolveTruthy();

            // Admin can update secretData but not sensitiveInfo (not MANAGER)
            r = await adminDb.report.update({
                where: { id: 1 },
                data: { secretData: 'ADMIN_UPDATED_REPORT_SECRET' },
            });
            expect(r.secretData).toEqual('ADMIN_UPDATED_REPORT_SECRET');

            // Trying to update both secretData and sensitiveInfo requires both permissions
            await expect(
                managerDb.report.update({
                    where: { id: 1 },
                    data: { secretData: 'SECRET', sensitiveInfo: 'SENSITIVE' },
                }),
            ).toBeRejectedByPolicy(); // manager doesn't have permission for secretData

            await expect(
                adminDb.report.update({
                    where: { id: 1 },
                    data: { secretData: 'SECRET', sensitiveInfo: 'SENSITIVE' },
                }),
            ).toBeRejectedByPolicy(); // admin doesn't have permission for sensitiveInfo

            // Test nested updates
            // (User already created at the beginning of the test)

            // Nested update respects inherited field-level policies
            await expect(
                userDb.user.update({
                    where: { id: 1 },
                    data: {
                        document: {
                            update: {
                                where: { id: 1 },
                                data: { secretData: 'NESTED_UPDATE' },
                            },
                        },
                    },
                }),
            ).toBeRejectedByPolicy();

            await expect(
                adminDb.user.update({
                    where: { id: 1 },
                    data: {
                        document: {
                            update: {
                                where: { id: 1 },
                                data: { secretData: 'ADMIN_NESTED_UPDATE' },
                            },
                        },
                    },
                }),
            ).toResolveTruthy();

            // Test query builder updates
            await expect(
                userDb.$qb.updateTable('Document').set({ secretData: 'QB_UPDATE' }).where('id', '=', 2).execute(),
            ).toBeRejectedByPolicy();

            await expect(
                adminDb.$qb
                    .updateTable('Document')
                    .set({ secretData: 'ADMIN_QB_UPDATE' })
                    .where('id', '=', 2)
                    .executeTakeFirst(),
            ).resolves.toMatchObject({ numUpdatedRows: 1n });

            // createdBy cannot be updated by anyone (deny policy)
            await expect(
                adminDb.$qb.updateTable('Document').set({ createdBy: 'ADMIN_QB' }).where('id', '=', 2).execute(),
            ).toBeRejectedByPolicy();
        });
    });

    describe('delegate model tests', () => {
        it('inherits field-level policies from delegate models', async () => {
            const db = await createPolicyTestClient(
                `
        type Auth {
            id Int
            admin Boolean
            role String
            @@auth
        }

        model BaseContent {
            id Int @id @default(autoincrement())
            title String
            secretNotes String @allow('read', auth().admin) @allow('update', auth().admin)
            publicContent String
            createdBy String @allow('read', auth() != null) @deny('update', true)
            contentType String

            @@delegate(contentType)
            @@allow('all', true)
        }

        model Article extends BaseContent {
            body String
            category String @allow('read', auth().role == 'EDITOR' || auth().admin) @allow('update', auth().role == 'EDITOR')
            articleType String

            @@delegate(articleType)
        }

        model BlogPost extends Article {
            tags String
            internalNotes String @allow('read', auth().role == 'AUTHOR') @deny('update', auth().role != 'AUTHOR')
        }
        `,
            );

            // Create test data
            await db.$unuseAll().blogPost.create({
                data: {
                    id: 1,
                    title: 'Test Post',
                    secretNotes: 'SECRET',
                    publicContent: 'PUBLIC',
                    createdBy: 'user1',
                    body: 'Body content',
                    category: 'tech',
                    tags: 'test,blog',
                    internalNotes: 'INTERNAL',
                },
            });

            let r;

            // ===== READ TESTS =====

            // Anonymous user - no auth
            const anonDb = db;

            r = await anonDb.blogPost.findUnique({ where: { id: 1 } });
            expect(r.secretNotes).toBeNull(); // from BaseContent
            expect(r.publicContent).toEqual('PUBLIC');
            expect(r.createdBy).toBeNull(); // from BaseContent
            expect(r.category).toBeNull(); // from Article
            expect(r.internalNotes).toBeNull(); // from BlogPost
            expect(r.title).toEqual('Test Post');
            expect(r.body).toEqual('Body content');
            expect(r.tags).toEqual('test,blog');

            // Regular user - authenticated but no special role
            const userDb = db.$setAuth({ id: 1, admin: false, role: 'USER' });

            r = await userDb.blogPost.findUnique({ where: { id: 1 } });
            expect(r.secretNotes).toBeNull(); // not admin
            expect(r.publicContent).toEqual('PUBLIC');
            expect(r.createdBy).toEqual('user1'); // authenticated
            expect(r.category).toBeNull(); // not EDITOR or admin
            expect(r.internalNotes).toBeNull(); // not AUTHOR
            expect(r.body).toEqual('Body content');

            // Author user
            const authorDb = db.$setAuth({ id: 2, admin: false, role: 'AUTHOR' });

            r = await authorDb.blogPost.findUnique({ where: { id: 1 } });
            expect(r.secretNotes).toBeNull(); // not admin
            expect(r.createdBy).toEqual('user1'); // authenticated
            expect(r.category).toBeNull(); // not EDITOR or admin
            expect(r.internalNotes).toEqual('INTERNAL'); // AUTHOR can read
            expect(r.body).toEqual('Body content');

            // Editor user
            const editorDb = db.$setAuth({ id: 3, admin: false, role: 'EDITOR' });

            r = await editorDb.blogPost.findUnique({ where: { id: 1 } });
            expect(r.secretNotes).toBeNull(); // not admin
            expect(r.createdBy).toEqual('user1'); // authenticated
            expect(r.category).toEqual('tech'); // EDITOR can read
            expect(r.internalNotes).toBeNull(); // not AUTHOR
            expect(r.body).toEqual('Body content');

            // Admin user
            const adminDb = db.$setAuth({ id: 4, admin: true, role: 'ADMIN' });

            r = await adminDb.blogPost.findUnique({ where: { id: 1 } });
            expect(r.secretNotes).toEqual('SECRET'); // admin can read
            expect(r.createdBy).toEqual('user1');
            expect(r.category).toEqual('tech'); // admin can read
            expect(r.internalNotes).toBeNull(); // not AUTHOR
            expect(r.publicContent).toEqual('PUBLIC');
            expect(r.body).toEqual('Body content');

            // Test reading from base model access point
            r = await anonDb.baseContent.findUnique({ where: { id: 1 } });
            expect(r.secretNotes).toBeNull();
            expect(r.createdBy).toBeNull();

            r = await adminDb.baseContent.findUnique({ where: { id: 1 } });
            expect(r.secretNotes).toEqual('SECRET');
            expect(r.createdBy).toEqual('user1');

            // Test reading from intermediate delegate (Article)
            r = await editorDb.article.findUnique({ where: { id: 1 } });
            expect(r.secretNotes).toBeNull(); // from base, needs admin
            expect(r.category).toEqual('tech'); // Article field, EDITOR can read
            expect(r.createdBy).toEqual('user1'); // from base, authenticated can read

            // ===== UPDATE TESTS =====

            // Non-admin cannot update secretNotes (from BaseContent)
            await expect(
                userDb.blogPost.update({
                    where: { id: 1 },
                    data: { secretNotes: 'UPDATED_SECRET' },
                }),
            ).toBeRejectedByPolicy();

            // No one can update createdBy (deny policy from BaseContent)
            await expect(
                adminDb.blogPost.update({
                    where: { id: 1 },
                    data: { createdBy: 'UPDATED_USER' },
                }),
            ).toBeRejectedByPolicy();

            // Admin can update secretNotes
            r = await adminDb.blogPost.update({
                where: { id: 1 },
                data: { secretNotes: 'ADMIN_UPDATED_SECRET' },
            });
            expect(r.secretNotes).toEqual('ADMIN_UPDATED_SECRET');

            // Non-editor cannot update category (from Article)
            await expect(
                userDb.blogPost.update({
                    where: { id: 1 },
                    data: { category: 'science' },
                }),
            ).toBeRejectedByPolicy();

            // Editor can update category
            r = await editorDb.blogPost.update({
                where: { id: 1 },
                data: { category: 'science' },
            });
            expect(r.category).toEqual('science');

            // Non-author cannot update internalNotes (from BlogPost)
            await expect(
                editorDb.blogPost.update({
                    where: { id: 1 },
                    data: { internalNotes: 'EDITOR_UPDATE' },
                }),
            ).toBeRejectedByPolicy();

            // Author can update internalNotes
            r = await authorDb.blogPost.update({
                where: { id: 1 },
                data: { internalNotes: 'AUTHOR_UPDATED' },
            });
            expect(r.internalNotes).toEqual('AUTHOR_UPDATED');

            // Test multi-field update requiring multiple permissions
            await expect(
                editorDb.blogPost.update({
                    where: { id: 1 },
                    data: { secretNotes: 'SECRET', category: 'tech' },
                }),
            ).toBeRejectedByPolicy(); // editor can't update secretNotes

            await expect(
                authorDb.blogPost.update({
                    where: { id: 1 },
                    data: { category: 'tech', internalNotes: 'INTERNAL' },
                }),
            ).toBeRejectedByPolicy(); // author can't update category

            // Admin can update secretNotes but not internalNotes
            await expect(
                adminDb.blogPost.update({
                    where: { id: 1 },
                    data: { secretNotes: 'SECRET', internalNotes: 'ADMIN_NOTES' },
                }),
            ).toBeRejectedByPolicy(); // admin is not AUTHOR

            // Test updating via base model access point
            await expect(
                userDb.baseContent.update({
                    where: { id: 1 },
                    data: { secretNotes: 'USER_SECRET' },
                }),
            ).toBeRejectedByPolicy();

            r = await adminDb.baseContent.update({
                where: { id: 1 },
                data: { secretNotes: 'BASE_ADMIN_SECRET' },
            });
            expect(r.secretNotes).toEqual('BASE_ADMIN_SECRET');

            // Test updating via intermediate delegate (Article)
            await expect(
                userDb.article.update({
                    where: { id: 1 },
                    data: { category: 'news' },
                }),
            ).toBeRejectedByPolicy();

            r = await editorDb.article.update({
                where: { id: 1 },
                data: { category: 'news' },
            });
            expect(r.category).toEqual('news');

            // Test with select queries
            r = await anonDb.blogPost.findUnique({
                where: { id: 1 },
                select: { secretNotes: true, category: true, internalNotes: true },
            });
            expect(r.secretNotes).toBeNull();
            expect(r.category).toBeNull();
            expect(r.internalNotes).toBeNull();

            r = await adminDb.blogPost.findUnique({
                where: { id: 1 },
                select: { secretNotes: true, category: true, createdBy: true },
            });
            expect(r.secretNotes).toEqual('BASE_ADMIN_SECRET');
            expect(r.category).toEqual('news');
            expect(r.createdBy).toEqual('user1');
        });
    });
});
