import { describe, expect, it } from 'vitest';
import { createPolicyTestClient } from '../utils';

describe('Update policy tests', () => {
    it('works with scalar field check', async () => {
        const db = await createPolicyTestClient(
            `
model Foo {
    id Int @id
    x  Int
    @@allow('update', x > 0)
    @@allow('create,read', true)
}
`,
        );

        await db.foo.create({ data: { id: 1, x: 0 } });
        await expect(db.foo.update({ where: { id: 1 }, data: { x: 1 } })).toBeRejectedNotFound();
        await db.foo.create({ data: { id: 2, x: 1 } });
        await expect(db.foo.update({ where: { id: 2 }, data: { x: 2 } })).resolves.toMatchObject({ x: 2 });

        await expect(
            db.$qb.updateTable('Foo').set({ x: 1 }).where('id', '=', 1).executeTakeFirst(),
        ).resolves.toMatchObject({ numUpdatedRows: 0n });
        await expect(
            db.$qb.updateTable('Foo').set({ x: 3 }).where('id', '=', 2).returningAll().execute(),
        ).resolves.toMatchObject([{ id: 2, x: 3 }]);
    });

    it('works with this scalar member check', async () => {
        const db = await createPolicyTestClient(
            `
model Foo {
    id Int @id
    x  Int
    @@allow('update', this.x > 0)
    @@allow('create,read', true)
}
`,
        );

        await db.foo.create({ data: { id: 1, x: 0 } });
        await expect(db.foo.update({ where: { id: 1 }, data: { x: 1 } })).toBeRejectedNotFound();
        await db.foo.create({ data: { id: 2, x: 1 } });
        await expect(db.foo.update({ where: { id: 2 }, data: { x: 2 } })).resolves.toMatchObject({ x: 2 });
    });

    it('denies by default', async () => {
        const db = await createPolicyTestClient(
            `
model Foo {
    id Int @id
    x  Int
    @@allow('create,read', true)
}
`,
        );

        await db.foo.create({ data: { id: 1, x: 0 } });
        await expect(db.foo.update({ where: { id: 1 }, data: { x: 1 } })).toBeRejectedNotFound();
    });

    it('works with deny rule', async () => {
        const db = await createPolicyTestClient(
            `
model Foo {
    id Int @id
    x  Int
    @@deny('update', x <= 0)
    @@allow('create,read,update', true)
}
`,
        );
        await db.foo.create({ data: { id: 1, x: 0 } });
        await expect(db.foo.update({ where: { id: 1 }, data: { x: 1 } })).toBeRejectedNotFound();
        await db.foo.create({ data: { id: 2, x: 1 } });
        await expect(db.foo.update({ where: { id: 2 }, data: { x: 2 } })).resolves.toMatchObject({ x: 2 });
    });

    it('works with mixed allow and deny rules', async () => {
        const db = await createPolicyTestClient(
            `
model Foo {
    id Int @id
    x  Int
    @@deny('update', x <= 0)
    @@allow('update', x <= 0 || x > 1)
    @@allow('create,read', true)
}
`,
        );

        await db.foo.create({ data: { id: 1, x: 0 } });
        await expect(db.foo.update({ where: { id: 1 }, data: { x: 1 } })).toBeRejectedNotFound();
        await db.foo.create({ data: { id: 2, x: 1 } });
        await expect(db.foo.update({ where: { id: 2 }, data: { x: 2 } })).toBeRejectedNotFound();
        await db.foo.create({ data: { id: 3, x: 2 } });
        await expect(db.foo.update({ where: { id: 3 }, data: { x: 3 } })).resolves.toMatchObject({ x: 3 });
    });

    it('works with auth check', async () => {
        const db = await createPolicyTestClient(
            `
type Auth {
    x Int
    @@auth
}

model Foo {
    id Int @id
    x  Int
    @@allow('update', x == auth().x)
    @@allow('create,read', true)
}
`,
        );
        await db.foo.create({ data: { id: 1, x: 1 } });
        await expect(db.$setAuth({ x: 0 }).foo.update({ where: { id: 1 }, data: { x: 2 } })).toBeRejectedNotFound();
        await expect(db.$setAuth({ x: 1 }).foo.update({ where: { id: 1 }, data: { x: 2 } })).resolves.toMatchObject({
            x: 2,
        });
    });
});
