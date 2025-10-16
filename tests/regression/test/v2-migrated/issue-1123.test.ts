import { createPolicyTestClient } from '@zenstackhq/testtools';
import { describe, expect, it } from 'vitest';

describe('Regression for issue #1123', () => {
    it('verifies issue 1123', async () => {
        const db = await createPolicyTestClient(
            `
model Content {
    id String @id @default(cuid())
    published Boolean @default(false)
    contentType String
    likes Like[]
    @@delegate(contentType)
    @@allow('all', true)
}

model Post extends Content {
    title String
}

model Image extends Content {
    url String
}

model Like {
    id String @id @default(cuid())
    content Content @relation(fields: [contentId], references: [id])
    contentId String
    @@allow('all', true)
}
            `,
        );

        await db.post.create({
            data: {
                title: 'a post',
                likes: { create: {} },
            },
        });

        await expect(db.content.findFirst({ include: { _count: { select: { likes: true } } } })).resolves.toMatchObject(
            {
                _count: { likes: 1 },
            },
        );
    });
});
