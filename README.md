# Cosmora OS

Cosmora OS is an owner-controlled, policy-gated AI project workspace. This repository contains the
integrated product and safety foundations; it does not yet contain an autonomous Manager or worker
agent runtime.

## Current integrated scope

### Product surfaces

- responsive Next.js project shell with persisted projects, chat, streaming, cancellation and
  restart recovery;
- Agent Studio catalogs, blueprints and owner/delegated proposal flows with idempotent writes and
  Decision Trace records;
- Autonomy Control Center with the canonical A0–A6 profile, point-override editor, server authority
  diff, version-checked apply, confirmation review, guarded approve/reject, content-minimized Policy
  Decision Trace, content-free project Usage Ledger summary, versioned token/cost hard-limit
  preview and apply, read-only `RECOVERY_REQUIRED` reconciliation queue, durable emergency-stop
  activation and operational status;
- owner-bound API identity, project isolation, session revocation and bound one-time step-up proof
  enforcement for critical mutations.

### Runtime foundations

- SQLite persistence for projects, chats, messages, runs, identity, policy state, confirmations,
  permissions, operations, audit and usage accounting;
- provider-neutral Model Gateway with a versioned Model Registry, deterministic Router, bounded
  retry, timeout, exact-route circuit breaker and safe fallback;
- atomic Usage Ledger with fail-closed project ceilings, content-free runtime metrics, structured
  route logs, Secret Resolver and durable process/project emergency stops;
- canonical Policy Runtime contracts for 19 capabilities and monotonic autonomy levels A0–A6,
  deterministic evaluation, optimistic profile versions, atomic finite-use override consumption
  and fail-closed tool guards;
- Manager Runtime Step 6 contract foundation: bounded role, task graph, context, artifact,
  provenance, conflict, checkpoint, readiness and deterministic scenario release-gate contracts;
- 19 canonical Manager Runtime scenario entries covering all 13 required categories and every
  autonomy level A0–A6.

## Current boundary

- Manager and worker agents do not execute task graphs or make model calls as agents yet.
- External tool effects and the local daemon are not connected to an autonomous agent loop.
- Manager Runtime Step 6 is accepted as `PASS — CONTRACT FOUNDATION / NO AGENT RUNTIME`.
- Roadmap Step 5 owner-facing control slices are implemented. Finite-use override counters are
  consumed atomically by Tool Runtime but remain read-only in the owner UI pending a separately
  tested mutation slice.
- The final Manager system prompt belongs to roadmap Step 7 and must be written with the owner.
- No production provider or production Secret Manager backend has been selected.
- The first closed paid beta remains limited to A0–A2; A3–A6 require later security and economic
  gates.

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
Operational counters and active safety alerts are available at `GET /api/v1/operations/status`.
The bounded owner-only Policy Decision Trace is available at
`GET /api/v1/projects/:projectId/decision-trace?limit=50`; its response excludes purpose,
idempotency keys, request/result payloads, prompts, secrets and raw grants. The owner-facing
recovery queue is available at
`GET /api/v1/projects/:projectId/recovery-required?limit=50`; it derives only persisted
`RESERVED` operations, exposes no replay material and offers no mutation or retry action. The
owner-facing project usage summary is available at
`GET /api/v1/projects/:projectId/usage-summary`; it returns aggregate token and currency totals
while excluding run, provider, model, Registry and content details. The owner-facing autonomy UI
is available at `/control-center`, and Agent Studio at `/agent-studio`. Project hard limits are
read at
`GET /api/v1/projects/:projectId/usage-limit`, previewed at
`POST /api/v1/projects/:projectId/usage-limit/preview`, and version-checked changes are applied at
`PUT /api/v1/projects/:projectId/usage-limit`. Increasing, removing or changing the currency of an
existing ceiling requires a bound one-time step-up proof.

Autonomy profile and point-override changes are previewed at
`POST /api/v1/projects/:projectId/autonomy-profile/preview` and version-checked at
`PUT /api/v1/projects/:projectId/autonomy-profile`. The UI requires explicit capability, mode,
object IDs and purpose; `FULL`, A6 and critical capability expansions remain behind step-up.

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
MODEL_MAX_ATTEMPTS_PER_ROUTE=2
MODEL_RETRY_BASE_DELAY_MS=250
MODEL_RETRY_MAX_DELAY_MS=2000
MODEL_CIRCUIT_FAILURE_THRESHOLD=3
MODEL_CIRCUIT_OPEN_MS=30000
RUNTIME_EMERGENCY_STOP=false
```

The provider must expose an OpenAI-compatible streaming `POST /chat/completions` endpoint. Cosmora
does not expose the key through its health or runtime-status APIs. If the provider fails before the
first response token, optional mock fallback keeps the local workflow usable; after output begins,
the gateway fails the run instead of mixing responses from two models.

Retryable failures are retried only before the first response token and within the configured
attempt limit. Backoff is bounded, cancellation also interrupts backoff, and repeated failures open
a circuit for the exact registry route. After the cooldown, one probe is allowed; a successful probe
closes the circuit. Each retry, blocked circuit attempt and fallback selection gets its own atomic
Usage Ledger record.

An external route starts only when `MODEL_PROVIDER_ID:MODEL_NAME` is active in the selected
versioned Model Registry and its protocol matches `MODEL_PROVIDER`. Missing, disabled, expired or
mismatched metadata fails closed instead of bypassing the Router. Unknown pricing remains allowed
only for requests without a hard cost limit; unknown privacy never qualifies for confidential
routing. A configured project ceiling is checked atomically against committed usage and active
reservations before a new route reservation is created; missing token/cost evidence or a currency
mismatch fails closed. There is no automatic top-up. External route metadata must be backed by
dated evidence; Cosmora does not infer model capabilities or silently substitute another model.

`loadServerConfig` validates that a credential exists but discards its value after parsing. The API
composition root resolves `MODEL_API_KEY` asynchronously immediately before constructing the
server-only provider adapter. The current resolver reads process environment/GitHub Secrets; a
managed secret backend can replace it through the same interface without changing Gateway or UI
contracts.

## Emergency stop

`POST /api/v1/operations/emergency-stop` activates a durable stop for the whole API process or one
owner-bound project. Activating a stop immediately aborts matching active model runs, fails queued
runs before provider selection, and persists `EMERGENCY_STOP` in run/message/accounting state.

```json
{ "scope": "process", "reason": "Incident containment" }
```

```json
{
  "scope": "project",
  "project_id": "project-id",
  "reason": "Unexpected external behavior"
}
```

`RUNTIME_EMERGENCY_STOP=true` activates the same process-wide fail-closed state during startup. A
stop survives restart. The HTTP API intentionally has no unaudited resume endpoint; recovery must
use an explicit operator flow.

The Control Center can activate either a selected-project stop or a process-wide stop after the
owner supplies a reason and acknowledges the exact scope. The UI updates only from the
server-confirmed state and intentionally exposes no resume action.

## Verification

Run the complete verification pipeline with:

```bash
pnpm check
```

The gate runs formatting, a repository secret scan, lint, strict TypeScript, unit and API tests,
production builds and all Playwright browser scenarios. Install the Chromium runtime once on a new
development machine with
`pnpm --filter @cosmora/web exec playwright install --with-deps chromium`.

## Repository rules

- Provider SDKs belong behind `packages/model-gateway`.
- Shared API schemas belong in `packages/contracts`.
- Every tool execution must pass through `packages/tool-runtime` and Policy Runtime.
- Secrets are server-only and never committed.
- Future packages reference local packages with `workspace:*`.

See `docs/decisions/ADR-001-technology-stack.md`,
`docs/decisions/ADR-002-model-gateway.md`, the
`docs/roadmap/2026-08-24-from-policy-runtime-to-monetizable-release.md` roadmap and the latest
document under `docs/checkpoints/` for the current verified boundary.
