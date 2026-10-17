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
  Secret/diff checks, production build and deployment are recorded below after
  completion. Test providers are fixtures; no paid AI call was used.
