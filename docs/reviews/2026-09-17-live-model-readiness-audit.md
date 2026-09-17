# Cosmora live-model readiness audit — 2026-09-17

Base: `origin/main@403ed7143f062bb005a21c2fe1dde53434394e2a` (`feat: add guarded live model smoke test (#150)`).

Scope: audit `web → API → ManagerService → Model Gateway → streaming → user response` without changing API, Model Gateway, policy/tool/db layers, registry, CI, package metadata, production settings, Emergency Stop, or any secret-bearing file. No live model request was executed and no `MODEL_API_KEY` value was read. Only the boolean fact exposed by `/api/v1/model-runtime` is used by the web UI.

## Path audit

1. **Web** starts a run and observes the server stream. Durable state is re-read on normal completion/cancellation and on page reload.
2. **API** composes `ManagerService`, `ModelGateway`, persistence, runtime stop state, and the SSE coordinator. The public model-runtime status exposes provider/model plus `credential_configured` and `fallback_to_mock`; it does not expose the key.
3. **ManagerService** forwards model requests through the injected gateway and maps gateway events into durable assistant-message/run state.
4. **Model Gateway** selects a registry-approved route, applies timeout/retry/circuit/emergency-stop logic, normalizes provider failures, and prevents fallback after partial output.
5. **Compatible adapters** parse provider SSE. Non-2xx responses are reduced to normalized gateway failures rather than returning raw HTTP bodies/headers to the web client.
6. **Web streaming** consumes normalized run events. Existing reload/reconnect tests cover durable recovery, but the explicit `EventSource.onerror` path still has a recovery gap documented below.

## Configuration findings

- `MODEL_PROVIDER`: defaults to `mock`. External modes are schema-limited to the supported compatible protocols.
- `MODEL_PROVIDER_ID`: explicit provider identity used for registry routing; external runtime currently defaults to `vibecode` when omitted.
- `MODEL_NAME`: required for external providers; the safe status endpoint exposes the configured model name but no secret.
- `MODEL_API_KEY`: required by server config for external mode. `loadServerConfig()` reduces it to `modelApiKeyConfigured: Boolean(raw.MODEL_API_KEY)` for status use. This audit did not read or print its value. Existing config tests also verify that the concrete key value does not survive serialization of `ServerConfig`.
- missing key: external server configuration fails closed before runtime composition (`Invalid server configuration: /MODEL_API_KEY`).
- mock/live: runtime composition is explicit, but current fallback default is unsafe for the requested fail-closed contract; see blocker B1.
- Emergency Stop: Model Gateway and guarded live smoke retain the existing stop checks. This branch does not weaken or bypass them.

## Changes made in the allowed web layer

- `/model-status` now treats external mode as safely configured only when a credential is present **and** `fallback_to_mock` is false.
- mock/live, credential present/absent, and fail-closed/fallback status are explicit.
- loading, offline, timeout, 401, 403, 429, 5xx, malformed status payload, retry, and reconnect states use fixed safe copy.
- status error bodies and provider headers are never rendered or logged by the page.
- the page links to `/live-model-setup.md`, a local activation/removal runbook.
- Playwright coverage verifies safe status handling and that upstream/internal sentinel text is not rendered.

## Blockers outside the permitted change surface

### B1 — automatic mock fallback is enabled by default

- **File:** `packages/config/src/index.ts`
- **Function / exact code:** `loadServerConfig()` → `modelFallbackToMock: raw.MODEL_FALLBACK_TO_MOCK !== "false"`.
- **Runtime consumer:** `apps/api/src/model-runtime.ts`, `buildModelRuntime()` passes `fallbackAllowed: config.modelFallbackToMock` into Chat/Manager services and adds `mock` as a gateway fallback route when the flag is true.
- **Reproduction:** start an external provider configuration with all required external fields present but omit `MODEL_FALLBACK_TO_MOCK`; inspect `/api/v1/model-runtime`. The resulting config permits fallback even though the operator did not explicitly opt in.
- **Risk:** a live failure can silently produce a mock answer before any partial provider output. That violates the requested “no automatic fallback to mock” and weakens fail-closed semantics.
- **Minimal safe fix:** change the config default to false and enable mock fallback only on explicit opt-in (`raw.MODEL_FALLBACK_TO_MOCK === "true"`). Keep the runtime composition otherwise unchanged.
- **Required test:** config test proving omitted `MODEL_FALLBACK_TO_MOCK` resolves to false, plus runtime/gateway composition test proving an external provider failure cannot select mock unless explicit fallback is enabled.

### B2 — `manager:preflight` reports fallback but does not fail on it

- **File:** `scripts/manager-live-preflight.mjs`
- **Function / exact behavior:** top-level validation prints `Fallback to mock: enabled/disabled` after fetching `/api/v1/model-runtime`, but does not assert `fallback_to_mock === false`.
- **Reproduction:** expose a live-looking status with `credential_configured: true` and `fallback_to_mock: true`; the current preflight can still finish with its success path.
- **Risk:** an operator can read “preflight passed” while the route is not fail-closed.
- **Minimal safe fix:** fail preflight before success output whenever `fallback_to_mock !== false`.
- **Required test:** stub `/api/v1/model-runtime` with fallback enabled and assert non-zero exit with no external model request.

### B3 — web cannot safely distinguish provider 401/403/429/5xx from the stream contract

- **Files:** `packages/model-gateway/src/openai-compatible-adapter.ts`, `packages/model-gateway/src/anthropic-compatible-adapter.ts`, and `packages/model-gateway/src/types.ts`.
- **Function / exact behavior:** compatible adapter `stream()` functions convert non-2xx responses to coarse `GatewayRunError("PROVIDER_ERROR", ...)`; retryability changes for timeout/rate-limit/5xx, but the safe downstream code remains coarse.
- **Reproduction:** stub upstream responses 401, 403, 429, and 5xx. Downstream web receives the same provider failure family, which is insufficient for the requested distinct safe messages without guessing.
- **Risk:** the web cannot honestly label provider authentication, forbidden, rate-limit, and upstream failures separately. Rendering raw upstream data instead would create a disclosure risk.
- **Minimal safe fix:** add non-sensitive categorical error codes such as provider-auth, provider-forbidden, provider-rate-limit, provider-upstream (names to follow the existing contract conventions) while continuing to discard upstream bodies/headers.
- **Required test:** one stub per upstream status proving the safe category is preserved through gateway → Manager/API → SSE and that response body/header sentinels never appear in the client payload.

### B4 — explicit SSE `onerror` says it is restoring state but does not trigger the restore

- **File:** `apps/web/src/app/page.tsx`
- **Locations:** both project-run and general-chat EventSource observers; exact message begins `Поток ответа прерван. Проверяю сохранённое состояние...`.
- **Current behavior:** each `source.onerror` closes the source and shows the recovery message, but does not call the corresponding persisted-state refresh in that handler. Normal completion/cancel paths do refresh, and reload-based recovery is already tested.
- **Reproduction:** interrupt an active EventSource after the server has accepted the run without reloading the page.
- **Risk:** the UI can remain stale after a transport break and its message overstates what it actually did.
- **Minimal safe fix:** after closing the observer, re-read the durable project/general-chat state for the same run with epoch/run guards; keep the restored run marked running when the server still reports it active, otherwise render its durable completed/failed/cancelled state. Parse malformed SSE defensively and use the same recovery path rather than exposing parser errors.
- **Required tests:** project + general chat connection break, malformed event JSON, empty terminal answer, and reload/reconnect. Assert no duplicate deltas, no resubmit, no mock fallback, and no raw internal error text.

B4 is in the otherwise allowed web area, but it is intentionally left as an explicit blocker in this change set rather than applying a risky whole-file replacement to the large console component without executable repository verification. The status/readiness UI does not claim that streaming recovery is fully ready while B4 remains.

### B5 — a repository workflow performs a real provider request

- **File:** `.github/workflows/vibecode-connection-test.yml`
- **Job / exact behavior:** `Verify VibeCode API` loads `MODEL_API_KEY` from GitHub Actions secrets and `Verify streaming model response` calls the configured external provider with `curl`.
- **Trigger:** manual `workflow_dispatch` and a legacy branch-specific push trigger.
- **Reproduction:** manually dispatch the workflow with repository variables/secret configured; the job sends a real streaming request to the live provider.
- **Risk:** this is a paid/network model check rather than a mock/stub test, so it is incompatible with the requested rule that readiness verification must not perform real model calls. It also handles provider error text in CI logs, even though the workflow attempts redaction.
- **Minimal safe fix:** keep real-provider verification outside ordinary automated test/readiness workflows and require an explicit guarded operator action equivalent to the current `manager:smoke` safety gates; use a local stub for CI verification.
- **Required test:** CI-safe workflow/test proving provider routing and SSE parsing against a stub with no credential dependency and no external network request.

This branch does not modify CI, so B5 is reported only. The workflow was not dispatched during this audit.

### B6 — Anthropic streaming error text can enter internal logs

- **Files:** `packages/model-gateway/src/anthropic-compatible-adapter.ts` and `apps/api/src/manager-background-run-coordinator.ts`.
- **Functions / exact behavior:** `AnthropicCompatibleAdapter.stream()` uses `event.error?.message` as the `GatewayRunError` message for provider SSE `error` events. `ManagerBackgroundRunCoordinator.#execute()` logs the resulting `gatewayError` object on provider failure.
- **Reproduction:** return an Anthropic-compatible SSE `error` event whose message contains a unique internal sentinel; observe the server failure log.
- **Risk:** provider-controlled response text can be retained in internal logs. The current web path exposes only the normalized error code, but log-level leakage is unnecessary and makes secret/internal-error hygiene weaker.
- **Minimal safe fix:** replace provider-supplied streaming error messages with a fixed normalized message/code before logging; retain only safe metadata such as provider id and retryability.
- **Required test:** provider SSE error containing body/header/key-like sentinels must yield a safe gateway code and must not place the sentinel in persisted state, SSE payload, or captured logger output.

### B7 — an empty provider stream can be marked completed

- **Files:** `packages/model-gateway/src/openai-compatible-adapter.ts`, `packages/model-gateway/src/anthropic-compatible-adapter.ts`, and `apps/api/src/manager-background-run-coordinator.ts`.
- **Functions / exact behavior:** both compatible adapter `stream()` implementations emit `response.completed` after consuming the body even when no `text.delta` was produced; the coordinator checks only that a completion event exists, not that the assistant response has content.
- **Reproduction:** return HTTP 200 with a syntactically valid stream that contains no text delta and then ends normally.
- **Risk:** a run can be persisted as successful with an empty assistant answer, leaving the user without a useful or explicit failure state.
- **Minimal safe fix:** track whether user-visible content was produced and fail with a normalized non-sensitive empty-response code (or explicitly define/handle empty success in the contract) before marking the run complete.
- **Required test:** OpenAI-compatible and Anthropic-compatible empty streams must produce the chosen safe terminal state; web E2E must show a fixed user-safe message and never raw provider data.

## Existing mock coverage relevant to this audit

Current main already has deterministic model-gateway/mock coverage for successful streaming, retry/route selection, timeout normalization, no fallback after partial output, circuit behavior, invalid provider sequencing, cancellation, and durable run recovery/reconnect. `apps/web/e2e/b0.1.spec.ts` covers the real local API/SSE mock path and persisted reload behavior; `apps/web/e2e/manager-console-races.spec.ts` covers stream-delta deduplication and restoration of failed persisted requests.

The new `apps/web/e2e/model-status.spec.ts` adds the safe configuration/error surface. B3/B4/B7 prevent honest end-to-end coverage of every requested provider-status/stream-break/empty-response case without changing the corresponding contract/recovery implementation, so those cases are explicitly blocker tests to add with the fixes rather than tests that would encode incorrect behavior.

## Live-request safety

No command in this audit performs a provider request. The current guarded `pnpm manager:smoke` remains the only documented live smoke and requires explicit operator authorization before exactly two paid model requests. It already rejects mock mode, enabled mock fallback, missing credential, non-loopback targets, and active Emergency Stop. This audit did **not** run it, and `.github/workflows/vibecode-connection-test.yml` was not dispatched.
