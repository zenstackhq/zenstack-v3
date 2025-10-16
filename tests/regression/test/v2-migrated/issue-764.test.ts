import { createPolicyTestClient } from '@zenstackhq/testtools';
import { describe, it } from 'vitest';

describe('Regression for issue #764', () => {
    it('verifies issue 764', async () => {
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

        const user = await db.user.create({
            data: { name: 'Me' },
        });

        await db.user.update({
            where: { id: user.id },
            data: {
                post: {
                    upsert: {
                        create: {
                            title: 'Hello World',
                        },
                        update: {
                            title: 'Hello World',
                        },
                    },
                },
            },
        });
    });
});
