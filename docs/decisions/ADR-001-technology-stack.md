# ADR-001: Technology stack for B0.1

- Status: Accepted
- Date: 2026-08-20
- Scope: B0.1 only; changes require a superseding ADR

## Context

Nexus OS is starting from an empty repository with a 0–10,000 RUB budget and a solo, AI-assisted development workflow. B0.1 needs a responsive web client, a separate server boundary, shared runtime contracts, deterministic mock streaming, and a zero-cost local database.

The stack must remain understandable to one developer, run on Windows-compatible Node.js tooling, and leave clean seams for PostgreSQL, background workers, a local daemon, and native clients later.

## Decision

### Runtime and workspace

- Node.js 24 LTS line.
- pnpm 11 workspaces using explicit `workspace:*` dependencies.
- Turborepo for repository-wide task orchestration and caching.
- TypeScript 6 with strict settings.
- ECMAScript modules for authored packages.

### Applications

- Next.js 16 App Router for `apps/web`.
- Fastify 5 for `apps/api`.
- Server-Sent Events for B0.1 response streaming.
- `apps/worker` and `apps/daemon` remain documented placeholders until their planned increments.

### Contracts and validation

- TypeBox 1 for shared runtime schemas and inferred TypeScript types.
- `@fastify/type-provider-typebox` when Fastify routes are implemented.
- API DTOs, error codes, event schemas, and model contracts live in `packages/contracts`.
- Provider-specific payloads never leak into UI contracts.

### Data

- Drizzle ORM with the built-in Node.js `node:sqlite` driver for B0.1.
- Drizzle Kit with generated, version-controlled SQL migrations.
- A repository layer separates domain logic from Drizzle and SQLite.
- PostgreSQL replaces SQLite before multi-user alpha, parallel agents, or background workers.

### Quality

- ESLint 10 with flat configuration.
- typescript-eslint 8.
- Prettier 3.
- Vitest 4 for unit and integration tests.
- Playwright for the end-to-end smoke test once the web/API path exists.

## Why this option

- One primary language minimizes context switching.
- pnpm has first-class workspace support and explicit local package linking.
- TypeBox matches Fastify's official type-provider path and produces JSON Schema.
- `node:sqlite` avoids an extra paid service and native addon installation.
- Drizzle supports both SQLite and PostgreSQL while keeping migrations in source control.
- A separate Fastify API preserves the backend security boundary needed for secrets, model routing, and the future local daemon.

## Rejected alternatives

### Next.js-only full stack

Rejected because the long-term orchestrator, workers, streaming lifecycle, and local daemon need a clear server application boundary.

### NestJS

Deferred. Its module system is useful at larger scale, but Fastify is smaller and faster to understand for the first solo-built increment.

### Prisma

Rejected for B0.1 in favor of a lighter SQL-first schema and migration workflow. This is not a permanent ban.

### better-sqlite3

Rejected because it adds a native addon build when Node 24 already provides `node:sqlite` and Drizzle supports it.

### Native mobile applications from day one

Rejected for B0.1. The responsive web client is the first mobile surface; native shells follow core validation.

## Version policy

- Exact versions are pinned in the lockfile.
- Workspace packages use `workspace:*`.
- Dependency upgrades are separate changes with passing checks.
- Node and pnpm minimum versions are enforced in the root manifest.
- TypeScript remains below 6.1 while the selected typescript-eslint release requires it.

## Consequences

Positive:

- Zero-cost local operation.
- Shared contracts across client and server.
- No provider coupling in the UI.
- A direct path to PostgreSQL and background workers.

Trade-offs:

- Two application processes instead of one.
- SQLite-to-PostgreSQL migration must be completed before alpha.
- TypeBox is less familiar to many developers than Zod.
- PWA/native packaging remains future work.

## Verification

This ADR is satisfied when:

- the workspace installs with pnpm;
- all authored packages type-check under the pinned TypeScript version;
- shared TypeBox schemas validate runtime input;
- configuration parsing fails safely on invalid environment values;
- no application package imports a provider SDK directly.
