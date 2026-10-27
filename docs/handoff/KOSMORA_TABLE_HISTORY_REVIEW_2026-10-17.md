# Table history review and exact revision downloads

Builds on integrated artifact context (#356, `ee69de4`). No migration, dependency,
paid model request or deployment.

## Contract

- Table revision JSON reads and exact workspace downloads now have dedicated
  owner/project/type-scoped routes. Current and historical reads/downloads verify
  canonical SHA-256 before returning content. Restore also rejects corrupt sources.
  Versioned attachments include `X-Table-Version` / `X-Table-Sha256`, no-store,
  nosniff, sandbox CSP and a safe static versioned filename.
- UI compares the fresh current server snapshot to the selected immutable version.
  Row/column positions are explicit; row keys and insertions are not inferred.
  Counts cover changed shared cells/headings and added/removed dimensions separately.
  Name/delimiter and normalized meaningful analysis settings are also compared.
- Comparison is bounded at 100,000 common positions including headings. Beyond
  this, no partial counts are returned. The user can download both exact versions
  and explicitly acknowledge external review. At most 100 changed values are
  displayed, with a count of omitted changes. Long displayed values are clearly
  shortened; HTML/formulas stay literal escaped JSON text.
- Restore requires review and binds the POST expected version to the shown fresh
  server version. A byte-exact local workspace snapshot is rechecked before POST;
  local changes invalidate review without writing. A later server writer receives
  409 and preserves local data. The selected current server revision is downloadable
  but cannot be restored redundantly.
- Lost restore responses use a canonical read, checking successor version, exact
  content/title and `data_workspace.restored_from`; never an automatic second POST.
  An unresolved table-copy retry also retains its create attempt instead of updating
  the still-selected original. Scope aborts are checked after JSON reads.

## Verification

- Full backend/package run: 851 passed, four skipped, 128 files (one skipped file).
- Full web run: 99 passed in 22 files. Total: 950 passed.
- Three new API cases exercise exact CRLF/Unicode workspace bytes, immutable old
  snapshots, safe response headers, project/owner/type/version isolation and corrupt
  current/historical read/download/restore refusal without a new revision.
- Eight comparison/render cases cover duplicate headings, literal newlines/zeros,
  structural/positional changes, reordered JSON properties, samples and exact bounds,
  empty tables and literal HTML/formula/shortened-value rendering.
- API/web and selected E2E TypeScript, scoped ESLint/Prettier, secret scan and diff
  checks passed. API and Next webpack production builds passed (19 routes).
- Three project-table Playwright cases are discovered. New coverage describes
  stale server review rejection, local edits after review, exact old downloads and
  a deliberately lost accepted restore response. Execution remains unconfirmed:
  Chromium headless shell is absent. Prior source-branch browser results are not
  treated as execution of this combined change.

User workflow and routes: `docs/TABLES.md`.
