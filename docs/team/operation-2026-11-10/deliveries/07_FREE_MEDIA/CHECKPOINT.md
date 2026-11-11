# 07_FREE_MEDIA — CHECKPOINT

Status: **в работе** (not integrated; integration/acceptance only by Codex).
Base: `9d972e8ba447f681fbfb49253b73d9f02dd1d325`; main was identical to base at initial inspection.
Branch: `ops/free-studio-media`.
PR: https://github.com/RLM-Company/Nexus-OS/pull/504
Latest media code snapshot before this report: `ebacd5de9119e56911d2a010b7b574cf8c2a2685`; formatted and fixture-verified code staged in final PR report commit. Query PR #504 for exact head.

## Current slice

Image workbench uses only server-advertised geometry/quality/format; it forwards supported options through existing image POST. Image edit picker and re-edit action require declared server edit readiness, and PNG/JPEG preparation only; WebP remains downloadable. Paid image submission requires explicit confirmation and a stable idempotency ID (body + header). Session storage keeps only the request ID; reload reads the owner-scoped jobs endpoint. Completed results reappear after reload. Ambiguous responses never trigger automatic POST. Failed owner-history verification blocks fresh paid image launches until an explicit GET succeeds. Selecting past jobs restores supported parameter values but not secret source bytes or prompt text.

## Next independent slice

The image draft parser now restores only actual server ratios ("1:1", "3:2", "2:3") rather than rejecting 3:2 after a surface change. The prior browser suite at 42977940821 passed 447/448; its one error was this genuine image draft recovery issue. New Sound MP3 Studio recovery uses `useMediaJob("speech")`, preserves the pending ID across reloads, never auto-replays paid POST, and blocks launching while owner history is unreadable. Browser/chat voice popovers remain non-recovering, avoiding collisions with the Studio request ID. Voice draft session preservation and explicit history/cancel error UX are included. Focused browser run `42982292178` PASS (5/5); web typecheck PASS. Production provider execution stays prohibited.

## Remaining checks / next execution

1. Focused CI `42982292178` passed 5/5 Media/Sound browser scenarios, web typecheck and scoped formatting. Verify final full PR browser CI after temporary workflow deletion; no merge before review.
2. Confirm new fixture cases for Sound local draft, failed history and server cancellation. Add explicit WebP editing unsupported fixture only if needed; no fake provider readiness.
3. Main advanced 111 commits beyond original base at last compare; no overlap in Media/Sound source paths. CI merge checkout still fails Prettier on unrelated `docs/research/experience-llm-distill-2026-11-10.json` from main. Do NOT alter it in this media branch. Codex owns rebase/integration and correcting main.
4. Leave PR #504 draft; never merge/deploy/spend on provider or claim live media acceptance.

## Environment constraints

This chat can inspect and write GitHub through the connected GitHub API; container Git checkout cannot reach github.com (DNS/network unavailable). No local monorepo checkout or dependencies. Temporary runners `42878536101` and `42977512596` passed scoped Prettier + web typecheck. CI quality at `42879591439` passed; browser at that SHA failed four obsolete ratios, now adjusted. PR CI and live provider acceptance remain distinct.

## 2026-11-11 continuation verified

- Full CI `42982674639` for previous PR head: **Browser acceptance PASS**, **code sandbox PASS**, monorepo **FAIL only on upstream `docs/research/experience-llm-distill-2026-11-10.json` Prettier**. Do not modify that file in Media branch.
- New budget/history/reference slice: `apps/web/src/app/media-generation/media-budget-status{,.test}.ts`, `media-panel.tsx`, `media-workbench.tsx`, `apps/web/src/app/voice/voice-playback.tsx`, `apps/web/e2e/media-budget-history.spec.ts`. Verified with dedicated run `43015849304`: **6/6 Playwright PASS**, **5/5 scoped Vitest PASS**, **web typecheck PASS**, **Prettier PASS**. Temporary workflow to be removed in next integration-checkpoint commit.
- Confirm after commit the draft PR remains open/unmerged, temporary workflow absent, and main diff still isolated. Do not spend on live providers or change credentials/billing/gateway.
- Next independent media-only priority if further work requested: review owner-switch/recovery edge cases and deeper diagnostic status/history refresh without automatic paid dispatch. Stop at `готово к интеграции` only with proper review; Codex owns integration.
