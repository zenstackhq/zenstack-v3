import { describe, expect, it } from 'vitest';
import { createPolicyTestClient } from '@zenstackhq/testtools';

describe('Policy updateManyAndReturn tests', () => {
    it('model-level policies', async () => {
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
            @@allow('update', contains(title, 'hello'))
        }
        `,
        );

        if (db.$schema.provider.type === 'mysql') {
            // skip mysql as it doesn't support updateManyAndReturn
            return;
        }

        const rawDb = db.$unuseAll();

        await rawDb.user.createMany({
            data: [{ id: 1, level: 1 }],
        });
        await rawDb.user.createMany({
            data: [{ id: 2, level: 0 }],
        });

        await rawDb.post.createMany({
            data: [
                { id: 1, title: 'hello1', userId: 1, published: true },
                { id: 2, title: 'world1', userId: 1, published: false },
            ],
        });

        // only post#1 is updated
        const r = await db.post.updateManyAndReturn({
            data: { title: 'foo' },
        });
        expect(r).toHaveLength(1);
        expect(r[0].id).toBe(1);

        // post#2 is excluded from update
        await expect(
            db.post.updateManyAndReturn({
                where: { id: 2 },
                data: { title: 'foo' },
            }),
        ).resolves.toHaveLength(0);

        // reset
        await rawDb.post.update({ where: { id: 1 }, data: { title: 'hello1' } });

        // post#1 is updated
        await expect(
            db.post.updateManyAndReturn({
                where: { id: 1 },
                data: { title: 'foo' },
            }),
        ).resolves.toHaveLength(1);

        // reset
        await rawDb.post.update({ where: { id: 1 }, data: { title: 'hello1' } });

        // read-back check
        // post#1 updated but can't be read back
        await expect(
            db.post.updateManyAndReturn({
                data: { published: false },
            }),
        ).toBeRejectedByPolicy(['result is not allowed to be read back']);
        // but the update should have been applied
        await expect(db.$unuseAll().post.findUnique({ where: { id: 1 } })).resolves.toMatchObject({ published: false });
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
            // skip mysql as it doesn't support updateManyAndReturn
            return;
        }

        const rawDb = db.$unuseAll();

        // update should succeed but one result's title field can't be read back
        await rawDb.post.createMany({
            data: [
                { id: 1, title: 'post1', published: true },
                { id: 2, title: 'post2', published: false },
            ],
        });

        const r = await db.post.updateManyAndReturn({
            data: { title: 'foo' },
        });

        expect(r.length).toBe(2);
        expect(r[0].title).toBeTruthy();
        expect(r[1].title).toBeNull();

        // check posts are updated
        await expect(rawDb.post.findMany({ where: { title: 'foo' } })).resolves.toHaveLength(2);
    });
});
