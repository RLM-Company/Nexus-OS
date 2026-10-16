# Documents, Canvas and table editing — 16 October 2026

Branch `codex/documents-data-editing-20261015` starts from `922b90c`, the verified
Work delivery. This change completes local document/table editing paths through
the existing Canvas API and browser Data Workbench. It adds no dependencies,
database migrations, model calls or service permissions.

## Delivered behavior

- Canvas opens UTF-8 TXT/Markdown/code/CSV and DOCX text as an independent,
  immediately saved project artifact. The current editor draft remains available
  under its existing owner/project namespace. Invalid UTF-8, binary text,
  unsupported formats and text over 512 KiB fail without truncation or replacing
  the current draft. DOCX input is bounded to 20 MB and the existing bounded XML
  extractor; imported text remains subject to the 512 KiB Canvas ceiling.
- Canvas downloads the exact current editor contents, including unsaved changes,
  as an editable DOCX using the existing XML-safe exporter. Paragraph text is
  retained; Word formatting, images, macros, Markdown rendering and Office package
  features are not preserved. Existing history, conflict recovery and inert
  HTML/code preview remain in place.
- Data Workbench edits individual source cells after explicit edit-mode selection.
  Screen sorting/filtering never changes the underlying row coordinates. Committed
  edits recalculate statistics, grouping, filters and chart data in a fresh Worker.
  Old Worker results and exports are fenced before applying the new table.
- Twenty sparse cell changes can be undone/redone during the open session. A new
  edit clears redo history; a different input file clears both stacks. New values
  are limited to 64 KiB and resulting table JSON to 16 MB. Stale edits are rejected.
- CSV/JSON exports and workspace files contain edited data. Existing spreadsheet
  formula escaping remains in the CSV export path. Saving/opening a workspace
  retains edited rows and settings; undo history is intentionally session-local.
- Switching between Studio's document and table tabs preserves both mounted
  workspaces, including the current table and edit history. The root's existing
  project-key boundary still clears state when the active project changes.

## Boundaries

Tables remain local to the current browser view. Explicit workspace JSON or data
export is needed before closing/reloading the view. This release does not add
server table persistence, XLSX, formulas, OCR or Word layout editing. Canvas
artifacts retain the existing server persistence and immutable revision history.
Imported local documents are manual editor copies, not server-attested original
document citations. No private source file or table is automatically sent to AI.

## Verification

- 28 unit checks passed across table parsing/query/export/editing, Canvas import,
  preview/draft isolation and DOCX report export. They cover exact source-row
  mutation after sorted/filtered selection, recomputation, reversal, stale and
  oversized edits, formula escaping, malformed UTF-8, binary content and aborts.
- Web semantic typecheck and scoped ESLint passed.
- Four Canvas Chromium scenarios passed, including real local API/SQLite
  persistence, bad-file draft retention, editable DOCX export/re-import, revision
  save/reload, conflict/copy recovery and inert resources.
- All six Data Chromium scenarios passed on the final run, for ten passing
  browser scenarios across the two suites. These include real Worker processing,
  source-coordinate editing under sorting/filtering, statistics, undo/redo,
  tab preservation and edited workspace export/re-open. Other cases cover CSV
  escaping, bounded attachments, cancellation and malformed/replaced input.
  The initial two failures were test issues: the new case used the wrong filter
  label, and the older zero-POST assertion counted a routine navigation-pin
  migration. The final assertion still rejects all Data/model writes and permits
  only that unrelated idempotent navigation import.
- Production build and deployment passed as recorded below. Hosted CI success is
  not asserted.

## Production delivery and live acceptance

Draft PR: https://github.com/RLM-Company/Nexus-OS/pull/353, based on
`codex/work-autonomy-20261015`. Source revision
`ea0f25d588ac22397802737aa3be20d6ae0b6013` is deployed as
`cosmora-alpha-app:documents-data-web-ea0f25d`. No main merge was performed.

The source archive contains only tracked `apps/web/src/app` files: 401,218 bytes,
SHA-256 `7a0f501ef5ef5e6d1afe10d17589fbb5c6347798802be03dcbd55674dd7a9200`.
It excludes credentials, environment files and user data. The production web image
built with no network access and retained earlier hashed static assets. The
release directory is `/opt/cosmora/releases/documents-data-ea0f25d`.

Activation held the maintenance lock, checked the old image and new revision,
saved the previous deployment wrapper and appended a web-only overlay. The new web
container passed its health check. Exact API/login/Code executor container IDs and
start times matched before and after activation. No API restart, migration,
database modification or provider change was part of deployment. Rollback to the
previous web image was prepared and was not needed.

Acceptance through the actual authenticated site on 16 October:

- Opened a synthetic three-row CSV, explicitly selected numeric types and a line
  chart, changed source row 3 revenue from 160,000 to 185,000, undid and redid it,
  switched document/table tabs, and downloaded its workspace. The UI recalculated
  the sum from 425,000 to 450,000. The downloaded JSON independently confirmed the
  exact edited row, settings and 450,000 total.
- In the existing synthetic Work project
  `cc150003-0001-4000-8000-000000000001`, imported `demo.md` into Canvas, edited it,
  saved revision 2, downloaded DOCX, reloaded the page and reopened revision 2.
  Exact textarea contents survived reload. The downloaded DOCX archive contains
  the Russian title and latest added paragraph.
- No model generation was invoked. Only synthetic acceptance documents were used.

Local artifacts under `2026-10-16/kosmora-documents-data` in the owner's Codex
workspace include `edited.workspace.json`, `edited.docx`, `table-live.png` and
`canvas-live.png`, plus the source archive and release scripts. The live browser
tabs were retained as deliverables. Canvas remains available from the project
chat; table workspaces still require explicit save before closing the view.
