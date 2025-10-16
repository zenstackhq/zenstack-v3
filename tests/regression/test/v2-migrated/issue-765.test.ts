import { createPolicyTestClient } from '@zenstackhq/testtools';
import { describe, expect, it } from 'vitest';

describe('Regression for issue #765', () => {
    it('verifies issue 765', async () => {
        const db = await createPolicyTestClient(
            `
    model User {
        id    Int     @id @default(autoincrement())
        name  String
    
        post   Post? @relation(fields: [postId], references: [id])
        postId Int?
    
        @@allow('all', true)
    }
    
    model Post {
        id    Int    @id @default(autoincrement())
        title String
        User  User[]
    
        @@allow('all', true)
    }
                `,
        );

        const r = await db.user.create({
            data: {
                name: 'Me',
                post: undefined,
            },
        });
        expect(r.name).toBe('Me');
        expect(r.post).toBeUndefined();
    });
});
