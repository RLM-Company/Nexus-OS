# 07_FREE_MEDIA — DELIVERY

Status: **в работе** until CI verification; at most **готово к интеграции** after fixture checks.
BASE_SHA: `9d972e8ba447f681fbfb49253b73d9f02dd1d325`
HEAD_SHA: `9aa140d1d48a59e614b4e26f32a43ece364dc4ea` (code snapshot before this report commit; consult PR head for latest).
Branch: `ops/free-studio-media`; draft PR: https://github.com/RLM-Company/Nexus-OS/pull/504.

## Scenario before

A user selected unsupported ratios (16:9 and 9:16), while the client always sent the default PNG 1024x1024. Backend supported other sizes/qualities/formats, but the client did not forward them. The user could submit a paid POST without a stable idempotency ID. If the HTTP response was lost, a blind retry risked a second paid operation. A reload did not correlate the in-flight operation; reference controls were visible despite disabled editing, and JPEG/WebP assets did not preview as completed images.

## Scenario after (code delivered for review)

The image studio reads exact server-advertised constraints; only supported ratios, qualities and output formats appear and are sent through the current media endpoint. It requires explicit confirmation, sends a stable idempotency key and server-validated client_request_id, and stores only the ID in sessionStorage for owner-scoped history restoration. Unknown outcomes are not automatically retried. A retry by explicit click reuses the ID, so the server either returns the earlier operation or rejects changed parameters by fingerprint. The panel handles PNG/JPEG/WebP previews and scoped downloads; continuation as reference is offered only for PNG/JPEG supported by current reference preprocessing. Histories can restore output parameters, not prompt/source contents. References are gated by the actual editing capability. Video remains disabled and explicitly labelled as draft-only.

## Entrypoints and changed files

- `apps/web/src/app/media-generation/media-workbench.tsx` — provider-driven parameter controls, reference gating and result reuse.
- `apps/web/src/app/media-generation/media-panel.tsx` — stable request IDs, uncertain status/reload, friendly errors, previews/history/download.
- `apps/web/src/app/media-generation/media-image-options.ts` — strict capability projection.
- `apps/web/src/app/media-generation/media-image-options.test.ts` — fixture unit coverage for supported, malformed and changed constraints.
- `apps/web/e2e/{owner-ui-media,image-editing,chat-polish-20261025}.spec.ts` — existing fixture assertions updated for declared backend options and explicit launch.
- `apps/web/e2e/media-job-recovery.spec.ts` — lost HTTP response, reload without replay, scoped download and cancellation fixtures.
- `docs/team/operation-2026-11-10/deliveries/07_FREE_MEDIA/{BACKLOG,CHECKPOINT,DELIVERY}.md`.

## Checks

- Repo base compare: **PASS**, identical base/main at inspection.
- Server capabilities and existing fixture tests: source reviewed (not executed locally).
- Diagnostic GitHub Actions runner `42878536101`: **PASS**, scoped Prettier and `pnpm --filter @cosmora/web typecheck`.
- GitHub CI on final code snapshot `9aa140d1...`: run `42878802008`; quality gate and browser scenarios pending at report time.
- `pnpm check:core`: running in CI, not executed in a local checkout.
- API fixture tests are part of project test suite; no live API calls.
- Live provider spending / VPS / owner device: **NOT RUN** (prohibited).
- Local Git clone: blocked by container network DNS; connector-based branch/commit instead.

No dependency, migration, shared contract, provider key, budget configuration or billing changes. No changes to chat, sidebar, logo or other Studio modes.

## Limitations / next step

Backend metadata keeps only prompt hash and lengths; it intentionally never stores source reference bytes. Reload recovery uses owner-scoped job history and a pending ID, not replayed content. If a submission is ambiguous and no server job is visible yet, the UI retains the same ID; it cannot prove provider cancellation or safely infer zero charge. Inspect CI checks on draft PR #504; fix any media-local failures, then hand to Codex for integration. Video remains unavailable.
