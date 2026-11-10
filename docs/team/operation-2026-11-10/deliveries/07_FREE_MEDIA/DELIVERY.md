# 07_FREE_MEDIA — DELIVERY

Status: **в работе** until CI verification; at most **готово к интеграции** after fixture checks.
BASE_SHA: `9d972e8ba447f681fbfb49253b73d9f02dd1d325`
HEAD_SHA: populated on commit/PR verification.
Branch: `ops/free-studio-media`; PR: populated after creation.

## Scenario before

A user selected unsupported ratios (16:9 and 9:16), while the client always sent the default PNG 1024x1024. Backend supported other sizes/qualities/formats, but the client did not forward them. The user could submit a paid POST without a stable idempotency ID. If the HTTP response was lost, a blind retry risked a second paid operation. A reload did not correlate the in-flight operation; reference controls were visible despite disabled editing, and JPEG/WebP assets did not preview as completed images.

## Scenario after (code delivered for review)

The image studio reads exact server-advertised constraints; only supported ratios, qualities and output formats appear and are sent through the current media endpoint. It requires explicit confirmation, sends a stable idempotency key and server-validated client_request_id, and stores only the ID in sessionStorage for owner-scoped history restoration. Unknown outcomes are not automatically retried. A retry by explicit click reuses the ID, so the server either returns the earlier operation or rejects changed parameters by fingerprint. The panel handles PNG/JPEG/WebP previews and scoped downloads; continuation as reference is offered only for PNG/JPEG supported by current reference preprocessing. Histories can restore output parameters, not prompt/source contents. References are gated by the actual editing capability. Video remains disabled and explicitly labelled as draft-only.

## Entrypoints and changed files

- `apps/web/src/app/media-generation/media-workbench.tsx` — provider-driven parameter controls, reference gating and result reuse.
- `apps/web/src/app/media-generation/media-panel.tsx` — stable request IDs, uncertain status/reload, friendly errors, previews/history/download.
- `apps/web/src/app/media-generation/media-image-options.ts` — strict capability projection.
- `apps/web/src/app/media-generation/media-image-options.test.ts` — fixture unit coverage for supported, malformed and changed constraints.
- `docs/team/operation-2026-11-10/deliveries/07_FREE_MEDIA/{BACKLOG,CHECKPOINT,DELIVERY}.md`.

## Checks

- Repo base compare: **PASS**, identical base/main at inspection.
- Server capabilities and existing fixture tests: source reviewed (not executed locally).
- `pnpm --filter @cosmora/web exec vitest run src/app/media-generation/media-image-options.test.ts`: pending CI/local workspace.
- `pnpm --filter @cosmora/web typecheck`, lint and `pnpm check:core`: pending GitHub Actions CI.
- Live provider spending / VPS / owner device: **NOT RUN** (prohibited).
- Local Git clone: blocked by container network DNS; connector-based branch/commit instead.

No dependency, migration, shared contract, provider key, budget configuration or billing changes. No changes to chat, sidebar, logo or other Studio modes.

## Limitations / next step

Backend metadata keeps only prompt hash and lengths; it intentionally never stores source reference bytes. Reload recovery uses owner-scoped job history and a pending ID, not replayed content. If a submission is ambiguous and no server job is visible yet, the UI retains the same ID; it cannot prove provider cancellation or safely infer zero charge. Run CI, repair any media-local failures, add browser fixture coverage and hand PR to Codex for integration. Video remains unavailable.
