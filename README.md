<div align="center">
    <a href="https://zenstack.dev">
    <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/zenstackhq/zenstack-docs/main/static/img/logo-dark.png">
    <img src="https://raw.githubusercontent.com/zenstackhq/zenstack-docs/main/static/img/logo.png" height="128">
    </picture>
    </a>
    <h1>ZenStack V3</h1>
    <img src="https://github.com/zenstackhq/zenstack-v3/actions/workflows/build-test.yml/badge.svg">
    <a href="https://twitter.com/zenstackhq">
        <img src="https://img.shields.io/twitter/url?style=social&url=https%3A%2F%2Fgithub.com%2Fzenstackhq%2Fzenstack">
    </a>
    <a href="https://discord.gg/Ykhr738dUe">
        <img src="https://img.shields.io/discord/1035538056146595961">
    </a>
    <a href="https://github.com/zenstackhq/zenstack/blob/main/LICENSE">
        <img src="https://img.shields.io/badge/license-MIT-green">
    </a>
</div>

> V3 is currently in alpha phase and not ready for production use. Feedback and bug reports are greatly appreciated. Please visit this dedicated [discord channel](https://discord.com/channels/1035538056146595961/1352359627525718056) for chat and support.

# What's ZenStack

ZenStack is a TypeScript database toolkit for developing full-stack or backend Node.js/Bun applications. It provides a unified data modeling and access solution with the following features:

- A modern schema-first ORM that's compatible with [Prisma](https://github.com/prisma/prisma)'s schema and API
- Versatile data access APIs: high-level (Prisma-style) ORM queries + low-level ([Kysely](https://github.com/kysely-org/kysely)) query builder
- Built-in access control and data validation
- Advanced data modeling patterns like [polymorphism](https://zenstack.dev/blog/polymorphism)
- Designed for extensibility and flexibility: plugins, life-cycle hooks, etc.
- Automatic CRUD web APIs with adapters for popular frameworks
- Automatic [TanStack Query](https://github.com/TanStack/query) hooks for easy CRUD from the frontend

# What's new with V3

ZenStack V3 is a major rewrite of [V2](https://github.com/zenstackhq/zenstack). The biggest change is V3 doesn't have a runtime dependency to Prisma anymore. Instead of working as a big wrapper of Prisma as in V2, V3 made a bold move and implemented the entire ORM engine using [Kysely](https://github.com/kysely-org/kysely), while keeping the query API fully compatible with Prisma.

Please check [this blog post](https://zenstack.dev/blog/next-chapter-1) for why we made this big architectural change decision.

Even without using advanced features, ZenStack offers the following benefits as a drop-in replacement to Prisma:

1. Pure TypeScript implementation without any Rust/WASM components.
2. More TypeScript type inference, less code generation.
3. Fully-typed query-builder API as a better escape hatch compared to Prisma's [raw queries](https://www.prisma.io/docs/orm/prisma-client/using-raw-sql/raw-queries) or [typed SQL](https://www.prisma.io/docs/orm/prisma-client/using-raw-sql/typedsql).

> Although ZenStack v3's runtime doesn't depend on Prisma anymore (specifically, `@prisma/client`), it still relies on Prisma to handle database migration. See [database migration](#database-migration) for more details.

# Get started

> You can also check the [blog sample](./samples/blog) for a complete example.

## Installation

### 1. Creating a new project

Use the following command to scaffold a simple TypeScript command line application with ZenStack configured:

```bash
npm create zenstack@next my-project
```

### 2. Setting up an existing project

Or, if you have an existing project, use the CLI to initialize it:

```bash
npx @zenstackhq/cli@next init
```

### 3. Manual setup

Alternatively, you can set it up manually:

```bash
npm install -D @zenstackhq/cli@next
npm install @zenstackhq/runtime@next
```

Then create a `zenstack` folder and a `schema.zmodel` file in it.

## Writing ZModel schema

ZenStack uses a DSL named ZModel to model different aspects of database:

- Tables and fields
- Validation rules (coming soon)
- Access control policies (coming soon)
- ...

ZModel is a super set of [Prisma Schema Language](https://www.prisma.io/docs/orm/prisma-schema/overview), i.e., every valid Prisma schema is a valid ZModel.

## Installing a database driver

ZenStack doesn't bundle any database drivers. You need to install by yourself based on the database provider you use.

> The project scaffolded by `npm create zenstack` is pre-configured to use SQLite. You only need to follow instructions here if you want to change it.

For SQLite:

```bash
npm install better-sqlite3
npm install -D @types/better-sqlite3
```

For Postgres:

```bash
npm install pg pg-connection-string
npm install -D @types/pg
```

## Pushing schema to the database

Run the following command to sync schema to the database for local development:

```bash
npx zenstack db push
```

> Under the hood, the command uses `prisma db push` to do the job.

See [database migration](#database-migration) for how to use migration to manage schema changes for production.

## Compiling ZModel schema

ZModel needs to be compiled to TypeScript before being used to create a database client. Simply run the following command:

```bash
npx zenstack generate
```

A `schema.ts` file will be created inside the `zenstack` folder. The file should be included as part of your source tree for compilation/bundling. You may choose to include or ignore it in source control (and generate on the fly during build). Just remember to rerun the "generate" command whenever you make changes to the ZModel schema.

## Creating ZenStack client

Now you can use the compiled TypeScript schema to instantiate a database client.

### SQLite

```ts
import { ZenStackClient } from '@zenstackhq/runtime';
import { schema } from './zenstack/schema';
import SQLite from 'better-sqlite3';

const client = new ZenStackClient(schema, {
    dialectConfig: { database: new SQLite('./dev.db') },
});
```

### Postgres

```ts
import { ZenStackClient } from '@zenstackhq/runtime';
import { schema } from './zenstack/schema';
import { Pool } from 'pg';
import { parseIntoClientConfig } from 'pg-connection-string';

const client = new ZenStackClient(schema, {
    dialectConfig: {
        pool: new Pool(parseIntoClientConfig(process.env.DATABASE_URL)),
    },
});
```

## Using `ZenStackClient`

### ORM API

`ZenStackClient` offers the full set of CRUD APIs that `PrismaClient` has - `findMany`, `create`, `aggregate`, etc. See [prisma documentation](https://www.prisma.io/docs/orm/prisma-client/queries) for detailed guide.

A few quick examples:

```ts
const user = await client.user.create({
    data: {
        name: 'Alex',
        email: 'alex@zenstack.dev',
        posts: { create: { title: 'Hello world' } },
    },
});

const userWithPosts = await client.user.findUnique({
    where: { id: user.id },
    include: { posts: true },
});

const groupedPosts = await client.post.groupBy({
    by: 'published',
    _count: true,
});
```

Under the hood, all ORM queries are transformed into Kysely queries for execution.

### Query builder API

ZenStack uses Kysely to handle database operations, and it also directly exposes Kysely's query builder. You can use it when your use case outgrows the ORM API's capabilities. The query builder API is fully typed, and its types are directly inferred from `schema.ts` so no extra set up is needed.

Please check [Kysely documentation](https://kysely.dev/docs/intro) for more details. Here're a few quick examples:

```ts
await client.$qb
    .selectFrom('User')
    .leftJoin('Post', 'Post.authorId', 'User.id')
    .select(['User.id', 'User.email', 'Post.title'])
    .execute();
```

Query builder can also be "blended" into ORM API calls as a local escape hatch for building complex filter conditions. It allows for greater flexibility without forcing you to entirely resort to the query builder API.

```ts
await client.user.findMany({
    where: {
        age: { gt: 18 },
        // "eb" is a Kysely expression builder
        $expr: (eb) => eb('email', 'like', '%@zenstack.dev'),
    },
});
```

It provides a good solution to the long standing `whereRaw` [Prisma feature request](https://github.com/prisma/prisma/issues/5560). We may make similar extensions to the `select` and `orderBy` clauses in the future.

### Computed fields

ZenStack v3 allows you to define database-evaluated computed fields with the following two steps:

1. Declare it in ZModel

    ```prisma
    model User {
        ...
        /// number of posts owned by the user
        postCount Int @computed
    }
    ```

2. Provide its implementation using query builder when constructing `ZenStackClient`

    ```ts
    const client = new ZenStackClient(schema, {
        ...
        computedFields: {
            User: {
                postCount: (eb) =>
                    eb
                        .selectFrom('Post')
                        .whereRef('Post.authorId', '=', 'User.id')
                        .select(({ fn }) =>
                            fn.countAll<number>().as('postCount')
                        ),
            },
        },
    });
    ```

You can then use the computed field anywhere a regular field can be used, for field selection, filtering, sorting, etc. The field is fully evaluated at the database side so performance will be optimal.

### Polymorphic models

_Coming soon..._

### Access policies

_Coming soon..._

### Validation rules

_Coming soon..._

### Custom procedures

_Coming soon..._

### Runtime plugins

V3 introduces a new runtime plugin mechanism that allows you to tap into the ORM's query execution in various ways. A plugin implements the [RuntimePlugin](./packages/runtime/src/client/plugin.ts#L121) interface, and can be installed with the `ZenStackClient.$use` API.

You can use a plugin to achieve the following goals:

#### 1. ORM query interception

ORM query interception allows you to intercept the high-level ORM API calls.

```ts
client.$use({
    id: 'cost-logger',
    async onQuery({ model, operation, proceed, queryArgs }) {
        const start = Date.now();
        const result = await proceed(queryArgs);
        console.log(`[cost] ${model} ${operation} took ${Date.now() - start}ms`);
        return result;
    },
});
```

Usually a plugin would call the `proceed` callback to trigger the execution of the original query, but you can choose to completely override the query behavior with custom logic.

#### 2. Kysely query interception

Kysely query interception allows you to intercept the low-level query builder API calls. Since ORM queries are transformed into Kysely queries before execution, they are automatically captured as well.

Kysely query interception works against the low-level Kysely `OperationNode` structures. It's harder to implement but can guarantee intercepting all CRUD operations.

```ts
client.$use({
    id: 'insert-interception-plugin',
    onKyselyQuery({query, proceed}) {
        if (query.kind === 'InsertQueryNode') {
            query = sanitizeInsertData(query);
        }
        return proceed(query);
    },
});

function sanitizeInsertData(query: InsertQueryNode) {
    ...
}
```

#### 3. Entity mutation interception

Another popular interception use case is, instead of intercepting calls, "listening on" entity changes.

```ts
client.$use({
    id: 'mutation-hook-plugin',
    beforeEntityMutation({ model, action }) {
        console.log(`Before ${model} ${action}`);
    },
    afterEntityMutation({ model, action }) {
        console.log(`After ${model} ${action}`);
    },
});
```

You can provide an extra `mutationInterceptionFilter` to control what to intercept, and opt in for loading the affected entities before and/or after the mutation.

```ts
client.$use({
    id: 'mutation-hook-plugin',
    mutationInterceptionFilter: ({ model }) => {
        return {
            intercept: model === 'User',
            // load entities affected before the mutation (defaults to false)
            loadBeforeMutationEntity: true,
            // load entities affected after the mutation (defaults to false)
            loadAfterMutationEntity: true,
        };
    },
    beforeEntityMutation({ model, action, entities }) {
        console.log(`Before ${model} ${action}: ${entities}`);
    },
    afterEntityMutation({ model, action, afterMutationEntities }) {
        console.log(`After ${model} ${action}: ${afterMutationEntities}`);
    },
});
```

# Other guides

## Database migration

ZenStack v3 delegates database schema migration to Prisma. The CLI provides Prisma CLI wrappers for managing migrations.

- Sync schema to dev database and create a migration record:

    ```bash
    npx zenstack migrate dev
    ```

- Deploy new migrations:

    ```bash
    npx zenstack migrate deploy
    ```

- Reset dev database

    ```bash
    npx zenstack migrate reset
    ```

See [Prisma Migrate](https://www.prisma.io/docs/orm/prisma-migrate) documentation for more details.

## Migrating Prisma projects

1. Install "@zenstackhq/cli@next" and "@zenstackhq/runtime@next" packages
1. Remove "@prisma/client" dependency
1. Install "better-sqlite3" or "pg" based on database type
1. Move "schema.prisma" to "zenstack" folder and rename it to "schema.zmodel"
1. Run `npx zenstack generate`
1. Replace `new PrismaClient()` with `new ZenStackClient(schema, { ... })`

# Limitations

1. Only SQLite (better-sqlite3) and Postgres (pg) database providers are supported for now.
1. Prisma client extensions are not supported.
1. Prisma custom generators are not supported (may add support in the future).
1. [Filtering on JSON fields](https://www.prisma.io/docs/orm/prisma-client/special-fields-and-types/working-with-json-fields#filter-on-a-json-field-advanced) is not supported yet.
1. Raw SQL query APIs (`$queryRaw`, `$executeRaw`) are not supported.
