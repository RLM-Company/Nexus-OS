# 07_FREE_MEDIA — CHECKPOINT

Status: **в работе** (not integrated; integration/acceptance only by Codex).
Base: `9d972e8ba447f681fbfb49253b73d9f02dd1d325`; main was identical to base at initial inspection.
Branch: `ops/free-studio-media`.

## Current slice

Image workbench follows exact server-advertised image constraints. It sends aspect ratio, quality and output format to the existing POST route, supports non-PNG previews/download, and gates reference uploads by the edit capability. A client request ID is submitted in both request body and idempotency header, and a pending ID is stored without prompt/image payload in sessionStorage. Reload reads owner-scoped GET jobs. Lost response is shown as unknown; no automatic POST occurs. Another explicit click uses the same ID and is protected by the server fingerprint contract. Confirmation precedes any paid POST. Selecting a historical task restores supported parameters, not prompt bytes.

## Remaining checks / next execution

1. Inspect PR CI quality gate, browser fixtures and test summary; fix within media scope if failing.
2. Add focused UI integration coverage for lost response, reload, cross-owner session storage, status polling, cancel, editing with PNG/JPEG and unsupported WebP re-edit. Verify no duplicate provider call on an ambiguous response.
3. Continue independent media-only slices: speech job restoration, history ergonomics. Do not touch gateway, global navigation or billing.
4. Ask Codex to integrate; do not merge, deploy, spend provider funds or claim live media acceptance.

## Environment constraints

This chat can inspect and write GitHub through the connected GitHub API; container Git checkout cannot reach github.com (DNS/network unavailable). No local monorepo dependencies, therefore no honest local `pnpm`/Next test result; rely on PR CI and mark that distinctly from live acceptance.
