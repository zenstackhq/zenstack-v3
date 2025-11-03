<div align="center">
    <a href="https://zenstack.dev">
    <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/zenstackhq/zenstack-docs/main/static/img/logo-dark.png">
    <img src="https://raw.githubusercontent.com/zenstackhq/zenstack-docs/main/static/img/logo.png" height="128">
    </picture>
    </a>
    <h1>ZenStack V3</h1>
    <a href="https://www.npmjs.com/package/@zenstackhq/cli?activeTab=versions">
        <img src="https://img.shields.io/npm/v/%40zenstackhq%2Fcli/next">
    </a>
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

> V3 is currently in beta phase and not ready for production use. Feedback and bug reports are greatly appreciated. Please visit this dedicated [discord channel](https://discord.com/channels/1035538056146595961/1352359627525718056) for chat and support.

# What's ZenStack

ZenStack is a TypeScript database toolkit for developing full-stack or backend Node.js/Bun applications. It provides a unified data modeling and access solution with the following features:

- A modern schema-first ORM that's compatible with [Prisma](https://github.com/prisma/prisma)'s schema and API
- Versatile data access APIs: high-level (Prisma-style) ORM queries + low-level ([Kysely](https://github.com/kysely-org/kysely)) query builder
- Built-in access control and data validation (coming soon)
- Advanced data modeling patterns like [polymorphism](https://zenstack.dev/blog/polymorphism)
- Designed for extensibility and flexibility: plugins, life-cycle hooks, etc.
- Automatic CRUD web APIs with adapters for popular frameworks (coming soon)
- Automatic [TanStack Query](https://github.com/TanStack/query) hooks for easy CRUD from the frontend (coming soon)

# What's new with V3

ZenStack V3 is a major rewrite of [V2](https://github.com/zenstackhq/zenstack). The biggest change is V3 doesn't have a runtime dependency to Prisma anymore. Instead of working as a big wrapper of Prisma as in V2, V3 made a bold move and implemented the entire ORM engine using [Kysely](https://github.com/kysely-org/kysely), while keeping the query API fully compatible with Prisma.

Please check [this blog post](https://zenstack.dev/blog/next-chapter-1) for why we made this big architectural change decision.

Even without using advanced features, ZenStack offers the following benefits as a drop-in replacement to Prisma:

1. Pure TypeScript implementation without any Rust/WASM components.
2. More TypeScript type inference, less code generation.
3. Fully-typed query-builder API as a better escape hatch compared to Prisma's [raw queries](https://www.prisma.io/docs/orm/prisma-client/using-raw-sql/raw-queries) or [typed SQL](https://www.prisma.io/docs/orm/prisma-client/using-raw-sql/typedsql).

> Although ZenStack v3's ORM runtime doesn't depend on Prisma anymore (specifically, `@prisma/client`), it still relies on Prisma to handle database migration. See [database migration](https://zenstack.dev/docs/3.x/orm/migration) for more details.

# Quick start

- [ORM](./samples/orm): A simple example demonstrating ZenStack ORM usage.
- [Next.js + TanStack Query](./samples/next.js): A full-stack sample demonstrating using TanStack Query to consume ZenStack's automatic CRUD services in a Next.js app.

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
npm install @zenstackhq/orm@next
```

Then create a `zenstack` folder and a `schema.zmodel` file in it.

# Documentation

Please visit the [doc site](https://zenstack.dev/docs/3.x/) for detailed documentation.
