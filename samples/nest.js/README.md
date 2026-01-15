# ZenStack NestJS Fastify+Swc Example

This sample demonstrate three ways of using ZenStack in a NestJS application.

1. As a simple ORM (see [db.service.ts](src/db.service.ts) and [app.controller.ts](src/app.controller.ts)).
2. As an access controlled ORM (see [app.module.ts](src/app.module.ts) for "AUTH_DB" provider, and [app-auth.controller.ts](src/app-auth.controller.ts) for consumption).
3. As an auto api handler (see [app-auto.controller.ts](src/app-auto.controller.ts)).

## Getting Started

- pnpm install
- pnpm db:init
- pnpm start:dev
