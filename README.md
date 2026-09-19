# Cosmora OS

Cosmora OS is an owner-controlled, policy-gated AI project workspace. This repository contains the
integrated product and safety foundations; it does not yet contain an autonomous Manager or worker
agent runtime.

## Current integrated scope

### Product surfaces

- responsive Next.js project shell with separately persisted ordinary chats and projects,
  server-side streaming, cancellation and restart recovery;
- browser-local Project Context preview with bounded source metadata, explicit preview before
  connecting a source, per-project local isolation, safe redaction and explicit clear confirmation;
- mock-only Skills preview with read/preview permissions and disabled arbitrary execution, plus a
  mock/read-only GitHub preview with strict `github.com` URL allowlisting and disabled write actions;
- local Image, Video and Sound prompt workspaces that do not send prompts to an external model while
  that model surface is disconnected;
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
  route logs, Secret Resolver, durable process/project emergency stops and append-only clearance
  audit;
- canonical Policy Runtime contracts for 19 capabilities and monotonic autonomy levels A0–A6,
  deterministic evaluation, optimistic profile versions, atomic finite-use override consumption
  and fail-closed tool guards;
- Manager Runtime Step 6 contract foundation: bounded role, task graph, context, artifact,
  provenance, conflict, checkpoint, readiness and deterministic scenario release-gate contracts;
- 19 canonical Manager Runtime scenario entries covering all 13 required categories and every
  autonomy level A0–A6.

## Current boundary

- Manager and worker agents do not execute task graphs or make model calls as agents yet.
- Project Context source selection is browser-local preview state, not authoritative runtime context.
- Skills preview does not execute packages or arbitrary code, and GitHub preview does not authenticate
  to GitHub or perform repository writes.
- External tool effects and the local daemon are not connected to an autonomous agent loop.
- Manager Runtime Step 6 is accepted as `PASS — CONTRACT FOUNDATION / NO AGENT RUNTIME`.
- Roadmap Step 5 owner-facing control slices are implemented. Finite-use override counters are
  explicit owner inputs, included in the server authority diff and consumed atomically by Tool
  Runtime.
- The final Manager system prompt belongs to roadmap Step 7 and must be written with the owner.
- No production provider or production Secret Manager backend has been selected.
- The first closed paid beta remains limited to A0–A2; A3–A6 require later security and economic
  gates.

## Requirements

- Node.js 24 or newer;
- pnpm 11.19 or newer.

## Commands

```bash
pnpm install --frozen-lockfile
pnpm dev
```

The API applies SQLite migrations during startup. `pnpm db:migrate` remains available when an
explicit migration-only step is needed.

Web runs at `http://127.0.0.1:3000`, API at `http://127.0.0.1:3100`, and health is available at
`GET /api/v1/health`. A secret-free provider summary is available at
`GET /api/v1/model-runtime`. The web app proxies `/api/*` to `COSMORA_API_ORIGIN`.
Ordinary chat uses `GET/POST /api/v1/chats`, persists outside the project tables, and streams from
`GET /api/v1/chat-runs/:runId/events`. A project is created only by the explicit
`POST /api/v1/projects` confirmation path.
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

## Internal Manager demo

The controlled desktop demo uses the stable local-only command:

```bash
pnpm demo
```

To expose only the web frontend to a phone on the same trusted private network, use:

```bash
pnpm demo:lan
```

The API remains bound to loopback and the web server proxies `/api/*` to it. While both processes
are running, verify the mock-only route, database, emergency-stop state and web proxy in a second
terminal:

```bash
pnpm demo:preflight
```

LAN mode is for a temporary internal walkthrough only. Do not use it on a public or untrusted
network, and stop both processes after the demo. The exact owner walkthrough and recovery notes are
in `docs/handoff/SUNDAY_MANAGER_DEMO_RUNBOOK_2026-09-11.md`.

## Install the Manager Console as an app

Cosmora ships an installable PWA manifest, desktop/mobile app icons, standalone display metadata
and safe-area-aware layouts. On the local laptop, start `pnpm demo`, open
`http://127.0.0.1:3000`, then use the visible **Install** action or the browser's install control.
The installed app opens in its own window while continuing to use the same local API and SQLite
project history.

The responsive console also works through `pnpm demo:lan` on a phone in the same trusted private
network. Installing to a phone home screen requires a valid HTTPS origin; plain LAN HTTP is for
responsive preview only. No service worker caches project or API responses: when the API is
unavailable, the app reports that state instead of displaying potentially stale operational data.

## Connect a model provider

Keep the API key only in a local `.env` file (never paste it into chat or commit it):

```dotenv
MODEL_PROVIDER=openai-compatible
MODEL_PROVIDER_ID=vibecode
MODEL_REGISTRY_PATH=config/model-registry.vibecode.v1.json
MODEL_BASE_URL=https://vibecode.moe/v1
MODEL_API_KEY=your-local-secret
MODEL_NAME=gpt-5.5
MODEL_FALLBACK_TO_MOCK=false
MODEL_MAX_ATTEMPTS_PER_ROUTE=2
MODEL_RETRY_BASE_DELAY_MS=250
MODEL_RETRY_MAX_DELAY_MS=2000
MODEL_CIRCUIT_FAILURE_THRESHOLD=3
MODEL_CIRCUIT_OPEN_MS=30000
RUNTIME_EMERGENCY_STOP=false
```

The API `demo`, `dev` and `start` commands load this repository-root `.env` directly; the browser
process does not receive the credential. Repository-relative registry paths resolve from the
repository root, so the profile above works regardless of the shell working directory. Start the
console with `pnpm demo`, then verify the live route without sending a paid model request:

```bash
pnpm manager:preflight
```

At handoff, the only secret-dependent steps are: copy `.env.example` to a local `.env`, fill the
external-provider block and `MODEL_API_KEY`, start `pnpm demo`, then run the preflight above. Do not
commit `.env`. With `MODEL_FALLBACK_TO_MOCK=false`, an unavailable live provider fails visibly
instead of returning a synthetic answer.

The checked-in owner-preview registry also permits `claude-sonnet-5` through the
`anthropic-compatible` protocol. Its dated provider evidence expires on 2026-10-13 and must be
reverified rather than silently reused. The default registry remains mock-only, so removing the
local `.env` returns the repository to its safe local mode.

An OpenAI-compatible provider must expose streaming `POST /chat/completions`; an
Anthropic-compatible provider must expose streaming `POST /messages`. Cosmora does not expose the
key through its health or runtime-status APIs. If the provider fails before the first response
token, optional mock fallback keeps the local workflow usable; after output begins, the gateway
fails the run instead of mixing responses from two models.

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

`POST /api/v1/operations/emergency-stop/clearance` is the only HTTP recovery path. It requires an
owner-bound one-time step-up proof, the exact current `activated_at`, an explicit literal
acknowledgement and a reason. The compare-and-swap update and its clearance event commit in one
SQLite transaction; the audit table rejects updates and deletes.

```json
{
  "scope": "project",
  "project_id": "project-id",
  "expected_activated_at": "2026-09-03T12:00:00.000Z",
  "reason": "Recovery checklist completed",
  "acknowledgement": "CLEAR EMERGENCY STOP"
}
```

Recent owner-bound clearance events are available from
`GET /api/v1/operations/emergency-stop/clearance-events?limit=50`. A stale activation returns a
conflict before consuming step-up proof. `RUNTIME_EMERGENCY_STOP=true` activates the same
process-wide fail-closed state during startup, and a process stop attributed to
`system:environment` cannot be cleared through the API or store.

The Control Center can activate or clear either a selected-project stop or a process-wide stop.
Activation requires a reason and an exact-scope acknowledgement. Guarded recovery binds the
currently displayed `activated_at`, requires a separate recovery reason, literal acknowledgement
and one-time step-up proof, then reloads the server-confirmed stop state and append-only clearance
history. Environment-triggered process stops expose offline-recovery guidance instead of clearance
controls.

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
