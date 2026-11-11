# 07_FREE_MEDIA — DELIVERY

Status: **в работе** until CI verification; at most **готово к интеграции** after fixture checks.
BASE_SHA: `9d972e8ba447f681fbfb49253b73d9f02dd1d325`
HEAD_SHA: latest verified code snapshot `271d7fa4042a58bdac7bebfa731a93c6c9cf96f3`; read PR #504 for final report commit SHA.
Branch: `ops/free-studio-media`; draft PR: https://github.com/RLM-Company/Nexus-OS/pull/504.

## Scenario before

A user selected unsupported ratios (16:9 and 9:16), while the client always sent the default PNG 1024x1024. Backend supported other sizes/qualities/formats, but the client did not forward them. The user could submit a paid POST without a stable idempotency ID. If the HTTP response was lost, a blind retry risked a second paid operation. A reload did not correlate the in-flight operation; reference controls were visible despite disabled editing, and JPEG/WebP assets did not preview as completed images.

## Scenario after (code delivered for review)

The image studio reads exact server-advertised constraints; only supported ratios, qualities and output formats appear and are sent through the current media endpoint. It requires explicit confirmation, sends a stable idempotency key and server-validated client_request_id, and stores only the ID in sessionStorage for owner-scoped history restoration. Unknown outcomes are not automatically retried. A retry by explicit click reuses the ID, so the server either returns the earlier operation or rejects changed parameters by fingerprint. The panel handles PNG/JPEG/WebP previews and scoped downloads; continuation as reference is offered only for PNG/JPEG supported by current reference preprocessing. Histories can restore output parameters, not prompt/source contents. Reference input and the 'continue editing' control require the actual image editing capability. Failure to load job history blocks a fresh paid request until a successful owner-scoped GET. Video remains disabled and explicitly labelled as draft-only.

## Second media slice (Sound MP3)

Existing Sound Studio could start a consented MP3 job, but the active job was lost on reload and new submissions did not retain a session-stable request ID. Studio now uses the existing owner-scoped media lifecycle and recovery hook with `recoveryKind="speech"`. After a lost HTTP acknowledgement, the owner can recover a running/completed MP3 from read-only job history, cancel it, or download the completed scoped asset; no automatic POST is issued. A failed history GET disables new paid speech work. Studio voice draft text is kept locally (sessionStorage only, no API upload until explicit consent). History distinguishes an empty list from network errors; cancel failure is reported. Existing chat voice playback intentionally does not share Studio's request ID.

## Entrypoints and changed files

- `apps/web/src/app/media-generation/media-workbench.tsx` — provider-driven parameter controls, reference gating and result reuse.
- `apps/web/src/app/media-generation/media-panel.tsx` — stable request IDs, uncertain status/reload, friendly errors, previews/history/download.
- `apps/web/src/app/media-generation/media-image-options.ts` — strict capability projection.
- `apps/web/src/app/media-generation/media-image-options.test.ts` — fixture unit coverage for supported, malformed and changed constraints.
- `apps/web/e2e/{owner-ui-media,image-editing,chat-polish-20261025}.spec.ts` — existing fixture assertions updated for declared backend options and explicit launch.
- `apps/web/e2e/media-job-recovery.spec.ts` — lost POST response, reload without replay, scoped download, cancellation, owner-switch no leak, edit-unavailable visibility and fail-closed history fixtures.
- `apps/web/e2e/fixtures/media-capabilities.ts`, `capability-workspaces.spec.ts`, `pwa.spec.ts`, `workspace-product-flows.spec.ts` — current, unavailable-provider capability fixtures, real supported ratio expectations and local 3:2/quality/format draft restoration.
- `apps/web/src/app/voice/voice-playback.tsx` — Sound Studio owner-scoped MP3 recovery, safe consent/no-replay, local speech draft, history/cancel errors.
- `apps/web/e2e/media-job-recovery.spec.ts` — also includes Sound lost acknowledgement/reload, history verification, draft and history-outage cases.
- `docs/team/operation-2026-11-10/deliveries/07_FREE_MEDIA/{BACKLOG,CHECKPOINT,DELIVERY}.md`.

## Checks

- Repo base compare: **PASS**, identical base/main at inspection.
- Server capabilities and existing fixture tests: source reviewed (not executed locally).
- Diagnostic GitHub Actions runner `42878536101`: **PASS**, scoped Prettier and `pnpm --filter @cosmora/web typecheck`.
- CI `42879591439`: monorepo quality gate **PASS**, code sandbox **PASS**, browser **FAIL**, four obsolete fixed 16:9/UI checks, corrected in subsequent code.
- CI `42977512596`: scoped Prettier and `pnpm --filter @cosmora/web typecheck` **PASS** on 2026-11-11 (no provider calls).
- Browser CI `42977940821`: **447/448 PASS**, one failing saved 3:2 preference, fixed in `d50fbb80...`; recheck pending.
- CI `42981278012`: monorepo format gate **FAIL** on unrelated upstream file `docs/research/experience-llm-distill-2026-11-10.json` (not in PR diff); out of Media authority, Codex/main owner must repair it.
- Targeted Sound and 3:2 browser suite `42982292178`: **5/5 PASS** in Chromium (34s); scoped Prettier and web typecheck **PASS**. No live provider use.
- `pnpm check:core` on original first-slice snapshot passed; current full run pending.
- API fixture tests are part of project test suite; no live API calls.
- Live provider spending / VPS / owner device: **NOT RUN** (prohibited).
- Local Git clone: blocked by container network DNS; connector-based branch/commit instead.

No dependency, migration, shared contract, provider key, budget configuration or billing changes. No changes to chat, sidebar, logo or other Studio modes.

## Limitations / next step

Backend metadata keeps only prompt hash and lengths; it intentionally never stores source reference bytes. Reload recovery uses owner-scoped job history and a pending ID, not replayed content. If a submission is ambiguous and no server job is visible yet, the UI retains the same ID; it cannot prove provider cancellation or safely infer zero charge. Check latest PR #504 CI, especially browser suite. Fix media-local failures; then pass to Codex for integration. No ownership of other Studio modes. Video remains unavailable.

## Third vertical slice — honest budget and full owned history (2026-11-11)

**Before:** image gallery was silently limited to eight items, failed history GET could appear empty, budget state (including `uncertain`) was never shown, and a reference deep link fetched source assets even if editing adapter was disabled.

**After:** Image history is accessible in eight-result batches via `Показать ещё изображения`; owner-scoped GET failures are shown with read-only retry and no stale gallery. Image and Sound show real per-job `budget_state` labels, and explicit notices for reserved/uncertain states without invented currency values. A disabled editing adapter prevents deep-link reference GET; WebP previews/downloads remain available without pretending to enable unsupported edit inputs. This is display-only and does **not** change shared billing/hold state or authorise a paid retry.

**Changed scope:** new `apps/web/src/app/media-generation/media-budget-status.ts` and `.test.ts`; modified `media-panel.tsx`, `media-workbench.tsx`, `apps/web/src/app/voice/voice-playback.tsx`; new `apps/web/e2e/media-budget-history.spec.ts`.

**Evidence:** GitHub Actions `43015849304`: `pnpm --filter @cosmora/web typecheck` **PASS**, selected Vitest **5/5 PASS**, Playwright six mock-only scenarios **6/6 PASS (43.2s)**, selected file Prettier **PASS**. No paid provider call. Last full browser suite `42982674639` **PASS**; sandbox **PASS**; monorepo Prettier fails on unrelated upstream research JSON, not in 07_FREE_MEDIA diff. Main advanced 111 commits since original base, no Media/Sound source overlaps at verification. Draft PR remains unmerged. No changes to migrations, schema, dependencies, credentials, budgets, shared gateway, deployment or other Studio modes.

## Fourth vertical slice — corrupted owner job list cannot authorize paid retry

**Before:** `GET /api/v1/media/jobs` returning 200 with missing/invalid `items` was cast to an empty list. Media/Sound could conclude no job existed and enable paid dispatch. Sound history could retain cached rows after later read failures.

**After:** a strict display/client parser checks job-list shape and minimal job identity/status; malformed 200 responses cause the same fail-closed history uncertainty as an HTTP failure. No automatic second POST occurs. Sound clears stale saved rows if a later verified read fails, exposes a GET-only `Обновить историю MP3` control, and does not imply history is empty.

**Entrypoints:** new `apps/web/src/app/media-generation/media-job-response.ts` and `.test.ts`; `media-panel.tsx`, `apps/web/src/app/voice/voice-playback.tsx`, `apps/web/e2e/media-budget-history.spec.ts`.

**Checks:** mock-only GitHub Actions `43017569953`: `pnpm --filter @cosmora/web typecheck` PASS; selected Vitest **4/4 PASS**; selected Playwright **9/9 PASS**; scoped Prettier PASS. No live providers or data. Full PR quality is separately blocked on upstream `docs/research/experience-llm-distill-2026-11-10.json`, not changed in this branch. No dependency, schema, budget, auth, payment or shared-gateway edits. Codex owns integration/rebase.
