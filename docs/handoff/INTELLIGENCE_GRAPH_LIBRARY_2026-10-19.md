# Complete paged graph library

Stacked on exact-evidence PR #369. The graph workstream remains separate from product branches and integration remains OFF.

## Behavior

- `GET .../intelligence-graphs/library?limit=20&q=...&after=...` returns only graph IDs, titles, revisions and created/updated times. Source text, nodes, relationships and snapshots are loaded only after explicit selection. The older list endpoint remains compatible.
- Each page is limited to 1–20 items. Keyset order is `(updated_at DESC, graph_id DESC)`, including deterministic continuation when timestamps tie. The cursor is bounded/validated and bound to authenticated owner, project and normalized query. It is an opaque continuation marker, not an authorization token; SQL owner/project scope is enforced independently.
- Title search normalizes NFC and folds Russian/Latin case. SQLite uses a deterministic connection-local scalar function; registration changes no schema or persisted records. `instr` treats `%` and `_` literally. No SQL or URL is assembled from an unescaped user field.
- The editor can load subsequent metadata pages, search titles and open any selected older graph without dropping the already loaded page list. Page merging deduplicates a graph that moves across a boundary and does not downgrade a newer revision. Search updates only the library and keeps the open editor's draft. Owner-fenced writes now show a clear temporary-lock message.
- Pagination is a live view, not a frozen snapshot: new/edited graph rows can move to the head while later pages are being read. Refreshing/searching starts at the current head. Stable unchanged sets are enumerated completely without duplicates.

## Validation

239 focused tests passed on exact graph source (21 files). New coverage enumerates 45 graphs across pages, tied timestamps, complete termination, Russian case handling, literal punctuation, owner/project fences, cursor/query mismatch and metadata deduplication/downgrade prevention. API and package builds plus web/E2E TypeScript, scoped lint/format, secrets/diff and production Next webpack build passed. Seven Playwright scenarios are discovered, including older-graph navigation and preserving a draft during search; execution is unconfirmed because Chromium is absent.

No migration number/DDL, real-knowledge expansion, paid models, main merge or deployment. Graph privacy/migration integration requirements remain as documented in the prior slices. Hosted CI success is not claimed.
