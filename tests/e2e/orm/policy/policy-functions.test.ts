import { createPolicyTestClient } from '@zenstackhq/testtools';
import { describe, expect, it } from 'vitest';

describe('policy functions tests', () => {
    it('supports contains case-sensitive', async () => {
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
        if (['sqlite', 'mysql'].includes(db.$schema.provider.type)) {
            // sqlite and mysql are always case-insensitive
            await expect(db.foo.create({ data: { string: 'Acd' } })).toResolveTruthy();
        } else {
            await expect(db.foo.create({ data: { string: 'Acd' } })).toBeRejectedByPolicy();
        }
        await expect(db.foo.create({ data: { string: 'bac' } })).toResolveTruthy();
    });

    it('escapes input for contains', async () => {
        const db = await createPolicyTestClient(
            `
            model Foo {
                id String @id @default(cuid())
                string String
                @@allow('all', contains(string, 'a%'))
            }
            `,
        );

        await expect(db.foo.create({ data: { string: 'ab' } })).toBeRejectedByPolicy();
        await expect(db.foo.create({ data: { string: 'a%' } })).toResolveTruthy();
        await expect(db.foo.create({ data: { string: 'a%b' } })).toResolveTruthy();
    });

    it('supports contains explicit case-sensitive', async () => {
        const db = await createPolicyTestClient(
            `
            model Foo {
                id String @id @default(cuid())
                string String
                @@allow('all', contains(string, 'a', false))
            }
            `,
        );

        await expect(db.foo.create({ data: { string: 'bcd' } })).toBeRejectedByPolicy();
        if (['sqlite', 'mysql'].includes(db.$schema.provider.type)) {
            // sqlite and mysql are always case-insensitive
            await expect(db.foo.create({ data: { string: 'Acd' } })).toResolveTruthy();
        } else {
            await expect(db.foo.create({ data: { string: 'Acd' } })).toBeRejectedByPolicy();
        }
        await expect(db.foo.create({ data: { string: 'bac' } })).toResolveTruthy();
    });

    it('supports contains case-insensitive', async () => {
        const db = await createPolicyTestClient(
            `
            model Foo {
                id String @id @default(cuid())
                string String
                @@allow('all', contains(string, 'a', true))
            }
            `,
        );

        await expect(db.foo.create({ data: { string: 'bcd' } })).toBeRejectedByPolicy();
        await expect(db.foo.create({ data: { string: 'Abc' } })).toResolveTruthy();
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
        if (['sqlite', 'mysql'].includes(db.$schema.provider.type)) {
            // sqlite and mysql are always case-insensitive
            await expect(db.$setAuth({ id: 'user1', name: 'Abc' }).foo.create({ data: {} })).toResolveTruthy();
        } else {
            await expect(db.$setAuth({ id: 'user1', name: 'Abc' }).foo.create({ data: {} })).toBeRejectedByPolicy();
        }
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

    it('escapes input for startsWith', async () => {
        const db = await createPolicyTestClient(
            `
            model Foo {
                id String @id @default(cuid())
                string String
                @@allow('all', startsWith(string, '%a'))
            }
            `,
        );

        await expect(db.foo.create({ data: { string: 'ba' } })).toBeRejectedByPolicy();
        await expect(db.foo.create({ data: { string: '%a' } })).toResolveTruthy();
        await expect(db.foo.create({ data: { string: '%ab' } })).toResolveTruthy();
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
