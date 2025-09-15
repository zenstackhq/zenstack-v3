import { describe, expect, it } from 'vitest';
import { createPolicyTestClient } from '../utils';

describe('Read policy tests', () => {
    describe('Find tests', () => {
        it('works with top-level find', async () => {
            const db = await createPolicyTestClient(
                `
model Foo {
    id Int @id
    x  Int
    @@allow('create', true)
    @@allow('read', x > 0)
}
`,
            );

            await db.$unuseAll().foo.create({ data: { id: 1, x: 0 } });
            await expect(db.foo.findUnique({ where: { id: 1 } })).toResolveNull();

            await db.$unuseAll().foo.update({ where: { id: 1 }, data: { x: 1 } });
            await expect(db.foo.findUnique({ where: { id: 1 } })).toResolveTruthy();
        });

        it('works with mutation read-back', async () => {
            const db = await createPolicyTestClient(
                `
model Foo {
    id Int @id
    x  Int
    @@allow('create,update', true)
    @@allow('read', x > 0)
}
`,
            );

            await expect(db.foo.create({ data: { id: 1, x: 0 } })).toBeRejectedByPolicy();
            await expect(db.$unuseAll().foo.count()).resolves.toBe(1);
            await expect(db.foo.update({ where: { id: 1 }, data: { x: 1 } })).resolves.toMatchObject({ x: 1 });
        });

        it('works with to-one relation optional owner-side read', async () => {
            const db = await createPolicyTestClient(
                `
model Foo {
    id Int @id
    bar Bar? @relation(fields: [barId], references: [id])
    barId Int? @unique
    @@allow('all', true)
}

model Bar {
    id Int @id
    y  Int
    foo Foo?
    @@allow('create,update', true)
    @@allow('read', y > 0)
}
`,
            );

            await db.foo.create({ data: { id: 1, bar: { create: { id: 1, y: 0 } } } });
            await expect(db.foo.findFirst({ include: { bar: true } })).resolves.toMatchObject({ id: 1, bar: null });
            await db.bar.update({ where: { id: 1 }, data: { y: 1 } });
            await expect(db.foo.findFirst({ include: { bar: true } })).resolves.toMatchObject({
                id: 1,
                bar: { id: 1 },
            });
        });

        // TODO: check if we should be consistent with v2 and filter out the parent entity
        // if a non-optional child relation is included but not readable
        it('works with to-one relation non-optional owner-side read', async () => {
            const db = await createPolicyTestClient(
                `
model Foo {
    id Int @id
    bar Bar @relation(fields: [barId], references: [id])
    barId Int @unique
    @@allow('all', true)
}

model Bar {
    id Int @id
    y  Int
    foo Foo?
    @@allow('create,update', true)
    @@allow('read', y > 0)
}
`,
            );

            await db.foo.create({ data: { id: 1, bar: { create: { id: 1, y: 0 } } } });
            await expect(db.foo.findFirst({ include: { bar: true } })).resolves.toMatchObject({ id: 1, bar: null });
            await db.bar.update({ where: { id: 1 }, data: { y: 1 } });
            await expect(db.foo.findFirst({ include: { bar: true } })).resolves.toMatchObject({
                id: 1,
                bar: { id: 1 },
            });
        });

        it('works with to-one relation non-owner-side read', async () => {
            const db = await createPolicyTestClient(
                `
model Foo {
    id Int @id
    bar Bar?
    @@allow('all', true)
}

model Bar {
    id Int @id
    y  Int
    foo Foo @relation(fields: [fooId], references: [id])
    fooId Int @unique
    @@allow('create,update', true)
    @@allow('read', y > 0)
}
`,
            );

            await db.foo.create({ data: { id: 1, bar: { create: { id: 1, y: 0 } } } });
            await expect(db.foo.findFirst({ include: { bar: true } })).resolves.toMatchObject({ id: 1, bar: null });
            await db.bar.update({ where: { id: 1 }, data: { y: 1 } });
            await expect(db.foo.findFirst({ include: { bar: true } })).resolves.toMatchObject({
                id: 1,
                bar: { id: 1 },
            });
        });

        it('works with to-many relation read', async () => {
            const db = await createPolicyTestClient(
                `
model Foo {
    id Int @id
    bars Bar[]
    @@allow('all', true)
}

model Bar {
    id Int @id
    y  Int
    foo Foo? @relation(fields: [fooId], references: [id])
    fooId Int?
    @@allow('create,update', true)
    @@allow('read', y > 0)
}
`,
            );

            await db.foo.create({
                data: {
                    id: 1,
                    bars: {
                        create: [
                            { id: 1, y: 0 },
                            { id: 2, y: 1 },
                        ],
                    },
                },
            });
            await expect(db.foo.findFirst({ include: { bars: true } })).resolves.toMatchObject({
                id: 1,
                bars: [{ id: 2 }],
            });
        });

        it('works with filtered by to-one relation field', async () => {
            const db = await createPolicyTestClient(
                `
model Foo {
    id Int @id
    bar Bar? @relation(fields: [barId], references: [id])
    barId Int? @unique
    @@allow('create', true)
    @@allow('read', bar.y > 0)
}

model Bar {
    id Int @id
    y  Int
    foo Foo?
    @@allow('all', true)
}
`,
            );

            await db.$unuseAll().foo.create({ data: { id: 1, bar: { create: { id: 1, y: 0 } } } });
            await expect(db.foo.findMany()).resolves.toHaveLength(0);
            await db.bar.update({ where: { id: 1 }, data: { y: 1 } });
            await expect(db.foo.findMany()).resolves.toHaveLength(1);
        });

        it('works with filtered by to-one relation non-null', async () => {
            const db = await createPolicyTestClient(
                `
model Foo {
    id Int @id
    bar Bar? @relation(fields: [barId], references: [id])
    barId Int? @unique
    @@allow('create,update', true)
    @@allow('read', bar != null)
    @@allow('read', this.bar != null)
}

model Bar {
    id Int @id
    y  Int
    foo Foo?
    @@allow('all', true)
}
`,
            );

            await db.$unuseAll().foo.create({ data: { id: 1 } });
            await expect(db.foo.findMany()).resolves.toHaveLength(0);
            await db.foo.update({ where: { id: 1 }, data: { bar: { create: { id: 1, y: 0 } } } });
            await expect(db.foo.findMany()).resolves.toHaveLength(1);
        });

        it('works with filtered by to-many relation', async () => {
            const db = await createPolicyTestClient(
                `
model Foo {
    id Int @id
    bars Bar[]
    @@allow('create,update', true)
    @@allow('read', bars?[y > 0])
    @@allow('read', this.bars?[y > 0])
}

model Bar {
    id Int @id
    y  Int
    foo Foo? @relation(fields: [fooId], references: [id])
    fooId Int?
    @@allow('all', true)
}
`,
            );

            await db.$unuseAll().foo.create({ data: { id: 1, bars: { create: [{ id: 1, y: 0 }] } } });
            await expect(db.foo.findMany()).resolves.toHaveLength(0);
            await db.foo.update({ where: { id: 1 }, data: { bars: { create: { id: 2, y: 1 } } } });
            await expect(db.foo.findMany()).resolves.toHaveLength(1);
        });
    });
});
