import { describe, expect, it } from 'vitest';
import { createPolicyTestClient } from '@zenstackhq/testtools';

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
            await db.$unuseAll().foo.update({ where: { id: 1 }, data: { x: 1 } });
            await expect(db.foo.update({ where: { id: 1 }, data: { x: 2 } })).resolves.toMatchObject({ x: 2 });
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
            await db.$unuseAll().bar.update({ where: { id: 1 }, data: { y: 1 } });
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
            await db.$unuseAll().bar.update({ where: { id: 1 }, data: { y: 1 } });
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
            await db.$unuseAll().bar.update({ where: { id: 1 }, data: { y: 1 } });
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

        it('works with unnamed many-to-many relation read', async () => {
            const db = await createPolicyTestClient(
                `
model User {
    id Int @id
    groups Group[]
    @@allow('all', true)
}

model Group {
    id Int @id
    private Boolean
    users User[]
    @@allow('read', !private)
}
`,
                { usePrismaPush: true },
            );

            await db.$unuseAll().user.create({
                data: {
                    id: 1,
                    groups: {
                        create: [
                            { id: 1, private: true },
                            { id: 2, private: false },
                        ],
                    },
                },
            });
            await expect(db.user.findFirst({ include: { groups: true } })).resolves.toMatchObject({
                groups: [{ id: 2 }],
            });
            await expect(
                db.user.findFirst({ where: { id: 1 }, select: { _count: { select: { groups: true } } } }),
            ).resolves.toMatchObject({
                _count: { groups: 1 },
            });
        });

        it('works with named many-to-many relation read', async () => {
            const db = await createPolicyTestClient(
                `
model User {
    id Int @id
    groups Group[] @relation("UserGroups")
    @@allow('all', true)
}

model Group {
    id Int @id
    private Boolean
    users User[] @relation("UserGroups")
    @@allow('read', !private)
}
`,
                { usePrismaPush: true },
            );

            await db.$unuseAll().user.create({
                data: {
                    id: 1,
                    groups: {
                        create: [
                            { id: 1, private: true },
                            { id: 2, private: false },
                        ],
                    },
                },
            });
            await expect(db.user.findFirst({ include: { groups: true } })).resolves.toMatchObject({
                groups: [{ id: 2 }],
            });
            await expect(
                db.user.findFirst({ where: { id: 1 }, select: { _count: { select: { groups: true } } } }),
            ).resolves.toMatchObject({
                _count: { groups: 1 },
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
            await db.$unuseAll().foo.update({ where: { id: 1 }, data: { bar: { create: { id: 1, y: 0 } } } });
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
            await db.$unuseAll().foo.update({ where: { id: 1 }, data: { bars: { create: { id: 2, y: 1 } } } });
            await expect(db.foo.findMany()).resolves.toHaveLength(1);
        });

        it('works with counting relations', async () => {
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

            await db.$unuseAll().foo.create({
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
            await expect(
                db.foo.findFirst({ where: { id: 1 }, select: { _count: { select: { bars: true } } } }),
            ).resolves.toMatchObject({ _count: { bars: 1 } });
        });
    });

    describe('Count tests', () => {
        it('works with top-level count', async () => {
            const db = await createPolicyTestClient(
                `
model Foo {
    id Int @id
    x  Int
    name String
    @@allow('create', true)
    @@allow('read', x > 0)
}
`,
            );

            await db.$unuseAll().foo.create({ data: { id: 1, x: 0, name: 'Foo1' } });
            await db.$unuseAll().foo.create({ data: { id: 2, x: 0, name: 'Foo2' } });
            await expect(db.foo.count()).resolves.toBe(0);
            await expect(db.foo.count({ select: { _all: true, name: true } })).resolves.toEqual({ _all: 0, name: 0 });

            await db.$unuseAll().foo.update({ where: { id: 1 }, data: { x: 1 } });
            await expect(db.foo.count()).resolves.toBe(1);
            await expect(db.foo.count({ select: { _all: true, name: true } })).resolves.toEqual({ _all: 1, name: 1 });
        });
    });

    describe('Aggregate tests', () => {
        it('respects read policies', async () => {
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
            await db.$unuseAll().foo.create({ data: { id: 2, x: 1 } });
            await db.$unuseAll().foo.create({ data: { id: 3, x: 3 } });

            await expect(
                db.foo.aggregate({
                    _count: true,
                    _sum: { x: true },
                    _avg: { x: true },
                    _min: { x: true },
                    _max: { x: true },
                }),
            ).resolves.toEqual({
                _count: 2,
                _sum: { x: 4 },
                _avg: { x: 2 },
                _min: { x: 1 },
                _max: { x: 3 },
            });
        });
    });

    describe('GroupBy tests', () => {
        it('respects read policies', async () => {
            const db = await createPolicyTestClient(
                `
model Foo {
    id Int @id
    x  Int
    y  Int
    @@allow('create', true)
    @@allow('read', x > 0)
}
`,
            );

            await db.$unuseAll().foo.create({ data: { id: 1, x: 0, y: 1 } });
            await db.$unuseAll().foo.create({ data: { id: 2, x: 1, y: 1 } });
            await db.$unuseAll().foo.create({ data: { id: 3, x: 3, y: 2 } });
            await db.$unuseAll().foo.create({ data: { id: 4, x: 5, y: 2 } });

            await expect(
                db.foo.groupBy({
                    by: ['y'],
                    _count: { _all: true },
                    _sum: { x: true },
                    _avg: { x: true },
                    _min: { x: true },
                    _max: { x: true },
                    orderBy: { y: 'asc' },
                }),
            ).resolves.toEqual([
                {
                    y: 1,
                    _count: { _all: 1 },
                    _sum: { x: 1 },
                    _avg: { x: 1 },
                    _min: { x: 1 },
                    _max: { x: 1 },
                },
                {
                    y: 2,
                    _count: { _all: 2 },
                    _sum: { x: 8 },
                    _avg: { x: 4 },
                    _min: { x: 3 },
                    _max: { x: 5 },
                },
            ]);
        });
    });

    describe('Query builder tests', () => {
        it('works with simple selects', async () => {
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
            await db.$unuseAll().foo.create({ data: { id: 2, x: 1 } });

            await expect(db.$qb.selectFrom('Foo').selectAll().execute()).resolves.toHaveLength(1);
            await expect(db.$qb.selectFrom('Foo as f').selectAll().execute()).resolves.toHaveLength(1);
            await expect(db.$qb.selectFrom('Foo').selectAll().execute()).resolves.toHaveLength(1);
            await expect(db.$qb.selectFrom('Foo').where('id', '=', 1).selectAll().execute()).resolves.toHaveLength(0);

            // nested query
            await expect(
                db.$qb
                    .selectFrom((eb: any) => eb.selectFrom('Foo').selectAll().as('f'))
                    .selectAll()
                    .execute(),
            ).resolves.toHaveLength(1);
            await expect(
                db.$qb
                    .selectFrom((eb: any) => eb.selectFrom('Foo').selectAll().as('f'))
                    .selectAll()
                    .where('f.id', '=', 1)
                    .execute(),
            ).resolves.toHaveLength(0);
        });

        it('works with joins', async () => {
            const db = await createPolicyTestClient(
                `
model Foo {
    id Int @id
    x  Int
    bars Bar[]
    @@allow('create', true)
    @@allow('read', x > 0)
}

model Bar {
    id Int @id
    y  Int
    foo Foo? @relation(fields: [fooId], references: [id])
    fooId Int?
    @@allow('create', true)
    @@allow('read', y > 0)
}
`,
            );

            await db.$unuseAll().foo.create({
                data: {
                    id: 1,
                    x: 1,
                    bars: {
                        create: [
                            { id: 1, y: 0 },
                            { id: 2, y: 1 },
                        ],
                    },
                },
            });
            await db.$unuseAll().foo.create({
                data: {
                    id: 2,
                    x: 0,
                    bars: {
                        create: { id: 3, y: 1 },
                    },
                },
            });

            // direct join
            await expect(
                db.$qb.selectFrom('Foo').innerJoin('Bar', 'Bar.fooId', 'Foo.id').select(['Foo.id', 'x', 'y']).execute(),
            ).resolves.toEqual([expect.objectContaining({ id: 1, x: 1, y: 1 })]);

            // through alias
            await expect(
                db.$qb
                    .selectFrom('Foo as f')
                    .innerJoin(
                        (eb: any) => eb.selectFrom('Bar').selectAll().as('b'),
                        (join: any) => join.onRef('b.fooId', '=', 'f.id'),
                    )
                    .select(['f.id', 'x', 'y'])
                    .execute(),
            ).resolves.toEqual([expect.objectContaining({ id: 1, x: 1, y: 1 })]);
        });

        it('works with implicit cross join', async () => {
            const db = await createPolicyTestClient(
                `
model Foo {
    id Int @id
    x  Int
    @@allow('create', true)
    @@allow('read', x > 0)
}

model Bar {
    id Int @id
    y  Int
    @@allow('create', true)
    @@allow('read', y > 0)
}
`,
                { provider: 'postgresql', dbName: 'policy-test-implicit-cross-join' },
            );

            await db.$unuseAll().foo.createMany({
                data: [
                    { id: 1, x: 1 },
                    { id: 2, x: 0 },
                ],
            });
            await db.$unuseAll().bar.createMany({
                data: [
                    { id: 1, y: 1 },
                    { id: 2, y: 0 },
                ],
            });

            await expect(
                db.$qb.selectFrom(['Foo', 'Bar']).select(['Foo.id as fooId', 'Bar.id as barId', 'x', 'y']).execute(),
            ).resolves.toEqual([
                {
                    fooId: 1,
                    barId: 1,
                    x: 1,
                    y: 1,
                },
            ]);
        });

        it('works with update from', async () => {
            const db = await createPolicyTestClient(
                `
model Foo {
    id Int @id
    x  Int
    @@allow('all', true)
}

model Bar {
    id Int @id
    y  Int
    @@allow('read', y > 0)
}
`,
                { provider: 'postgresql' },
            );

            if (db.$schema.provider.type !== 'postgresql') {
                // skip for non-postgresql as from is only supported there
                return;
            }

            await db.$unuseAll().foo.create({ data: { id: 1, x: 1 } });
            await db.$unuseAll().bar.create({ data: { id: 1, y: 0 } });

            // update with from, only one row is visible
            await expect(
                db.$qb
                    .updateTable('Foo')
                    .from('Bar as bar')
                    .whereRef('Foo.id', '=', 'bar.id')
                    .set((eb: any) => ({ x: eb.ref('bar.y') }))
                    .executeTakeFirst(),
            ).resolves.toMatchObject({ numUpdatedRows: 0n });
            await expect(db.foo.findFirst()).resolves.toMatchObject({ x: 1 });

            await db.$unuseAll().bar.update({ where: { id: 1 }, data: { y: 2 } });
            await expect(
                db.$qb
                    .updateTable('Foo')
                    .from('Bar as bar')
                    .whereRef('Foo.id', '=', 'bar.id')
                    .set((eb: any) => ({ x: eb.ref('bar.y') }))
                    .executeTakeFirst(),
            ).resolves.toMatchObject({ numUpdatedRows: 1n });
            await expect(db.foo.findFirst()).resolves.toMatchObject({ x: 2 });
        });

        it('works with delete using', async () => {
            const db = await createPolicyTestClient(
                `
model Foo {
    id Int @id
    x  Int
    @@allow('all', true)
}

model Bar {
    id Int @id
    y  Int
    @@allow('read', y > 0)
}
`,
                { provider: 'postgresql', dbName: 'policy-test-delete-using' },
            );

            await db.$unuseAll().foo.create({ data: { id: 1, x: 1 } });
            await db.$unuseAll().bar.create({ data: { id: 1, y: 0 } });

            await expect(
                db.$qb.deleteFrom('Foo').using('Bar as bar').whereRef('Foo.id', '=', 'bar.id').executeTakeFirst(),
            ).resolves.toMatchObject({ numDeletedRows: 0n });
            await expect(db.foo.findFirst()).resolves.toBeTruthy();

            await db.$unuseAll().bar.update({ where: { id: 1 }, data: { y: 2 } });
            await expect(
                db.$qb.deleteFrom('Foo').using('Bar as bar').whereRef('Foo.id', '=', 'bar.id').executeTakeFirst(),
            ).resolves.toMatchObject({ numDeletedRows: 1n });
            await expect(db.foo.findFirst()).resolves.toBeNull();
        });
    });
});
