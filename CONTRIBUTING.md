# Contributing to ZenStack

I want to thank you first for considering contributing to ZenStack 🙏🏻. It's people like you who make ZenStack a better toolkit that benefits more developers!

Before you start working on anything major, please make sure to create a topic in the [feature-work](https://discord.com/channels/1035538056146595961/1458658287015952498) discord channel (preferred) or create a GitHub issue to discuss it first. This will help ensure your work aligns with the project's goals and avoid duplication of effort.

## Prerequisites

- Node.js: v22 or above
- PNPM: as specified in [package.json](./package.json)

Test cases are run against both SQLite and Postgres. You should have a postgres server (16 or above) running (either natively or via Docker). The default connection is:

`postgresql://${TEST_PG_USER}:${TEST_PG_PASSWORD}$@${TEST_PG_HOST}$:${TEST_PG_PORT}`

The default values for the environment variables (if not set) are:

- `TEST_PG_HOST`: localhost
- `TEST_PG_PORT`: 5432
- `TEST_PG_USER`: postgres
- `TEST_PG_PASSWORD`: postgres

## Get started

1. Install dependencies: `pnpm install`
2. Build all packages: `pnpm build`
3. Run all tests: `pnpm test`

## Development workflow

ZenStack adopts a very simple development workflow:

1.  Changes should be made in branches created off the "dev" branch.

1.  Non-trivial changes should include test cases. Bug-fixes should include regression tests that refer to GitHub issues if applicable.

1.  After coding and testing, create a PR to merge the changes into the "dev" branch.

1.  After code review is done, maintainer will squash and merge the PR into the "dev" branch.

1.  Periodically, the "dev" branch is merged back to the "main" branch to create a new release.

## Project structure

ZenStack is a monorepo consisting of multiple NPM packages managed by [pnpm workspace](https://pnpm.io/workspaces).

### Packages

The source and tests of ZenStack npm packages reside in the "packages" folder:

#### [language](./packages/language)

The ZModel language's definition, including its syntax definition and parser/linker implementation. The compiler is implemented with the [Langium](https://github.com/langium/langium) toolkit.

#### [cli](./packages/cli)

The `zen` CLI and built-in plugins.

#### [schema](./packages/schema)

The runtime representation of ZModel schema.

#### [orm](./packages/orm)

The ORM runtime built on top of [Kysely](https://kysely.dev).

#### [server](./packages/server)

The `server` package implements the automatic CRUD services and contains two main parts:

1. Framework-agnostic API handlers: defining input/output format and API routes in a framework-independent way. Currently supports "rpc" and "rest" styles.

1. Framework-specific adapters: translating framework-dependent request and response formats.

#### [clients/tanstack-query](./packages/clients/tanstack-query)

TanStack Query client for consuming the automatic CRUD services.

#### [sdk](./packages/sdk)

Utilities for building ZenStack plugins.

#### [plugins/policy](./plugins/policy)

The access policy plugin implementation.

#### [ide/vscode](./packages/ide/vscode)

VSCode extension for ZModel.

#### [testtools](./packages/testtools)

Test utilities.

### Tests

#### [e2e](./tests/e2e/)

End-to-end tests covering essential features (ORM, access policies, etc.).

#### [regression](./tests/regression/)

Regression tests for previously reported issues.

## Testing changed packages locally

The [samples](./samples) folder contains sample projects that directly reference the packages in the workspace. Once you make changes to a package and rebuild it, the sample projects will automatically pick up the changes. They are handy for quick manual testing.

If you prefer to test against your own project, simply copy the built bundles (from the `dist` folder of each package) to your project's `node_modules` folder to overwrite the installed packages.
