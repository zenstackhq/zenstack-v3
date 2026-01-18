import { ORMError } from '@zenstackhq/orm';
import { createTestClient } from '@zenstackhq/testtools';
import { describe, expect, it } from 'vitest';

describe('Postgres custom schema support', () => {
    it('defaults to public schema for ORM queries', async () => {
        const foundSchema = { create: false, read: false, update: false, delete: false };
        const db = await createTestClient(
            `
model Foo {
    id Int @id
    name String
}
`,
            {
                provider: 'postgresql',
                log: (event) => {
                    const sql = event.query.sql.toLowerCase();
                    if (sql.includes('"public"."foo"')) {
                        sql.includes('insert') && (foundSchema.create = true);
                        sql.includes('select') && (foundSchema.read = true);
                        sql.includes('update') && (foundSchema.update = true);
                        sql.includes('delete') && (foundSchema.delete = true);
                    }
                },
            },
        );

        await expect(db.foo.create({ data: { id: 1, name: 'test' } })).toResolveTruthy();
        await expect(db.foo.findFirst()).toResolveTruthy();
        await expect(db.foo.update({ where: { id: 1 }, data: { name: 'updated' } })).toResolveTruthy();
        await expect(db.foo.delete({ where: { id: 1 } })).toResolveTruthy();

        expect(foundSchema).toEqual({ create: true, read: true, update: true, delete: true });
    });

    it('defaults to public schema for QB queries', async () => {
        const foundSchema = { create: false, read: false, update: false, delete: false };
        const db = await createTestClient(
            `
enum Role {
    ADMIN
    USER
}

model Foo {
    id Int @id
    name String
    role Role
}
`,
            {
                provider: 'postgresql',
                log: (event) => {
                    const sql = event.query.sql.toLowerCase();
                    if (sql.includes('"public"."foo"')) {
                        sql.includes('insert') && (foundSchema.create = true);
                        sql.includes('select') && (foundSchema.read = true);
                        sql.includes('update') && (foundSchema.update = true);
                        sql.includes('delete') && (foundSchema.delete = true);
                    }
                },
            },
        );

        await expect(
            db.$qb.insertInto('Foo').values({ id: 1, name: 'test', role: 'ADMIN' }).execute(),
        ).toResolveTruthy();
        await expect(db.$qb.selectFrom('Foo').selectAll().executeTakeFirst()).toResolveTruthy();
        await expect(
            db.$qb.updateTable('Foo').set({ name: 'updated' }).where('id', '=', 1).execute(),
        ).toResolveTruthy();
        await expect(db.$qb.deleteFrom('Foo').where('id', '=', 1).execute()).toResolveTruthy();

        expect(foundSchema).toEqual({ create: true, read: true, update: true, delete: true });
    });

    it('supports changing default schema', async () => {
        const db = await createTestClient(
            `
datasource db {
    provider = 'postgresql'
    defaultSchema = 'mySchema'
}

enum Role {
    ADMIN
    USER
}

model Foo {
    id Int @id
    name String
    role Role
}
`,
            {
                provider: 'postgresql',
            },
        );

        await expect(db.foo.create({ data: { id: 1, name: 'test', role: 'ADMIN' } })).rejects.toSatisfy(
            (e) => e instanceof ORMError && !!e.dbErrorMessage?.includes('relation "mySchema.Foo" does not exist'),
        );

        await db.$disconnect();

        const db1 = await createTestClient(
            `
datasource db {
    provider = 'postgresql'
    defaultSchema = 'public'
}

enum Role {
    ADMIN
    USER
}

model Foo {
    id Int @id
    name String
    role Role
}
`,
            {
                provider: 'postgresql',
            },
        );

        await expect(db1.foo.create({ data: { id: 1, name: 'test', role: 'ADMIN' } })).toResolveTruthy();
    });

    it('supports custom schemas', async () => {
        let fooQueriesVerified = false;
        let barQueriesVerified = false;

        const db = await createTestClient(
            `
datasource db {
    provider = '$PROVIDER'
    schemas = ['public', 'mySchema']
    url = '$DB_URL'
}

enum FooRole {
    ADMIN
    USER
    @@schema('mySchema')
}

model Foo {
    id Int @id
    name String
    role FooRole
    @@schema('mySchema')
}

enum BarRole {
    ADMIN
    USER
    @@schema('mySchema')
}

model Bar {
    id Int @id
    name String
    role BarRole
    @@schema('public')
}
`,
            {
                provider: 'postgresql',
                usePrismaPush: true,
                log: (event) => {
                    const sql = event.query.sql.toLowerCase();
                    if (sql.includes('"myschema"."foo"')) {
                        fooQueriesVerified = true;
                    }
                    if (sql.includes('"public"."bar"')) {
                        barQueriesVerified = true;
                    }
                },
            },
        );

        await expect(db.foo.create({ data: { id: 1, name: 'test', role: 'ADMIN' } })).toResolveTruthy();
        await expect(db.bar.create({ data: { id: 1, name: 'test', role: 'USER' } })).toResolveTruthy();

        expect(fooQueriesVerified).toBe(true);
        expect(barQueriesVerified).toBe(true);
    });

    it('rejects using schema for non-postgresql providers', async () => {
        await expect(
            createTestClient(
                `
datasource db {
    provider = 'sqlite'
    defaultSchema = 'mySchema'
}

model Foo {
    id Int @id
    name String
}
`,
            ),
        ).rejects.toThrow('only supported for "postgresql" provider');
    });

    it('rejects using schema not defined in datasource', async () => {
        await expect(
            createTestClient(
                `
datasource db {
    provider = 'postgresql'
    schemas = ['public']
}

model Foo {
    id Int @id
    name String
    @@schema('mySchema')
}
`,
            ),
        ).rejects.toThrow('Schema "mySchema" is not defined in the datasource');
    });

    it('requires defaultSchema to be included in schemas', async () => {
        await expect(
            createTestClient(
                `
datasource db {
    provider = 'postgresql'
    defaultSchema = 'mySchema'
    schemas = ['public']
}

model Foo {
    id Int @id
    name String
}
`,
            ),
        ).rejects.toThrow('"mySchema" must be included in the "schemas" array');
    });

    it('requires implicit public schema to be included in schemas', async () => {
        await expect(
            createTestClient(
                `
datasource db {
    provider = 'postgresql'
    schemas = ['mySchema']
    url = '$DB_URL'
}

enum Role {
    ADMIN
    USER
}

model Foo {
    id Int @id
    name String
    role Role
    @@schema('mySchema')
}

model Bar {
    id Int @id
    name String
}
`,
            ),
        ).rejects.toThrow('"public" must be included in the "schemas" array');
    });

    it('does not require public schema when all models and enums have explicit schema', async () => {
        const db = await createTestClient(
            `
datasource db {
    provider = 'postgresql'
    schemas = ['mySchema']
    url = '$DB_URL'
}

enum Role {
    ADMIN
    USER
    @@schema('mySchema')
}

model Foo {
    id Int @id
    name String
    role Role
    @@schema('mySchema')
}

model Bar {
    id Int @id
    name String
    @@schema('mySchema')
}
`,
            {
                provider: 'postgresql',
                usePrismaPush: true,
            },
        );

        await expect(db.foo.create({ data: { id: 1, name: 'test', role: 'ADMIN' } })).toResolveTruthy();
        await expect(db.bar.create({ data: { id: 1, name: 'test' } })).toResolveTruthy();
    });

    it('allows specifying schema only on a few models', async () => {
        let fooQueriesVerified = false;
        let barQueriesVerified = false;

        const db = await createTestClient(
            `
datasource db {
    provider = 'postgresql'
    defaultSchema = 'somedefault'
    schemas = ['mySchema', 'somedefault']
    url = '$DB_URL'
}

enum Role {
    ADMIN
    USER
}

model Foo {
    id Int @id
    name String
    role Role
    @@schema('mySchema')
}

model Bar {
    id Int @id
    name String
}
`,
            {
                provider: 'postgresql',
                usePrismaPush: true,
                log: (event) => {
                    const sql = event.query.sql.toLowerCase();
                    if (sql.includes('"myschema"."foo"')) {
                        fooQueriesVerified = true;
                    }
                    if (sql.includes('"somedefault"."bar"')) {
                        barQueriesVerified = true;
                    }
                },
            },
        );

        await expect(db.foo.create({ data: { id: 1, name: 'test', role: 'ADMIN' } })).toResolveTruthy();
        await expect(db.bar.create({ data: { id: 1, name: 'test' } })).toResolveTruthy();

        expect(fooQueriesVerified).toBe(true);
        expect(barQueriesVerified).toBe(true);
    });
});
