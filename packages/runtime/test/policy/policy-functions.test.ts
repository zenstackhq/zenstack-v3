import { describe, expect, it } from 'vitest';
import { createPolicyTestClient } from './utils';

describe('policy functions tests', () => {
    it('supports contains with case-sensitive field', async () => {
        const db = await createPolicyTestClient(
            `
            model Foo {
                id String @id @default(cuid())
                string String
                @@allow('all', contains(string, 'a'))
            }
            `,
        );

        await expect(db.foo.create({ data: { string: 'bcd' } })).toBeRejectedByPolicy();
        await expect(db.foo.create({ data: { string: 'bac' } })).toResolveTruthy();
    });

    it('supports contains with case-sensitive non-field', async () => {
        const db = await createPolicyTestClient(
            `
            model User {
                id String @id
                name String
            }

            model Foo {
                id String @id @default(cuid())
                @@allow('all', contains(auth().name, 'a'))
            }
            `,
        );

        await expect(db.foo.create({ data: {} })).toBeRejectedByPolicy();
        await expect(db.$setAuth({ id: 'user1', name: 'bcd' }).foo.create({ data: {} })).toBeRejectedByPolicy();
        await expect(db.$setAuth({ id: 'user1', name: 'bac' }).foo.create({ data: {} })).toResolveTruthy();
    });

    it('supports contains with auth()', async () => {
        const anonDb = await createPolicyTestClient(
            `
            model User {
                id String @id
                name String
            }

            model Foo {
                id String @id @default(cuid())
                string String
                @@allow('all', contains(string, auth().name))
            }
            `,
        );

        // 'abc' contains null
        await expect(anonDb.foo.create({ data: { string: 'abc' } })).toResolveTruthy();
        const db = anonDb.$setAuth({ id: '1', name: 'a' });
        await expect(db.foo.create({ data: { string: 'bcd' } })).toBeRejectedByPolicy();
        await expect(db.foo.create({ data: { string: 'bac' } })).toResolveTruthy();
    });

    it('supports startsWith with field', async () => {
        const db = await createPolicyTestClient(
            `
            model Foo {
                id String @id @default(cuid())
                string String
                @@allow('all', startsWith(string, 'a'))
            }
            `,
        );

        await expect(db.foo.create({ data: { string: 'bac' } })).toBeRejectedByPolicy();
        await expect(db.foo.create({ data: { string: 'abc' } })).toResolveTruthy();
    });

    it('supports startsWith with non-field', async () => {
        const anonDb = await createPolicyTestClient(
            `
            model User {
                id String @id
                name String
            }

            model Foo {
                id String @id @default(cuid())
                @@allow('all', startsWith(auth().name, 'a'))
            }
            `,
        );

        await expect(anonDb.foo.create({ data: {} })).toBeRejectedByPolicy();
        await expect(anonDb.foo.create({ data: {} })).toBeRejectedByPolicy();
        await expect(anonDb.$setAuth({ id: 'user1', name: 'abc' }).foo.create({ data: {} })).toResolveTruthy();
    });

    it('supports endsWith with field', async () => {
        const db = await createPolicyTestClient(
            `
            model Foo {
                id String @id @default(cuid())
                string String
                @@allow('all', endsWith(string, 'a'))
            }
            `,
        );

        await expect(db.foo.create({ data: { string: 'bac' } })).toBeRejectedByPolicy();
        await expect(db.foo.create({ data: { string: 'bca' } })).toResolveTruthy();
    });

    it('supports endsWith with non-field', async () => {
        const anonDb = await createPolicyTestClient(
            `
            model User {
                id String @id
                name String
            }

            model Foo {
                id String @id @default(cuid())
                @@allow('all', endsWith(auth().name, 'a'))
            }
            `,
        );

        await expect(anonDb.foo.create({ data: {} })).toBeRejectedByPolicy();
        await expect(anonDb.$setAuth({ id: 'user1', name: 'bac' }).foo.create({ data: {} })).toBeRejectedByPolicy();
        await expect(anonDb.$setAuth({ id: 'user1', name: 'bca' }).foo.create({ data: {} })).toResolveTruthy();
    });

    it('supports in with field', async () => {
        const db = await createPolicyTestClient(
            `
            model Foo {
                id String @id @default(cuid())
                string String
                @@allow('all', string in ['a', 'b'])
            }
            `,
        );

        await expect(db.foo.create({ data: { string: 'c' } })).toBeRejectedByPolicy();
        await expect(db.foo.create({ data: { string: 'b' } })).toResolveTruthy();
    });

    it('supports in with non-field', async () => {
        const anonDb = await createPolicyTestClient(
            `
            model User {
                id String @id
                name String
            }

            model Foo {
                id String @id @default(cuid())
                @@allow('all', auth().name in ['abc', 'bcd'])
            }
            `,
        );

        await expect(anonDb.foo.create({ data: {} })).toBeRejectedByPolicy();
        await expect(anonDb.$setAuth({ id: 'user1', name: 'abd' }).foo.create({ data: {} })).toBeRejectedByPolicy();
        await expect(anonDb.$setAuth({ id: 'user1', name: 'abc' }).foo.create({ data: {} })).toResolveTruthy();
    });

    it('supports now', async () => {
        const db = await createPolicyTestClient(
            `
            model Foo {
                id String @id @default(cuid())
                dt DateTime @default(now())
                @@allow('create,read', true)
                @@allow('update', now() >= dt)
            }
            `,
        );

        const now = new Date();

        const created = await db.foo.create({
            data: { id: '1', dt: new Date(now.getTime() + 1000) },
        });
        console.log(created);

        // violates `dt <= now()`
        await expect(db.foo.update({ where: { id: '1' }, data: { dt: now } })).toBeRejectedNotFound();
    });
});
