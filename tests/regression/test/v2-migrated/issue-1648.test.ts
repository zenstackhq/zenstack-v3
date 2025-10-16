import { createPolicyTestClient } from '@zenstackhq/testtools';
import { describe, expect, it } from 'vitest';

describe('Regression for issue #1648', () => {
    it('verifies issue 1648', async () => {
        const db = await createPolicyTestClient(
            `
    model User {
        id      Int      @id @default(autoincrement())
        profile Profile?
        posts   Post[]
    }

    model Profile {
        id     Int  @id @default(autoincrement())
        someText String
        user   User @relation(fields: [userId], references: [id])
        userId Int  @unique
    }

    model Post {
        id     Int    @id @default(autoincrement())
        title  String

        userId Int
        user   User   @relation(fields: [userId], references: [id])

        // this will always be true, even if the someText field is "canUpdate"
        @@deny("post-update", user.profile.someText != "canUpdate")

        @@allow("all", true)
    }
                `,
        );

        await db.$unuseAll().user.create({ data: { id: 1, profile: { create: { someText: 'canUpdate' } } } });
        await db.$unuseAll().user.create({ data: { id: 2, profile: { create: { someText: 'nothing' } } } });
        await db.$unuseAll().post.create({ data: { id: 1, title: 'Post1', userId: 1 } });
        await db.$unuseAll().post.create({ data: { id: 2, title: 'Post2', userId: 2 } });

        await expect(db.post.update({ where: { id: 1 }, data: { title: 'Post1-1' } })).toResolveTruthy();
        await expect(db.post.update({ where: { id: 2 }, data: { title: 'Post2-2' } })).toBeRejectedByPolicy();
    });
});
