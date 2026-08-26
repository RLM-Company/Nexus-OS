# Cosmora OS

This repository contains the B0.1 foundation of Cosmora OS.

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
- B01-009–B01-012: persisted projects, main chats, messages, runs, and idempotency;
- B01-013: typed project and message API;
- B01-014: SSE mock-manager response with durable message history;
- B01-015: interactive desktop and mobile project chat.
- B01-016: provider-neutral Model Gateway with safe fallback and timeouts;
- B01-017: Manager Core with durable multi-turn context;
- B01-018: OpenAI-compatible streaming provider adapter and token accounting.
- B01-019: restart recovery, owner isolation, strict idempotency, durable cancellation, and a
  browser acceptance gate.
- B02-001: versioned Model Registry and deterministic Router with fail-closed privacy, context, and
  budget filters.
- B02-002: registry-backed runtime selection and an atomic SQLite Usage Ledger for route attempts,
  token usage, and calculated cost.

The current vertical slice creates real local projects and can stream either deterministic
mock-manager responses or a configured OpenAI-compatible model. Tool execution and autonomous
worker agents are intentionally not connected yet.

## Requirements

- Node.js 24 or newer;
- pnpm 11.19 or newer.

## Commands

```bash
pnpm install
pnpm db:migrate
pnpm dev
```

Web runs at `http://localhost:3000`, API at `http://127.0.0.1:3100`, and health is available at
`GET /api/v1/health`. A secret-free provider summary is available at
`GET /api/v1/model-runtime`. The web app proxies `/api/*` to `COSMORA_API_ORIGIN`.

## Connect a model provider

Keep the API key only in a local `.env` file (never paste it into chat or commit it):

```dotenv
MODEL_PROVIDER=openai-compatible
MODEL_PROVIDER_ID=vibecode
MODEL_BASE_URL=https://your-provider.example/v1
MODEL_API_KEY=your-local-secret
MODEL_NAME=provider-model-id
# MODEL_REGISTRY_PATH=/absolute/path/to/model-registry.v1.json
MODEL_FALLBACK_TO_MOCK=true
```

The provider must expose an OpenAI-compatible streaming `POST /chat/completions` endpoint. Cosmora
does not expose the key through its health or runtime-status APIs. If the provider fails before the
first response token, optional mock fallback keeps the local workflow usable; after output begins,
the gateway fails the run instead of mixing responses from two models.

An external route starts only when `MODEL_PROVIDER_ID:MODEL_NAME` is active in the selected
versioned Model Registry and its protocol matches `MODEL_PROVIDER`. Missing, disabled, or
mismatched metadata fails startup instead of bypassing the Router. Unknown pricing remains allowed
only for requests without a hard cost limit; unknown privacy never qualifies for confidential
routing.

Run the complete verification pipeline with:

```bash
pnpm check
```

The gate runs formatting, a repository secret scan, lint, strict TypeScript, unit and API tests,
production builds, and the Playwright B0.1 browser scenario. Install the Chromium runtime once on a
new development machine with `pnpm --filter @cosmora/web exec playwright install --with-deps chromium`.

## Repository rules

- Provider SDKs belong behind `packages/model-gateway`.
- Shared API schemas belong in `packages/contracts`.
- Secrets are server-only and never committed.
- Future packages reference local packages with `workspace:*`.

See `docs/decisions/ADR-001-technology-stack.md` and
`docs/decisions/ADR-002-model-gateway.md` for accepted architecture decisions.
