# Chat reliability integration — 2026-10-06

Base: `fc6a391a3f0b4d79d608d9ecbfb64d799a566a37` / draft PR #311,
`codex/studio-files-clean-composer-20261004`.

This branch owns ordinary chat drafts, photo preparation and chat recovery. It needs no
backend contract, migration or new model capability. API changes here exclusively extend
the synthetic test provider fixture used by both default CI and the isolated local servers.

Shared integration points:

- `apps/web/src/app/page.tsx`: hydrate/save text and attachments for the existing composer;
  use the selected project during loading to avoid a temporary new-chat scope; preserve
  `?chat=<id>` on ordinary chat selection/acceptance and restore it; keep the composer
  disabled until initial route selection settles; reject stale ordinary-history reads
  by the existing view epoch/request counter; preserve longer live content; retain native
  SSE reconnection to the same read-only observer; invalidate pre-terminal snapshots.
- `apps/web/src/app/chat-attachments.tsx`: route PNG/JPEG through `prepare-chat-image.ts`,
  read selected files sequentially, retain existing scope/operation guards, picker/chips
  and thumbnails. PDF/DOCX/text still call the existing decoder unchanged.
- `apps/web/package.json`: include five draft-storage tests in the existing root Turbo
  `test` task. No dependency or lockfile update.
- `apps/api/test/fixtures/e2e-server.ts`: install the reusable chat-reliability mock response
  wrapper before starting the existing test server. This lets default CI run the new E2E
  scenarios with the same controlled responses as the isolated port configuration.

`decode-chat-attachment.ts`, Studio Files, GitHub, Windows and global styles are unchanged.
Studio's existing `onCompose(prompt, files)` callback still prepares an unsent new chat.
The selected-part transfer is covered by the unchanged Studio E2E scenarios.

The integration owner should review these page/picker points when stacking other module
PRs. No merge, production deployment or paid-model acceptance is included.
