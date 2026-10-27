# Persistent project tables and report editing — 16 October 2026

Branch `codex/project-tables-20261016` starts from the deployed document/table
editing branch at `c5731a9`. This adds explicit server saving, reopening,
optimistic versions, restore-as-new-version and report editing in Canvas.

## Storage and authorization

Tables reuse the existing owner/project-scoped Canvas artifact and immutable
revision tables. The first immutable revision's `data_workspace` source marks the
artifact type. Generic Canvas listings omit tables; generic editor updates cannot
change a table's type/content. The dedicated table routes validate the full shared
workspace schema before writing, including dimensions, columns, types, filters,
sort/group/chart indices and UTF-8 size. No migration, new database table, service
permission, external provider or model call is introduced.

Limits are 2 MiB per server snapshot, 20 immutable revisions per table and 32 MiB
of cumulative table revision content per project. These quotas and lifecycle
fences are checked under the existing SQLite writer transaction. The shared
200-artifact project limit still applies. Larger workspaces retain the existing
16 MB explicit local JSON path. Server restore creates a new version without
rewriting prior revisions; deletion removes the saved table/history only after a
user action and retains the table already open in browser memory.

The existing Canvas privacy adapter exports table content and deletes both
metadata and revisions under its owner lifecycle fence. Its pre-existing 12 MiB
segmented-export ceiling remains: larger owner exports fail explicitly rather
than silently omitting records. This is a remaining broader privacy export limit,
not a claim that every 32 MiB history can be exported in one privacy response.

## User workflow and recovery

- Explicit save preserves the table, settings and edits on the server. Without an
  active project the first save creates an idempotent empty `Таблицы Studio`
  project without AI, registers it in navigation and preserves the current table.
  Existing project tables can be reopened from their saved list after reload or
  on another authenticated device.
- A stable create ID and canonical GET reconcile a lost create response. Updates
  use an expected version; an accepted-but-lost update can be recognized by its
  exact contents and successor version. Conflicts retain local rows and offer
  explicit copy/open-server choices; they never overwrite another writer.
- Opening a different local file clears the server save target, preventing a
  replacement file from silently overwriting the previous saved table. Worker
  validation/recalculation still processes every reopened snapshot.
- The server operation disables the table's editing fieldset until its snapshot
  is committed/reconciled. Scope aborts fence late responses. A rejected request
  does not automatically create another copy or dispatch AI.
- The local statistical report opens as an independent Markdown artifact in an
  inline Canvas editor. It can be edited, saved with history and exported to DOCX.
  Report creation uses an explicit client request ID. A narrow Canvas panel now
  stacks its file list and editor using the panel width rather than viewport
  width, avoiding the cramped double column in project chat.

## Verification

- 18 API/database/privacy tests passed. New cases cover idempotent create,
  type/owner isolation, private exact downloads, stale versions, immutable history,
  restore, schema/UTF-8 bounds, all owner-fenced mutations, lifecycle export/delete,
  revision limits and atomic project storage quota. Existing Canvas tests passed.
- 27 browser-module unit tests passed for shared table parsing/query/export,
  source-row edits, Canvas import, preview and draft isolation.
- 12 Chromium scenarios passed across project tables, Canvas and Data. The full
  new scenario loses an accepted create response deliberately, checks one POST,
  saves v2, introduces an external v3 conflict, preserves/copies local v8 cell
  contents, reloads, restores v1 as v4, edits the report in Canvas and inspects the
  actual DOCX archive. A second scenario saves without a project and verifies no
  local data loss during project creation.
- DB/API/web semantic typechecks passed. Scoped lint reports zero errors.
  Secret scan and diff checks passed. Test providers are fixtures; no paid AI
  call was used.

## Production activation and live acceptance

Source `4a9ca43253bb5fc8209dab97693b4e62fc1d4389` was deployed on 16 October.
Both offline production builds passed (`--network=none`). Active images are
`cosmora-alpha-app:project-tables-api-4a9ca43` and
`cosmora-alpha-app:project-tables-web-4a9ca43`; release directory is
`/opt/cosmora/releases/project-tables-4a9ca43`.

Source archive SHA-256:
`5bf6df9dcd3fbe8527f6835d030d48c251977125c51f93f5f02031534f92a8db`.
Consistent SQLite backup verification SHA-256:
`9e7f423edb431fee807eb843b6f600c416d275c7199712e5ba0fb54b002371c18`.

Activation checked the idle baseline, rehearsed against a database copy and
compared existing canonical data. All 43 migration journal rows remained; this
release adds no migration. Copied-database create/replay, compare-and-swap,
restore and exact download passed. Existing Work rehearsal used six mock
requests. Authenticated routes and the existing real Code executor check passed.
Login and executor container identities/start times remained unchanged. Provider
configuration, credentials and maintenance overlays were retained. No rollback
was needed.

Live UI acceptance created empty project `d4bf6aab-e080-4a6a-acd9-5f739b064f7b`
without AI and saved table `2ccb2b09-3c44-44a8-8698-2132a6410438` as v1. Editing
the third revenue value from 160000 to 185000 produced v2 (sum 450000). Its
independent report opened in Canvas, accepted an editorial addition and saved
as report v2, artifact `c5badbb9-6d74-45ae-bf94-fd34516f2be1`. The actual downloaded
DOCX archive contained both the report sum and the saved editorial addition.

Reopening from the server after a full navigation retained v2. Restoring v1
created v3, preserving history [3, 2, 1]. A new browser tab on 17 October reopened
v3 with three original rows, sum 425000, explicit number types and the line chart.
The downloaded workspace preserved row values and chart settings. Authenticated
API readback independently confirmed v3, `restored_from: 1`, immutable history,
exact private/no-store download and separate report v2. Tables remained absent
from the ordinary Canvas listing. No external AI call was made in this block.

Local acceptance artifacts are in
`C:/Users/Александр/Documents/Codex/2026-10-16/kosmora-project-tables/`:
`project-tables-live.png`, `report-canvas-live.png`, `restored.workspace.json` and
`edited-report.docx`. Logs are outside the checkout. Draft PR:
https://github.com/RLM-Company/Nexus-OS/pull/354. No merge into `main` was performed.
