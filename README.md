# Nexus OS

This repository contains the B0.1 foundation of Nexus OS.

## Current scope

Implemented in this checkpoint:

- B01-001: technology ADR;
- B01-002: pnpm monorepo scaffold;
- B01-003: shared TypeScript, ESLint, Prettier, and task configuration;
- B01-004: shared runtime contracts;
- B01-005: typed server configuration.

The web and API applications are reserved but are implemented in the next backlog group.

## Requirements

- Node.js 24 or newer;
- pnpm 11.19 or newer.

## Commands

```bash
pnpm install
pnpm check
```

## Repository rules

- Provider SDKs belong behind `packages/model-gateway`.
- Shared API schemas belong in `packages/contracts`.
- Secrets are server-only and never committed.
- Future packages reference local packages with `workspace:*`.

See `docs/decisions/ADR-001-technology-stack.md` for the accepted stack.
