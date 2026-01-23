import { describe, expect, it } from 'vitest';
import { createPolicyTestClient } from '@zenstackhq/testtools';

describe('createManyAndReturn tests', () => {
    it('works with model-level policies', async () => {
        const db = await createPolicyTestClient(
            `
        model User {
            id Int @id @default(autoincrement())
            posts Post[]
            level Int

            @@allow('read', level > 0)
        }

        model Post {
            id Int @id @default(autoincrement())
            title String
            published Boolean @default(false)
            userId Int
            user User @relation(fields: [userId], references: [id])

            @@allow('read', published)
            @@allow('create', contains(title, 'hello'))
        }
        `,
        );

        if (db.$schema.provider.type === 'mysql') {
            // MySQL does not support createManyAndReturn
            return;
        }

        const rawDb = db.$unuseAll();

        await rawDb.user.createMany({
            data: [
                { id: 1, level: 1 },
                { id: 2, level: 0 },
            ],
        });

        // create rule violation
        await expect(
            db.post.createManyAndReturn({
                data: [{ title: 'foo', userId: 1 }],
            }),
        ).toBeRejectedByPolicy();

        // success
        const r = await db.post.createManyAndReturn({
            data: [{ id: 1, title: 'hello1', userId: 1, published: true }],
        });
        expect(r.length).toBe(1);

        // read-back check, only one result is readable
        await expect(
            db.post.createManyAndReturn({
                data: [
                    { id: 2, title: 'hello2', userId: 1, published: true },
                    { id: 3, title: 'hello3', userId: 1, published: false },
                ],
            }),
        ).toResolveWithLength(1);
        // two are created indeed
        await expect(rawDb.post.findMany()).resolves.toHaveLength(3);
    });

    it('field-level policies', async () => {
        const db = await createPolicyTestClient(
            `
        model Post {
            id Int @id @default(autoincrement())
            title String @allow('read', published)
            published Boolean @default(false)

            @@allow('all', true)
        }
        `,
        );

        if (db.$schema.provider.type === 'mysql') {
            // MySQL does not support createManyAndReturn
            return;
        }

        const rawDb = db.$unuseAll();
        // create should succeed but one result's title field can't be read back
        const r = await db.post.createManyAndReturn({
            data: [
                { title: 'post1', published: true },
                { title: 'post2', published: false },
            ],
        });

        expect(r.length).toBe(2);
        expect(r[0].title).toBeTruthy();
        expect(r[1].title).toBeNull();

        // check posts are created
        await expect(rawDb.post.findMany()).resolves.toHaveLength(2);
    });
});
