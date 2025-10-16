import { createPolicyTestClient } from '@zenstackhq/testtools';
import { describe, expect, it } from 'vitest';

describe('Regression for issue #2019', () => {
    it('verifies issue 2019', async () => {
        const db = await createPolicyTestClient(
            `
    model Tenant {
        id      String    @id @default(uuid())

        users   User[]
        content Content[]
    }

    model User {
        id       String          @id @default(uuid())
        tenantId String          @default(auth().tenantId)
        tenant   Tenant          @relation(fields: [tenantId], references: [id])
        posts    Post[]
        likes    PostUserLikes[]

        @@allow('all', true)
    }

    model Content {
        tenantId    String @default(auth().tenantId)
        tenant      Tenant @relation(fields: [tenantId], references: [id])
        id          String @id @default(uuid())
        contentType String

        @@delegate(contentType)
        @@allow('all', true)
    }

    model Post extends Content {
        author   User            @relation(fields: [authorId], references: [id])
        authorId String          @default(auth().id)

        comments Comment[]
        likes    PostUserLikes[]

        @@allow('all', true)
    }

    model PostUserLikes extends Content {
        userId String
        user   User   @relation(fields: [userId], references: [id])

        postId String
        post   Post   @relation(fields: [postId], references: [id])

        @@unique([userId, postId])

        @@allow('all', true)
    }

    model Comment extends Content {
        postId String
        post   Post   @relation(fields: [postId], references: [id])

        @@allow('all', true)
    }
                `,
        );

        const tenant = await db.$unuseAll().tenant.create({ data: {} });
        const user = await db.$unuseAll().user.create({ data: { tenantId: tenant.id } });
        const authDb = db.$setAuth({ id: user.id, tenantId: tenant.id });
        const result = await authDb.post.create({
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
        });
        expect(result.likes[0].tenantId).toBe(tenant.id);
    });
});
