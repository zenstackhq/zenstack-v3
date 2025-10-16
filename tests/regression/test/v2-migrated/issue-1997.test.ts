import { createPolicyTestClient } from '@zenstackhq/testtools';
import { describe, expect, it } from 'vitest';

describe('Regression for issue #1997', () => {
    it('verifies issue 1997', async () => {
        const db = await createPolicyTestClient(
            `
                model Tenant {
                    id            String          @id @default(uuid())
            
                    users         User[]
                    posts         Post[]
                    comments      Comment[]
                    postUserLikes PostUserLikes[]
                }
            
                model User {
                    id       String          @id @default(uuid())
                    tenantId String          @default(auth().tenantId)
                    tenant   Tenant          @relation(fields: [tenantId], references: [id])
                    posts    Post[]
                    likes    PostUserLikes[]
            
                    @@allow('all', true)
                }
            
                model Post {
                    tenantId String          @default(auth().tenantId)
                    tenant   Tenant          @relation(fields: [tenantId], references: [id])
                    id       String          @default(uuid())
                    author   User            @relation(fields: [authorId], references: [id])
                    authorId String          @default(auth().id)
            
                    comments Comment[]
                    likes    PostUserLikes[]
            
                    @@id([tenantId, id])
            
                    @@allow('all', true)
                }
            
                model PostUserLikes {
                    tenantId String @default(auth().tenantId)
                    tenant   Tenant @relation(fields: [tenantId], references: [id])
                    id       String @default(uuid())
            
                    userId   String
                    user     User   @relation(fields: [userId], references: [id])
            
                    postId   String
                    post     Post   @relation(fields: [tenantId, postId], references: [tenantId, id])
            
                    @@id([tenantId, id])
                    @@unique([tenantId, userId, postId])
            
                    @@allow('all', true)
                }
            
                model Comment {
                    tenantId String @default(auth().tenantId)
                    tenant   Tenant @relation(fields: [tenantId], references: [id])
                    id       String @default(uuid())
                    postId   String
                    post     Post   @relation(fields: [tenantId, postId], references: [tenantId, id])
            
                    @@id([tenantId, id])
            
                    @@allow('all', true)
                }
                `,
        );

        const tenant = await db.$unuseAll().tenant.create({
            data: {},
        });
        const user = await db.$unuseAll().user.create({
            data: { tenantId: tenant.id },
        });

        const authDb = db.$setAuth({ id: user.id, tenantId: tenant.id });

        await expect(
            authDb.post.create({
                data: {
                    likes: {
                        createMany: {
                            data: [
                                {
                                    userId: user.id,
                                },
                            ],
                        },
                    },
                },
                include: {
                    likes: true,
                },
            }),
        ).resolves.toMatchObject({
            authorId: user.id,
            likes: [
                {
                    tenantId: tenant.id,
                    userId: user.id,
                },
            ],
        });

        await expect(
            authDb.post.create({
                data: {
                    comments: {
                        createMany: {
                            data: [{}],
                        },
                    },
                },
                include: {
                    comments: true,
                },
            }),
        ).resolves.toMatchObject({
            authorId: user.id,
            comments: [
                {
                    tenantId: tenant.id,
                },
            ],
        });
    });
});
