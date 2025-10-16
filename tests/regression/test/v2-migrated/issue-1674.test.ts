import { createPolicyTestClient } from '@zenstackhq/testtools';
import { describe, expect, it } from 'vitest';

describe('Regression for issue #1674', () => {
    it('verifies issue 1674', async () => {
        const db = await createPolicyTestClient(
            `
    model User {
        id       String @id @default(cuid())
        email    String @unique @email @length(6, 32)
        posts    Post[]

        // everybody can signup
        @@allow('create', true)

        // full access by self
        @@allow('all', auth() == this)
    }

    model Blog {
        id        String   @id @default(cuid())
        createdAt DateTime @default(now())
        updatedAt DateTime @updatedAt

        post      Post? @relation(fields: [postId], references: [id], onDelete: Cascade)
        postId String?
    }

    model Post {
        id        String   @id @default(cuid())
        createdAt DateTime @default(now())
        updatedAt DateTime @updatedAt
        title     String   @length(1, 256)
        content   String
        published Boolean  @default(false)
        author    User     @relation(fields: [authorId], references: [id])
        authorId  String

        blogs Blog[] 

        type String

        @@delegate(type)
    }

    model PostA extends Post {
    }

    model PostB extends Post {
    }
                `,
        );

        const user = await db.$unuseAll().user.create({
            data: { email: 'abc@def.com' },
        });

        const blog = await db.$unuseAll().blog.create({
            data: {},
        });

        const authDb = db.$setAuth(user);
        await expect(
            authDb.postA.create({
                data: {
                    content: 'content',
                    title: 'title',
                    blogs: {
                        connect: {
                            id: blog.id,
                        },
                    },
                    author: {
                        connect: {
                            id: user.id,
                        },
                    },
                },
            }),
        ).toBeRejectedByPolicy();
    });
});
