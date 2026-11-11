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
5. **P2 / further work (remaining):** optional download/history pagination and richer UX for uncertain budget holds; ensure existing speech/transcription workbench uses idempotent recoverable request IDs. This is media scope only; do not change shared gateway/credits.
6. **Unavailable by design:** video cannot be marked live without a declared real provider adapter. Existing video UI is an offline script draft only.

## Owner decision required

Whether full prompt/source references may be retained server-side for reproducibility. Current server persists hashes/parameter metadata only and does not store reference bytes. Do not add server prompt persistence without privacy scope approval.

## Verification ledger

- Read root `AGENTS.md`, stage-two workflow, web `AGENTS.md`, `UI_RULES.md` and active media adapter/registry.
- Bundled Next docs cannot be accessed through the GitHub connector because `node_modules` is not tracked; no Next runtime APIs were modified.
- CI `42879591439`: complete monorepo quality gate PASS, browser FAIL on four old fixed-ratio expectations (subsequently updated).
- Diagnostic CI `42977512596`: scoped Prettier + web typecheck PASS; final PR quality/browser check pending after formatted code checkpoint.
- No paid provider calls; fixtures and browser mocks only.
