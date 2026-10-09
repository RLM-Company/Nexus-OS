# Kosmora — global chat history search · 2026-10-09

Base tracked ZIP: `b15912d23ab15a99e38370e22e472faf28c99961`.

## Product contract

Authenticated `GET /api/v1/chat-history/search?q=...&scope=all|general|project&archive=active|archived|all&project=<owned-id>&after=YYYY-MM-DD&before=YYYY-MM-DD&limit=1..30&offset=0..1000` returns `{ items, next_offset }`. Defaults: scope=all, archive=active, limit=20, offset=0. Hits return canonical chat/project IDs, an optional exact message ID, title, safe plain-text snippet, timestamp, and archive status. Result ranking is FTS5 BM25 then newest, not arbitrary chat-title filtering. Date bounds are inclusive in UTC. No paid model route or Policy Engine bypass.

The two canonical stores are `general_chats/general_chat_messages` and `projects/chats/messages`; the FTS5 virtual table is a derived index only, with four source categories and deterministic rowid mapping. Schema, writes and source of truth remain the existing stores. `0034_chat_history_search.sql` creates its FTS5 table/triggers and backfills old records **once via migration**, not via startup DDL. SQLite must have FTS5 enabled. On insert, update and delete, triggers keep search in sync. Streaming assistant deltas are not reindexed every time; the assistant message enters the index on completed/failed/cancelled status. FK cascade deletes are reflected in the FTS table. Live joins recheck canonical project/chat existence, owner and archive state before returning any hit.

The monochrome `/search` page supports keyword query, scope, owned-project selection, archive, UTC date range, 20-result pages, loading/empty/error/retry, keyboard focus and `Ctrl/Cmd+K` to focus. Snippets are plain strings rendered as React text and `<mark>` nodes, no HTML injection. Each hit links to `/?chat=<id>&message=<id>` or `/?project=<id>&view=chat&message=<id>`; the target message gets focus after loading. Query/filter/page persist in the search URL, scroll is saved in sessionStorage before navigation and restored when returning.

## Source split and integration

Apply `feature.patch` first, then `integration.patch` to the **main checkout after merging other parallel branches**. The `feature.patch` adds only new search files/tests and the 0034 SQL migration. The `integration.patch` edits only: `apps/api/src/app.ts`, `apps/api/src/server.ts`, `packages/db/src/index.ts`, `packages/db/migrations/meta/_journal.json`, and `apps/web/src/app/page.tsx`. No code was deployed; this is not a merge of others' work.

**Journal constraint:** the b159 source journal ends at 0024, while 0025–0033 belong to parallel integration. Slot 0034 has `idx=34`, `when=1791580800009`. Integrator must merge the lower-numbered journal entries and migration files *before applying 0034 to a persistent database*. Applying 0034 alone to the old journal would advance Drizzle's watermark past lower future slots. Do not renumber 0025–0033, do not run ad hoc DDL in API startup. Back up SQLite and verify migration order before production migration. In some independently merged source trees the 0034 journal edit may require manual reconciliation.

## Verification and remaining work

Offline Node 22 smoke tests:

```bash
node --experimental-strip-types --test packages/db/test/chat-history-search.smoke.mjs apps/web/src/app/search/highlight.smoke.mjs
```

Covers: existing rows upgraded/backfilled, Cyrillic/token-safe FTS, both sources, owner isolation, archived-only/default/all, project/date bounds, bounded pages, rename/edit/add/delete/cascade, invalid MATCH grammar, HTML-like text kept as text. Does **not** substitute for Fastify `inject()` authorization tests, Next/React browser E2E, deployment smoke or production migration validation. This environment has no local pnpm/node_modules; the pnpm bootstrap cannot download packages, so full monorepo typecheck/lint/Playwright were not executed.

Integration acceptance for the main checkout: authenticated owner searches both modes, 401 unauthenticated / 403 non-owner; another owner cannot see content or title; archived excluded unless explicit filter; deleted rows remain absent; pagination max 30; index reflects assistant terminal updates without streaming O(n²) reindex; `Ctrl/Cmd+K`, Enter, Tab, Escape and screen-reader announcements; click message and browser Back restore exact query/page/scroll; post-merge SQLite migrate from 0024 to full current journal applies 0025–0034 sequentially.
