import { describe, expect, it } from 'vitest';
import { createPolicyTestClient } from '@zenstackhq/testtools';

describe('Policy post-update tests', () => {
    it('allows post-update by default', async () => {
        const db = await createPolicyTestClient(
            `
            model Foo {
                id Int @id
                x  Int
                @@allow('read,create,update', true)
            }
            `,
        );

        await db.foo.create({ data: { id: 1, x: 0 } });
        await expect(db.foo.update({ where: { id: 1 }, data: { x: 1 } })).toResolveTruthy();
    });

    it('works with simple post-update rules', async () => {
        const db = await createPolicyTestClient(
            `
            model Foo {
                id Int @id
                x  Int
                @@allow('all', true)
                @@allow('post-update', x > 1)
                @@deny('post-update', x > 2)
            }
            `,
        );

        await db.foo.create({ data: { id: 1, x: 0 } });

        // allow: x > 1
        await expect(db.foo.update({ where: { id: 1 }, data: { x: 1 } })).toBeRejectedByPolicy();
        // check not updated
        await expect(db.foo.findUnique({ where: { id: 1 } })).resolves.toMatchObject({ x: 0 });

        // deny: x > 2
        await expect(db.foo.update({ where: { id: 1 }, data: { x: 3 } })).toBeRejectedByPolicy();
        // check not updated
        await expect(db.foo.findUnique({ where: { id: 1 } })).resolves.toMatchObject({ x: 0 });

        await expect(db.foo.update({ where: { id: 1 }, data: { x: 2 } })).resolves.toMatchObject({ x: 2 });
    });

    it('respect deny rules without allow', async () => {
        const db = await createPolicyTestClient(
            `
            model Foo {
                id Int @id
                x  Int
                @@allow('create,read,update', true)
                @@deny('post-update', x > 1)
            }
            `,
        );

        await db.foo.create({ data: { id: 1, x: 0 } });
        await expect(db.foo.update({ where: { id: 1 }, data: { x: 2 } })).toBeRejectedByPolicy();
        await expect(db.foo.update({ where: { id: 1 }, data: { x: 1 } })).toResolveTruthy();
    });

    it('works with relation conditions', async () => {
        const db = await createPolicyTestClient(
            `
            model User {
                id Int @id
                age Int
                profile Profile?
                @@allow('all', true)
                @@allow('post-update', profile == null || age == profile.age)
            }

            model Profile {
                id Int @id
                age Int
                userId Int @unique
                user User @relation(fields: [userId], references: [id])
                @@allow('all', true)
            }
            `,
        );

        await db.user.create({ data: { id: 1, age: 20, profile: { create: { id: 1, age: 18 } } } });
        await expect(db.user.update({ where: { id: 1 }, data: { age: 22 } })).toBeRejectedByPolicy();
        await expect(db.user.update({ where: { id: 1 }, data: { age: 18 } })).toResolveTruthy();

        await db.user.create({ data: { id: 2, age: 20, profile: { create: { id: 2, age: 18 } } } });
        await expect(
            db.user.update({ where: { id: 2 }, data: { age: 22, profile: { delete: true } } }),
        ).toResolveTruthy();
    });

    it('works with before function', async () => {
        const db = await createPolicyTestClient(
            `
            model Foo {
                id Int @id
                x  Int
                @@allow('all', true)
                @@allow('post-update', x > before().x)
            }
            `,
        );

        await db.foo.create({ data: { id: 1, x: 1 } });
        await db.foo.create({ data: { id: 2, x: 2 } });

        // update one
        await expect(db.foo.update({ where: { id: 1 }, data: { x: 0 } })).toBeRejectedByPolicy();
        // check not updated
        await expect(db.foo.findUnique({ where: { id: 1 } })).resolves.toMatchObject({ x: 1 });

        // update many
        await expect(db.foo.updateMany({ data: { x: 0 } })).toBeRejectedByPolicy();
        // check not updated
        await expect(db.foo.findUnique({ where: { id: 1 } })).resolves.toMatchObject({ x: 1 });
        await expect(db.foo.findUnique({ where: { id: 2 } })).resolves.toMatchObject({ x: 2 });

        await expect(db.foo.update({ where: { id: 1 }, data: { x: 2 } })).toResolveTruthy();
        await expect(db.foo.updateMany({ data: { x: 3 } })).resolves.toMatchObject({ count: 2 });
        // check updated
        await expect(db.foo.findUnique({ where: { id: 1 } })).resolves.toMatchObject({ x: 3 });
        await expect(db.foo.findUnique({ where: { id: 2 } })).resolves.toMatchObject({ x: 3 });
    });

    it('works with query builder API', async () => {
        const db = await createPolicyTestClient(
            `
            model Foo {
                id Int @id
                x  Int
                @@allow('all', true)
                @@allow('post-update', x > before().x)
            }
            `,
        );

        await db.foo.create({ data: { id: 1, x: 1 } });
        await db.foo.create({ data: { id: 2, x: 2 } });

        // update one
        await expect(db.$qb.updateTable('Foo').set({ x: 0 }).where('id', '=', 1).execute()).toBeRejectedByPolicy();
        // check not updated
        await expect(db.foo.findUnique({ where: { id: 1 } })).resolves.toMatchObject({ x: 1 });

        // update many
        await expect(db.$qb.updateTable('Foo').set({ x: 0 }).execute()).toBeRejectedByPolicy();
        // check not updated
        await expect(db.foo.findUnique({ where: { id: 1 } })).resolves.toMatchObject({ x: 1 });
        await expect(db.foo.findUnique({ where: { id: 2 } })).resolves.toMatchObject({ x: 2 });

        await expect(
            db.$qb.updateTable('Foo').set({ x: 2 }).where('id', '=', 1).executeTakeFirst(),
        ).resolves.toMatchObject({
            numUpdatedRows: 1n,
        });
        // check updated
        await expect(db.foo.findUnique({ where: { id: 1 } })).resolves.toMatchObject({ x: 2 });

        await expect(db.$qb.updateTable('Foo').set({ x: 3 }).executeTakeFirst()).resolves.toMatchObject({
            numUpdatedRows: 2n,
        });
        // check updated
        await expect(db.foo.findUnique({ where: { id: 1 } })).resolves.toMatchObject({ x: 3 });
        await expect(db.foo.findUnique({ where: { id: 2 } })).resolves.toMatchObject({ x: 3 });
    });

    it('rejects accessing relation fields from before', async () => {
        await expect(
            createPolicyTestClient(
                `
            model User {
                id Int @id
                name String
                profile Profile?
            }

            model Profile {
                id Int @id
                userId Int @unique
                user User @relation(fields: [userId], references: [id])
                @@allow('post-update', before().user.name == 'a')
            }
            `,
            ),
        ).rejects.toThrow('relation fields cannot be accessed from `before()`');
    });
});
