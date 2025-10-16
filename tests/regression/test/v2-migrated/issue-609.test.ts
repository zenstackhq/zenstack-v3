import { createPolicyTestClient } from '@zenstackhq/testtools';
import { describe, expect, it } from 'vitest';

describe('Regression for issue #609', () => {
    it('verifies issue 609', async () => {
        const db = await createPolicyTestClient(
            `
    model User {
        id String @id @default(cuid())
        comments Comment[]
    }

    model Comment {
        id                 String      @id @default(cuid())
        parentCommentId    String? 
        replies            Comment[]   @relation("CommentToComment")
        parent             Comment?    @relation("CommentToComment", fields: [parentCommentId], references: [id])
        comment            String
        author             User        @relation(fields: [authorId], references: [id])
        authorId           String      
    
        @@allow('read,create', true)
        @@allow('update,delete', auth() == author)
    }    
                `,
            { usePrismaPush: true },
        );

        const rawDb = db.$unuseAll();

        await rawDb.user.create({
            data: {
                id: '1',
                comments: {
                    create: {
                        id: '1',
                        comment: 'Comment 1',
                    },
                },
            },
        });

        await rawDb.user.create({
            data: {
                id: '2',
            },
        });

        // connecting a child comment from a different user to a parent comment should succeed
        const dbAuth = db.$setAuth({ id: '2' });
        await expect(
            dbAuth.comment.create({
                data: {
                    comment: 'Comment 2',
                    author: { connect: { id: '2' } },
                    parent: { connect: { id: '1' } },
                },
            }),
        ).toResolveTruthy();
    });
});
