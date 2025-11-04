# A blog app demo for ZenStack V3

## Prerequisites

- Clone the repo
- `pnpm install` from the root
- `pnpm build` from the root

## Running the sample

- `cd samples/blog`
- `pnpm generate`
- `pnpm db:migrate`
- `pnpm dev`

## Overview

- ZModel is located in [zenstack/schema.zmodel](./zenstack/schema.zmodel).
- When you run `zenstack generate`, a TypeScript version of the schema is generated to [zenstack/schema.ts](./zenstack/schema.ts).
- A Prisma schema [zenstack/schema.prisma](./zenstack/schema.prisma) is also generated. It's used for generating and running database migrations, and you can also use it for other purposes as needed.
- You can create a database client with the TypeScript schema like:

    ```ts
    import { ZenStackClient } from '@zenstackhq/orm';
    import { schema } from './zenstack/schema';
    import SQLite from 'better-sqlite3';
    import { SqliteDialect } from 'kysely';

    const db = ZenStackClient(schema, {
        dialect: new SqliteDialect({ database: new SQLite('./zenstack/dev.db') }),
    });
    ```

- Run `zenstack migrate dev` to generate and apply database migrations. It internally calls `prisma migrate dev`. Same for `zenstack migrate deploy`.
- ZenStack v3 doesn't generate into "node_modules" anymore. The generated TypeScript schema file can be checked in to source control, and you decide how to build or bundle it with your application.
- The TS schema will also serve as the foundation of inferring types of other artifacts, e.g., zod schemas, frontend hooks, etc.

## Features

### 1. CRUD API

Replicating PrismaClient's CRUD API is around 80% done, including typing and runtime. Database access is entirely through Kysely. At runtime there's no Prisma dependency.

Not supported yet:

- `$extends`

### 2. Using Kysely expression builder to express complex queries in `where`

You can use the `$expr` key to invoke Kysely expression builder in your `where` clause. The expression built will be merged with other filter conditions and evaluated as a whole.

For example:

```ts
db.user.findMany({
    where: {
        role: 'USER',
        // `eb` is Kysely expression builder, fully typed
        $expr: (eb) => eb('email', 'like', '%@zenstack.dev'),
    },
});
```

### 3. Database-server-side computed fields

You can define computed fields in ZModel using the `@computed` attribute. E.g.:

```prisma
model User {
    ...
    /// Domain of the email address
    emailDomain String @computed
}
```

When calling `createClient`, you need to provide implementation for the computed field, using Kysely expression builder. During query, the computed field will be evaluated on the database server side and returned as part of the result.

E.g.:

```ts
import { createClient } from '@zenstackhq/orm';

const db = createClient({
    computedFields: {
        User: {
            emailDomain: (eb) =>
                // build SQL expression: substr(email, instr(email, '@') + 1)
                eb.fn('substr', [eb.ref('email'), eb(eb.fn('instr', [eb.ref('email'), eb.val('@')]), '+', 1)]),
        },
    },
});
```

You can also filter and sort on computed fields.

```ts
db.user.findMany({
    where: {
        emailDomain: 'zenstack.dev',
    },
});
```
