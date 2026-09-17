# Cosmora live-model readiness audit — 2026-09-17

Base: `origin/main@403ed7143f062bb005a21c2fe1dde53434394e2a` (`feat: add guarded live model smoke test (#150)`).

Scope: audit `web → API → ManagerService → Model Gateway → streaming → user response` without changing API, Model Gateway, policy/tool/db layers, registry, CI, package metadata, production settings, Emergency Stop, or any secret-bearing file. No live model request was executed and no `MODEL_API_KEY` value was read. Only the boolean fact exposed by `/api/v1/model-runtime` is used by the web UI.

## Path audit

1. **Web** starts a run and observes the server stream. Durable state is re-read on normal completion/cancellation and on page reload.
2. **API** composes `ManagerService`, `ModelGateway`, persistence, runtime stop state, and the SSE coordinator. The public model-runtime status exposes provider/model plus `credential_configured` and `fallback_to_mock`; it does not expose the key.
3. **ManagerService** forwards model requests through the injected gateway and maps gateway events into durable assistant-message/run state.
4. **Model Gateway** selects a registry-approved route, applies timeout/retry/circuit/emergency-stop logic, normalizes provider failures, and prevents fallback after partial output.
5. **OpenAI-compatible adapter** parses provider SSE and does not surface raw non-2xx response bodies or headers through the gateway contract.
6. **Web streaming** consumes normalized run events. Existing reload/reconnect tests cover durable recovery, but the explicit `EventSource.onerror` path still has a recovery gap documented below.

## Configuration findings

- `MODEL_PROVIDER`: defaults to `mock`. External modes are schema-limited to the supported compatible protocols.
- `MODEL_PROVIDER_ID`: explicit provider identity used for registry routing; external runtime currently defaults to `vibecode` when omitted.
- `MODEL_NAME`: required for external providers; the safe status endpoint exposes the configured model name but no secret.
- `MODEL_API_KEY`: required by server config for external mode. `loadServerConfig()` reduces it to `modelApiKeyConfigured: Boolean(raw.MODEL_API_KEY)` for status use. This audit did not read or print its value.
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
- **Runtime consumer:** `apps/api/src/model-runtime.ts`, `buildModelRuntime()` passes the mock adapter as `fallbackProvider` when `config.modelFallbackToMock` is true.
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

- **File:** `packages/model-gateway/src/openai-compatible-adapter.ts`
- **Function / exact behavior:** `OpenAICompatibleAdapter.stream()` converts non-2xx responses to `GatewayRunError("PROVIDER_ERROR", ..., "Provider request failed with status ...", retryable)`.
- **Contract:** `packages/model-gateway/src/types.ts` exposes the coarse `PROVIDER_ERROR` gateway code; the run SSE contract carries only normalized error code/state, not a safe provider-status category.
- **Reproduction:** stub upstream responses 401, 403, 429, and 5xx. Downstream web receives the same coarse provider failure family (retryability differs, but that is insufficient to present the requested distinct safe messages without guessing).
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

## Existing mock coverage relevant to this audit

Current main already has deterministic model-gateway/mock coverage for successful streaming, retry/route selection, timeout normalization, no fallback after partial output, circuit behavior, invalid provider sequencing, cancellation, and durable run recovery/reconnect. `apps/web/e2e/b0.1.spec.ts` covers the real local API/SSE mock path and persisted reload behavior; `apps/web/e2e/manager-console-races.spec.ts` covers stream-delta deduplication and restoration of failed persisted requests.

The new `apps/web/e2e/model-status.spec.ts` adds the safe configuration/error surface. B3/B4 prevent honest end-to-end coverage of every requested provider-status/stream-break case without changing the corresponding contract/recovery implementation, so those cases are explicitly blocker tests to add with the fixes rather than tests that would encode incorrect behavior.

## Live-request safety

No command in this audit performs a provider request. The current guarded `pnpm manager:smoke` remains the only documented live smoke and requires explicit operator authorization before exactly two paid model requests. It already rejects mock mode, enabled mock fallback, missing credential, non-loopback targets, and active Emergency Stop. This audit did **not** run it.
