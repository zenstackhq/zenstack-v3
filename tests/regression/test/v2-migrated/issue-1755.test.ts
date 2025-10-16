import { createTestClient } from '@zenstackhq/testtools';
import { describe, expect, it } from 'vitest';

describe('Regression for issue #1755', () => {
    it('verifies issue 1755', async () => {
        const db = await createTestClient(
            `
    model User {
        id          Int     @id @default(autoincrement())
        contents   Content[]
    }

    model Content {
        id Int @id @default(autoincrement())
        createdAt DateTime @default(now())
        user User @relation(fields: [userId], references: [id])
        userId Int
        contentType String
        @@delegate(contentType)
    }

    model Post extends Content {
        title String
    }

    model Video extends Content {
        name String
        duration Int
    }
                `,
        );

        const user = await db.user.create({ data: {} });
        const now = Date.now();
        await db.post.create({
            data: { title: 'post1', createdAt: new Date(now - 1000), user: { connect: { id: user.id } } },
        });
        await db.post.create({
            data: { title: 'post2', createdAt: new Date(now), user: { connect: { id: user.id } } },
        });

        // scalar orderBy
        await expect(db.post.findFirst({ orderBy: { createdAt: 'desc' } })).resolves.toMatchObject({
            title: 'post2',
        });

        // array orderBy
        await expect(db.post.findFirst({ orderBy: [{ createdAt: 'desc' }] })).resolves.toMatchObject({
            title: 'post2',
        });

        // nested orderBy
        await expect(
            db.user.findFirst({ include: { contents: { orderBy: [{ createdAt: 'desc' }] } } }),
        ).resolves.toMatchObject({
            id: user.id,
            contents: [{ title: 'post2' }, { title: 'post1' }],
        });
    });
});
