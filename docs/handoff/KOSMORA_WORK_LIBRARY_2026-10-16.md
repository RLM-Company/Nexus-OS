# Work plan library — 16 October 2026

Stacked on PR #350 (`de9e21d9aa69c67c368672fe140d78915cb7845b`).

## Delivered

- Search current/archived plans by plan title, step title or goal, with case-insensitive matching.
- Reversible archive with version checks, preserved results/Skills/attempts/events, and no automatic cancellation or execution on restore. All started attempts must be terminal and drained; armed automatic plans cannot be archived. Scheduler, project controls and privacy quiescence leave archived graphs frozen. Owner export/deletion still includes them. The 100-plan storage limit includes both collections.
- Rename a current plan without modifying its nodes, Skills or execution authorization. Strict schema, owner/project scope, writable fence and expected-version checks apply. Lost acknowledgements recover through a canonical GET without another write.
- Copy into another owned active project from the UI, choosing original Skills or the target project's saved selection. Lost-response recovery reads the target project and links to the exact saved graph. Project navigation preserves the plan ID; archived deep links select the archive once on initial load.

No new migration: `archived_at` is an optional field in existing versioned graph state. Existing rows remain current. Checkpoint failure rolls back archive changes.

## Verified

- Full backend regression: 792 passed, four skipped across 123 files. Web: 65 passed across 16 files.
- API and web TypeScript checks, dedicated Playwright scenario typecheck, changed source/test ESLint, whitespace and secret scan passed. E2E files are not part of the repository's ESLint project service; they were checked with TypeScript separately.
- API production build and Next webpack production build passed (19 routes).
- Seven Work reuse Playwright cases discovered, including four added cases covering rename, archive/search/restore, concurrency and cross-project lost-response recovery. Browser execution remains unverified: Chromium is absent and the prior installation returned a corrupt archive. No browser pass is claimed.

No paid model request, server deployment, main merge or hosted CI success is implied by these local results.
