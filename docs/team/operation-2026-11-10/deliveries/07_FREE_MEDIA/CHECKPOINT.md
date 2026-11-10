# 07_FREE_MEDIA — CHECKPOINT

Status: **в работе** (not integrated; integration/acceptance only by Codex).
Base: `9d972e8ba447f681fbfb49253b73d9f02dd1d325`; main was identical to base at initial inspection.
Branch: `ops/free-studio-media`.
PR: https://github.com/RLM-Company/Nexus-OS/pull/504
Last code SHA: `9aa140d1d48a59e614b4e26f32a43ece364dc4ea`.

## Current slice

Image workbench follows exact server-advertised image constraints. It sends aspect ratio, quality and output format to the existing POST route, supports non-PNG previews/download, and gates reference uploads by the edit capability. A client request ID is submitted in both request body and idempotency header, and a pending ID is stored without prompt/image payload in sessionStorage. Reload reads owner-scoped GET jobs. Lost response is shown as unknown; no automatic POST occurs. Another explicit click uses the same ID and is protected by the server fingerprint contract. Confirmation precedes any paid POST. Selecting a historical task restores supported parameters, not prompt bytes.

## Remaining checks / next execution

1. Inspect CI run `42878802008` and the next run for this report commit. Correct media-only failures.
2. Browser fixtures now cover lost POST response, reload, no second POST, cancellation and download. Add owner-switch isolation and PNG/JPEG/WebP editing error cases after current checks.
3. Continue independent media-only slices: speech job restoration, history ergonomics. Do not touch gateway, global navigation or billing.
4. Hand draft PR #504 to Codex after verified checks; do not merge, deploy, spend provider funds or claim live media acceptance.

## Environment constraints

This chat can inspect and write GitHub through the connected GitHub API; container Git checkout cannot reach github.com (DNS/network unavailable). No local monorepo checkout or dependencies. Temporary runner `42878536101` passed Prettier + web typecheck; PR CI and browser acceptance are separate from live provider acceptance.
