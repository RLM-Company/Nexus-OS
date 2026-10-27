# Canvas root integration — 2026-10-10

Canvas edits project artifacts through the project chat's “Открыть Canvas” action. Each save creates an immutable revision. A stale editor receives a version conflict and retains its browser draft; the user can create an independent copy or explicitly save a new revision. Restoring history creates a new revision and leaves earlier revisions intact.

## Completed implementation

- Migration 0035 creates owner/project-scoped artifacts and immutable revisions. SQLite triggers reject direct revision updates/deletes while permitting an artifact or project cascade deletion.
- Canvas store and HTTP routes implement create, list, get, version history, restore, delete, download and independent import of completed owner chat messages or published artifacts from completed Work.
- Every editor mutation checks the durable owner lifecycle fence under a SQLite writer transaction. The HTTP delete path now maps a fenced owner to the same 409 error as other mutations.
- The privacy adapter checks the integrated lifecycle epoch, exports all pages before claiming completeness, fails explicitly above its bounded segment budget, and checks the deletion fence under the same writer lock as data removal. Deletion counts both artifacts and cascaded revisions.
- Browser drafts use an authenticated server-derived opaque owner namespace plus project/artifact identifiers. Unknown legacy unscoped drafts are discarded; stale drafts remain available for conflict review. Imports retain an unsaved new draft. Saving a copy consumes the original local draft after the copy is durably stored. A format-only new draft is retained as an edit.
- All HTML/code/text previews are escaped text. Markdown retains headings and code formatting while raw HTML, links and images remain inert. Downloads use plain-text attachment delivery and restrictive response headers.
- The browser imports runtime Canvas contracts through the focused `@cosmora/contracts/canvas-artifacts` package export. This avoids the root contracts barrel's Node ESM `.js` specifiers in the Next development client bundle.
- Browser integration tests cover real SQLite-backed saving, external concurrent updates, copy recovery, restoring, download/delete, inert resources, reload/project draft isolation, and completed-source imports retaining a new draft.

## Verification performed

- Canvas DB store: **7 tests passed**. Covers owner boundaries, immutable history and SQL triggers, CAS conflicts/restoring, completed/published independent source imports, UTF-8 size bounds, project cascades, privacy isolation, and atomic artifact/revision limits.
- Canvas API/privacy: **7 tests passed**. Covers HTTP owner isolation, downloads, owner draft scope, all mutation fence responses, epoch checks, multiple export pages and explicit segment overflow failure.
- Rendered preview/draft unit tests: **5 tests passed**. Renders the actual preview component and checks escaped HTML, inactive Markdown resources, key isolation and invalid/stale draft handling.
- DB/contracts TypeScript checks passed. Focused Canvas ESLint and formatting checks passed. Web TypeScript passed at the initial integrated checkpoint. The later snapshot contains no Canvas errors but is blocked by concurrently added neighboring Work DAG exports, which the primary integration agent owns.
- **Chromium: all 8 combined Canvas + Data tests passed**, including all 3 Canvas integration tests. Command: `pnpm --filter @cosmora/web exec playwright test e2e/canvas-editor.spec.ts e2e/studio-data-workbench.spec.ts --config playwright.integration.config.ts --workers 1` (local escalated verification, session 82341, exit 0; 27.3 seconds).
- The first sandbox Playwright launch stalled and was stopped. The first escalated local launch exposed a real Next contracts barrel resolution error before browser tests started. Its servers were confirmed stopped before retrying.

## Remaining integration gates

- Root-wide production build, full checks, and any remaining tests of neighboring integrations are owned by the primary integration agent.
- Production deployment, real providers, VPS, paid services and commits were not performed.

The local browser test fixture uses mock providers and isolated temporary databases; these checks do not validate real provider behavior or deployment readiness.
