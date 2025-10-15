import { createPolicyTestClient } from '@zenstackhq/testtools';
import { describe, expect, it } from 'vitest';

describe('Delegate interaction tests', () => {
    it('inherits policies from delegate base models', async () => {
        const db = await createPolicyTestClient(
            `
model A {
  id Int @id @default(autoincrement())
  a Int
  aType String
  @@delegate(aType)
  @@allow('all', true)
  @@deny('all', a <= 0)
}

model B extends A {
  b Int
  bType String
  @@delegate(bType)
  @@deny('all', b <= 0)
}

model C extends B {
  c Int
  @@deny('all', c <= 0)
}
`,
        );

        await expect(db.c.create({ data: { a: 0, b: 1, c: 1 } })).toBeRejectedByPolicy();
        await expect(db.c.create({ data: { a: 1, b: 0, c: 1 } })).toBeRejectedByPolicy();
        await expect(db.c.create({ data: { a: 1, b: 1, c: 0 } })).toBeRejectedByPolicy();
        await expect(db.c.create({ data: { a: 1, b: 1, c: 1 } })).toResolveTruthy();

        // clean up
        await db.c.deleteMany();

        await db.$unuseAll().c.create({ data: { id: 2, a: 0, b: 0, c: 1 } });
        await expect(db.a.findUnique({ where: { id: 2 } })).toResolveNull();
        await expect(db.b.findUnique({ where: { id: 2 } })).toResolveNull();
        await expect(db.c.findUnique({ where: { id: 2 } })).toResolveNull();

        await db.$unuseAll().c.update({ where: { id: 2 }, data: { a: 1, b: 1, c: 1 } });
        await expect(db.a.findUnique({ where: { id: 2 } })).toResolveTruthy();
        await expect(db.b.findUnique({ where: { id: 2 } })).toResolveTruthy();
        await expect(db.c.findUnique({ where: { id: 2 } })).toResolveTruthy();
    });

    it('works with policies referencing base model fields', async () => {
        const db = await createPolicyTestClient(
            `
model A {
  id Int @id @default(autoincrement())
  a Int
  aType String
  @@delegate(aType)
  @@allow('all', a > 0)
}

model B extends A {
  b Int
  c C @relation(fields: [cId], references: [id])
  cId Int
}

model C {
  id Int @id @default(autoincrement())
  bs B[]
  @@allow('all', true)
}
`,
        );

        await expect(
            db.c.create({
                data: {
                    bs: {
                        create: [
                            { a: 0, b: 0 },
                            { a: 1, b: 1 },
                        ],
                    },
                },
            }),
        ).toBeRejectedByPolicy();
        await expect(db.$unuseAll().b.count()).resolves.toBe(0);

        await db.$unuseAll().c.create({
            data: {
                bs: {
                    create: [
                        { id: 1, a: 0, b: 0 },
                        { id: 2, a: 1, b: 1 },
                    ],
                },
            },
        });

        await expect(db.c.findFirst({ include: { bs: true } })).resolves.toMatchObject({
            bs: [{ a: 1 }],
        });
        await expect(db.b.update({ where: { id: 1 }, data: { b: 2 } })).toBeRejectedNotFound();
        await expect(db.b.update({ where: { id: 2 }, data: { b: 2 } })).toResolveTruthy();
    });

    it('works with policies referencing base model relations', async () => {
        const db = await createPolicyTestClient(
            `
model A {
  id Int @id @default(autoincrement())
  aType String
  c C @relation(fields: [cId], references: [id])
  cId Int
  @@delegate(aType)
  @@allow('all', true)
}

model C {
  id Int @id @default(autoincrement())
  c Int
  as A[]
  @@allow('all', true)
}

model B extends A {
  b Int
  @@deny('update', c.c <= 0)
}
`,
        );

        await db.b.create({
            data: { id: 1, b: 0, c: { create: { c: 0 } } },
        });
        await expect(db.b.update({ where: { id: 1 }, data: { b: 1 } })).toBeRejectedNotFound();

        await db.b.create({
            data: { id: 2, b: 0, c: { create: { c: 1 } } },
        });
        await expect(db.b.update({ where: { id: 2 }, data: { b: 1 } })).toResolveTruthy();
    });

    it('works with policies using check on relation fields on delegate base models', async () => {
        const db = await createPolicyTestClient(
            `
model A {
  id Int @id @default(autoincrement())
  aType String
  c C?
  @@delegate(aType)
  @@allow('all', true)
}

model B extends A {
  b Int
  @@deny('read', !check(c))
}

model C {
  id Int @id @default(autoincrement())
  c Int
  a A @relation(fields: [aId], references: [id])
  aId Int @unique
  @@allow('read', c > 0)
  @@allow('create', true)
}
        `,
        );

        await db.$unuseAll().b.create({ data: { id: 1, b: 1, c: { create: { c: 0 } } } });
        await expect(db.b.findUnique({ where: { id: 1 } })).resolves.toBeNull();
        await db.$unuseAll().b.create({ data: { id: 2, b: 2, c: { create: { c: 1 } } } });
        await expect(db.b.findUnique({ where: { id: 2 } })).toResolveTruthy();
    });
});
