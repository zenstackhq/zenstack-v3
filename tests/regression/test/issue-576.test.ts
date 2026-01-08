import { createTestClient } from '@zenstackhq/testtools';
import { describe, expect, it } from 'vitest';

describe('regression test for issue 576', async () => {
    it('should support enum array fields', async () => {
        const db = await createTestClient(
            `
enum Tag {
    TAG1
    TAG2
    TAG3
}

model Foo {
    id Int @id
    tags Tag[]
    bar Bar?
}

model Bar {
    id Int @id
    fooId Int @unique
    foo Foo @relation(fields: [fooId], references: [id])
}
`,
            { provider: 'postgresql', usePrismaPush: true },
        );

        await expect(
            db.foo.create({
                data: {
                    id: 1,
                    tags: ['TAG1', 'TAG2'],
                },
            }),
        ).resolves.toMatchObject({ id: 1, tags: ['TAG1', 'TAG2'] });
        await expect(
            db.foo.update({
                where: { id: 1 },
                data: {
                    tags: { set: ['TAG2', 'TAG3'] },
                },
            }),
        ).resolves.toMatchObject({ id: 1, tags: ['TAG2', 'TAG3'] });

        await expect(db.foo.findFirst()).resolves.toMatchObject({ tags: ['TAG2', 'TAG3'] });
        await expect(db.foo.findFirst({ where: { tags: { equals: ['TAG2', 'TAG3'] } } })).resolves.toMatchObject({
            tags: ['TAG2', 'TAG3'],
        });
        await expect(db.foo.findFirst({ where: { tags: { has: 'TAG1' } } })).toResolveNull();

        // nested create
        await expect(
            db.bar.create({
                data: { id: 1, foo: { create: { id: 2, tags: ['TAG1'] } } },
                include: { foo: true },
            }),
        ).resolves.toMatchObject({ foo: expect.objectContaining({ tags: ['TAG1'] }) });

        // nested find
        await expect(
            db.bar.findFirst({
                where: { foo: { tags: { has: 'TAG1' } } },
                include: { foo: true },
            }),
        ).resolves.toMatchObject({ foo: expect.objectContaining({ tags: ['TAG1'] }) });

        await expect(
            db.bar.findFirst({
                where: { foo: { tags: { equals: ['TAG2'] } } },
            }),
        ).toResolveNull();
    });

    it('should support enum array stored in JSON field', async () => {
        const db = await createTestClient(
            `
enum Tag {
    TAG1
    TAG2
    TAG3
}

model Foo {
    id Int @id
    tags Json
}
`,
            { provider: 'postgresql', usePrismaPush: true },
        );

        await expect(
            db.foo.create({
                data: {
                    id: 1,
                    tags: ['TAG1', 'TAG2'],
                },
            }),
        ).resolves.toMatchObject({ id: 1, tags: ['TAG1', 'TAG2'] });
        await expect(db.foo.findFirst()).resolves.toMatchObject({ tags: ['TAG1', 'TAG2'] });
    });

    it('should support enum array stored in JSON array field', async () => {
        const db = await createTestClient(
            `
enum Tag {
    TAG1
    TAG2
    TAG3
}

model Foo {
    id Int @id
    tags Json[]
}
`,
            { provider: 'postgresql', usePrismaPush: true },
        );

        await expect(
            db.foo.create({
                data: {
                    id: 1,
                    tags: ['TAG1', 'TAG2'],
                },
            }),
        ).resolves.toMatchObject({ id: 1, tags: ['TAG1', 'TAG2'] });
        await expect(db.foo.findFirst()).resolves.toMatchObject({ tags: ['TAG1', 'TAG2'] });
    });

    it('should support enum with datasource defined default pg schema', async () => {
        const db = await createTestClient(
            `
datasource db {
    provider = 'postgresql'
    schemas = ['public', 'mySchema']
    url = '$DB_URL'
    defaultSchema = 'mySchema'
}            

enum Tag {
    TAG1
    TAG2
    TAG3
}

model Foo {
    id Int @id
    tags Tag[]
}
`,
            { provider: 'postgresql', usePrismaPush: true },
        );

        await expect(
            db.foo.create({
                data: {
                    id: 1,
                    tags: ['TAG1', 'TAG2'],
                },
            }),
        ).resolves.toMatchObject({ id: 1, tags: ['TAG1', 'TAG2'] });
        await expect(db.foo.findFirst()).resolves.toMatchObject({ tags: ['TAG1', 'TAG2'] });
    });

    it('should support enum with custom pg schema', async () => {
        const db = await createTestClient(
            `
datasource db {
    provider = 'postgresql'
    schemas = ['public', 'mySchema']
    url = '$DB_URL'
}            

enum Tag {
    TAG1
    TAG2
    TAG3
    @@schema('mySchema')
}

model Foo {
    id Int @id
    tags Tag[]
}
`,
            { provider: 'postgresql', usePrismaPush: true },
        );

        await expect(
            db.foo.create({
                data: {
                    id: 1,
                    tags: ['TAG1', 'TAG2'],
                },
            }),
        ).resolves.toMatchObject({ id: 1, tags: ['TAG1', 'TAG2'] });
        await expect(db.foo.findFirst()).resolves.toMatchObject({ tags: ['TAG1', 'TAG2'] });
    });
});
