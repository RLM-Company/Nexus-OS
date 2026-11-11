# 07_FREE_MEDIA — CHECKPOINT

Status: **в работе** (not integrated; integration/acceptance only by Codex).
Base: `9d972e8ba447f681fbfb49253b73d9f02dd1d325`; main was identical to base at initial inspection.
Branch: `ops/free-studio-media`.
PR: https://github.com/RLM-Company/Nexus-OS/pull/504
Last reviewed code SHA before final formatted commit: `1a9e7c04fc65d50b61eeba54bd8a1e84b64614c1`. Current HEAD must be read from PR #504 after this checkpoint commit.

## Current slice

Image workbench uses only server-advertised geometry/quality/format; it forwards supported options through existing image POST. Image edit picker and re-edit action require declared server edit readiness, and PNG/JPEG preparation only; WebP remains downloadable. Paid image submission requires explicit confirmation and a stable idempotency ID (body + header). Session storage keeps only the request ID; reload reads the owner-scoped jobs endpoint. Completed results reappear after reload. Ambiguous responses never trigger automatic POST. Failed owner-history verification blocks fresh paid image launches until an explicit GET succeeds. Selecting past jobs restores supported parameter values but not secret source bytes or prompt text.

## Next independent slice

The image draft parser now restores only actual server ratios ("1:1", "3:2", "2:3") rather than rejecting 3:2 after a surface change. The prior browser suite at 42977940821 passed 447/448; its one error was this genuine image draft recovery issue. New Sound MP3 Studio recovery uses `useMediaJob("speech")`, preserves the pending ID across reloads, never auto-replays paid POST, and blocks launching while owner history is unreadable. Browser/chat voice popovers remain non-recovering, avoiding collisions with the Studio request ID. Voice draft session preservation and explicit history/cancel error UX are included. Focused browser run `42982292178` PASS (5/5); web typecheck PASS. Production provider execution stays prohibited.

## Remaining checks / next execution

1. Focused CI `42982292178` passed 5/5 Media/Sound browser scenarios, web typecheck and scoped formatting. Verify final full PR browser CI after temporary workflow deletion; no merge before review.
2. Confirm new fixture cases for Sound local draft, failed history and server cancellation. Add explicit WebP editing unsupported fixture only if needed; no fake provider readiness.
3. Main advanced 97 commits beyond original base at last compare; CI merge checkout now fails Prettier on unrelated `docs/research/experience-llm-distill-2026-11-10.json` from main. Do NOT alter it in this media branch. Codex owns rebase/integration and correcting main.
4. Leave PR #504 draft; never merge/deploy/spend on provider or claim live media acceptance.

## Environment constraints

This chat can inspect and write GitHub through the connected GitHub API; container Git checkout cannot reach github.com (DNS/network unavailable). No local monorepo checkout or dependencies. Temporary runners `42878536101` and `42977512596` passed scoped Prettier + web typecheck. CI quality at `42879591439` passed; browser at that SHA failed four obsolete ratios, now adjusted. PR CI and live provider acceptance remain distinct.
