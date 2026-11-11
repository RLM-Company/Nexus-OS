# 07_FREE_MEDIA — BACKLOG

BASE_SHA: `9d972e8ba447f681fbfb49253b73d9f02dd1d325`
Branch: `ops/free-studio-media`. Owner-approved scope: existing media API/workbench and scoped tests.

## Verified existing behavior

- `apps/api/src/media/media-routes.ts`: capability GET; owner-bound POST image/speech/transcription, GET jobs, GET/DELETE job, GET/DELETE asset; header + body explicit consent.
- `apps/api/src/media/media-service.ts`: existing OpenAI media adapter, provider capability registry, validated image parameters, editing gated by adapter and config; idempotency with fingerprint, bounded execution, owner budget uncertain outcome without paid retry.
- `apps/api/src/media/media-store.ts`: per-owner durable job history; interruption recovery; asset signature and checksum validation, scoped download.
- `apps/web/src/app/media-generation`: image prompt, local reference preview, job polling, history, result reuse. Speech workbench is separate. No video adapter; live video unavailable.
- Fixture coverage already exists in `apps/api/test/media-acceptance-integration.test.ts`, `media-durable-lifecycle.test.ts`, `image-editing.test.ts` and `media-routes.test.ts`.

## Confirmed gaps and priority

1. **P0 / data and cost safety (this slice):** image UI POST omitted client request ID, so a lost response could not be correlated or safely retried; reload did not recover pending dispatch. UI did not distinguish unknown outcome from certain rejection.
2. **P1 / result blocker (this slice):** image UI hardcoded only 1:1 PNG though active provider registry advertises 1:1/3:2/2:3 and PNG/JPEG/WebP. It exposed fake 16:9 and 9:16 options; quality/output MIME options not sent. Preview/reuse only supported PNG.
3. **P1 / editing honesty (delivered):** reference picker and 'continue editing' button now require `image_editing.ready`; PNG/JPEG only when edit adapter is live; non-editable assets retain download and history.
4. **P2 / recovery (delivered; final browser CI pending):** Playwright fixtures cover lost POST response, reload, no duplicate POST, owner scope after switch, done-result preview/download, cancellation, and unavailable-history fail-closed launch. Persisted job parameters omit prompt text deliberately; cross-device reproducibility needs a privacy decision.
5. **P2 / Sound (new slice; fixtures pending):** existing speech server MP3 path now reuses the media job recovery hook with a dedicated session-only request ID, explicit consent, owner-scoped reload, no automatic paid replay, and fail-closed GET outages. Unsaved Sound text drafts remain local across navigation; MP3 history distinguishes empty from unavailable and shows cancellation errors. Chat message voice playback remains independent to avoid multiple concurrent components sharing one Studio speech request ID. API transcription is existing backend capability but no new transcription UI is claimed.
6. **P2 / history and budget state (delivered):** image history is no longer hard-limited to eight visible records; read-only show-more batches expose older owner jobs. History GET errors display an explicit retry instead of fake empty results. Both Image and Sound show reserved/uncertain/reconciled job budget labels without inventing prices. No shared ledger or billing changes. Cross-device prompt/reference reproducibility still requires a privacy choice. Backend video adapter does not exist; disabled video UI is not live media generation.
7. **Unavailable by design:** video cannot be marked live without a declared real provider adapter. Existing video UI is an offline script draft only.

## Owner decision required

Whether full prompt/source references may be retained server-side for reproducibility. Current server persists hashes/parameter metadata only and does not store reference bytes. Do not add server prompt persistence without privacy scope approval.

## Verification ledger

- Read root `AGENTS.md`, stage-two workflow, web `AGENTS.md`, `UI_RULES.md` and active media adapter/registry.
- Bundled Next docs cannot be accessed through the GitHub connector because `node_modules` is not tracked; no Next runtime APIs were modified.
- CI `42879591439`: complete monorepo quality gate PASS, browser FAIL on four old fixed-ratio expectations (subsequently updated).
- Diagnostic CI `42977512596`: scoped Prettier + web typecheck PASS. Browser run `42977940821`: 447/448 PASS, 1 FAIL (saved image 3:2 ratio), fixed by accepting server-supported ratios in draft hydration. CI `42981278012` has unrelated base-main Prettier failure on `docs/research/experience-llm-distill-2026-11-10.json`; out of assigned scope. Targeted Media + Sound fixture run `42982292178`: 5/5 browser fixtures PASS, web typecheck PASS, scoped Prettier PASS. Earlier run `42981652229` exposed off-screen Sound consent controls; fixed inside Sound CSS.
- No paid provider calls; fixtures and browser mocks only.

## Continuation: 2026-11-11 — budget/history/asset honesty

- Added `media-budget-status.ts` as a defensive display-only projection of real backend `budget_state`. `uncertain` warns that a hold may remain and a new job may add costs; `reserved` does not claim settlement; unknown/missing fields create no invented amounts.
- Image gallery now renders all owner-scoped rows in batches of eight, supports read-only retry on GET failure and avoids confusing inaccessible history with an empty history.
- Sound result and saved MP3 history show the same backend budget states; no extra provider calls are initiated.
- Deep-link reference downloads are gated by `image_editing.ready`, and fixture verifies no source download when editing is disabled. WebP remains downloadable but cannot be used as unsupported edit input.
- Verified with fixture-only GitHub Actions `43015849304`: 6/6 browser scenarios, 5/5 selected unit cases, scoped Prettier and web typecheck all PASS.

Remaining independent decisions: server-side cross-device prompt/source persistence requires privacy authorization; live media provider/video acceptance is not authorized, and merged `main` quality requires unrelated upstream formatting correction. No fake video or provider claims.
