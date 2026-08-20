# Nexus OS

This repository contains the B0.1 foundation of Nexus OS.

## Current scope

Implemented through the current checkpoint:

- B01-001: technology ADR;
- B01-002: pnpm monorepo scaffold;
- B01-003: shared TypeScript, ESLint, Prettier, and task configuration;
- B01-004: shared runtime contracts;
- B01-005: typed server configuration;
- B01-006: Fastify API with a database-aware health check;
- B01-007: responsive Next.js application shell;
- B01-008: SQLite connection and reproducible Drizzle migrations.

Domain entities, real projects, chat, agents, and model execution are not implemented yet.

## Requirements

- Node.js 24 or newer;
- pnpm 11.19 or newer.

## Commands

```bash
pnpm install
pnpm db:migrate
pnpm dev
```

Web runs at `http://localhost:3000`, API at `http://127.0.0.1:3100`, and health is available at `GET /api/v1/health`.

Run the complete verification pipeline with:

```bash
pnpm check
```

## Repository rules

- Provider SDKs belong behind `packages/model-gateway`.
- Shared API schemas belong in `packages/contracts`.
- Secrets are server-only and never committed.
- Future packages reference local packages with `workspace:*`.

See `docs/decisions/ADR-001-technology-stack.md` for the accepted stack.
