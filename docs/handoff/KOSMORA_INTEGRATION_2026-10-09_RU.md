# Kosmora — интеграционный handoff (09.10.2026)

## Provenance and boundaries

- **Exact baseline**: `76e44320f20ae4cdc70f5202ac9e77d30c34eef7`, archive `kosmora-source-76e4432.zip` inside supplied `kosmora-integration-handoff.zip`.
- `root-document-library` was reconciled file-by-file. The root `document-library-store` and upload/index routes remain authoritative; v2 retry/cancel and model answers were added without wholesale replacement of the common API files.
- v2 settings/privacy, documents, research, media, chat history, Code HTTP OCI integration and budget were merged onto this baseline. The prior v1 Work runtime remains intact.
- `31` **reserved for WorkDAG v2 package, NOT installed or invented**. WorkDAG v2 is awaiting transfer from its own completed branch. `35` Canvas and `36` Data await independent packages; Windows builds and native UI require their separate lane. No new 29/33 media/research SQL.
- No production, VPS, GitHub main, secrets, paid provider requests or Docker daemon were accessed. `tool_calling=false`, paid media OFF, English relay OFF remain defaults. Rebranding does not rename internal `@cosmora/*` packages.

## Runtime wiring

1. `apps/api/src/server.ts` creates one `AccountStore` and a `SharedOwnerBudget` bridge. The general chat, background manager and Work retain their canonical budget integrations. The bridge is passed to CodeAgentService and DocumentAnswerService. Research gets `ProjectResearchOwnerBudget` backed by the **same** AccountStore and ProjectStore.
2. **Reserve before model dispatch**. Code's gateway `route.selected` requires the owner budget and canonical project ledger reservation. Research reserves both accounts and canonical ledger; document answers reserve in AccountStore and write one auxiliary canonical completion record. Unknown canonical usage retains an uncertain hold; only known local pre-dispatch errors can release. The AccountStore union excludes a hold already represented in canonical model usage, preventing double counted quota. Never create synthetic zero-cost completions.
3. Code executor uses the authenticated HTTP OCI sidecar/client and deploy override from the Code producer. API does not open a Docker socket. Without `CODE_AGENT_EXECUTOR_URL` and `CODE_AGENT_EXECUTOR_TOKEN_FILE`, checks return `CODE_AGENT_EXECUTOR_UNAVAILABLE`. This handoff has **no actual Docker/NSIS/installer/isolation proof**.
4. Documents keep uploaded original bytes, provide bounded/chunked indexed search and v2 model-backed answers with attested literal citations; unverified narrative is marked rather than presented as source evidence. Research synthesis receives bounded fetched excerpts, owner-scoped sources and model budget.
5. `/api/v1/personal-settings/export` now builds an **authenticated, single-epoch quiesced ZIP** (`manifest.json` and `originals/<store>/*.bin`, verified SHA-256 and byte size). Full failure aborts before download. Per-file retrieval is owner scoped. `privacy/preview` remains metadata-only. Limits: manifest 20 MiB, originals 100 MiB, full ZIP 120 MiB; over limit fails closed, not truncated.
6. The privacy coordinator requires account-core, documents, work, research, media, code, agent-studio and policy-projects adapters to be registered. Nonready or unquiesced stores block export/delete. `quiesce(ownerId)` stops/joins owner work, and SQLite owner lifecycle + triggers fence later writes. Explicit product challenge + exact Russian phrase is mandatory for deletion; the owner is left in a durable error fence on partial failure. Account authentication, usage accounting, uncertain holds and audit/retention remain, including retained costs after project/chat cascades.
7. Media persistent storage defaults to `.data/media` in non-production or `/var/lib/cosmora/media` in production; override with `KOSMORA_MEDIA_DIR`. Paid media remains OFF unless explicitly enabled **and** an owner budget is installed; this integration does not install any paid-media budget, so dispatch stays unavailable.

## SQLite journal / upgrade

Exact v2 order after slot 24: **25 → 26 → 27 → 28 → 30 → 32 → 34**. Slot 30 contains privacy/retention and Code storage, slot 32 document answers, slot 34 global history FTS plus document-answer owner fences. The late-table owner triggers were moved from 30 to 34 so a clean journal can actually apply. No runtime constructor executes DDL for Code storage.

**Historical upgrade hole:** old `76e44320` databases have already applied 26–28 while 25 is absent. Drizzle tracks latest migration time; it will skip retroactively inserting 25. The new `runMigrations` refuses this state with `SQLITE_LIBRARY_0025_UPGRADE_REQUIRED`, rather than starting a broken API. On a **stopped, offline** SQLite file with no WAL/SHM, run:

```bash
node scripts/retrofit-document-library.mjs --apply \
  --database /absolute/path/kosmora.sqlite \
  --backup /separate/backup/kosmora-before-library.sqlite
```

The script verifies old 26–28 tables, absence of partial 25 tables, SQLite `integrity_check`, creates an exclusive byte-identical backup (SHA-256), installs the exact 25 SQL in a transaction and rechecks tables. It refuses a live DB. After the retrofit, normal journal migration applies 30,32,34. On an empty database, just run the standard journal migrator (it installs 25 in order). **Do not** work around the preflight exception by disabling its check or editing migration journal rows manually.

## Reproducible local checks (no external services)

```bash
node --no-warnings scripts/integration-native-smoke.mjs
node --no-warnings scripts/integration-legacy-upgrade-smoke.mjs
node --no-warnings scripts/integration-privacy-e2e-smoke.mjs
```

The scripts use `node:sqlite` and (only for transpiling test-specific TS) installed TypeScript; they make no network/API requests. They exercise 32/32 SQLite migration entries, owner budget and uncertain holds, actual SQLite FTS and binaries, complete ZIP export and explicit deletion with ledger retention and two owners, and true old 28-migration offline upgrade. They **do not** prove Docker isolation, paid inference, provider usage normalization, distributed races, NSIS, a full `pnpm` build, Playwright or server E2E.

An isolated TypeScript transpile/syntax sweep of 375 TS/TSX files completed without errors. The source ZIP has **no `node_modules`** and `pnpm@11.19.0` cannot be installed from the unavailable registry in the isolated container. Therefore full `pnpm build`, `pnpm typecheck`, `pnpm test` and full API/browser runtime **remain UNVERIFIED**. Do not promote based solely on these smoke results.

## Main integrator reproducible deployment gate (NOT performed)

1. In a new checkout at exact `76e44320...`, apply the **full** unified diff (`git apply --check ...`, then `git apply ...`), or use the source ZIP, not both. The isolated `shared-integration.patch` is for conflict review against already-present producer modules, not an independently bootable patch.
2. Copy the current DB (and SQLite WAL/SHM safely via an offline snapshot), media storage and configuration to separate restricted rollback storage; write SHA-256 manifests. Preserve credentials and environment values, no secrets in patch/ZIP.
3. Stop API and all writer/background tasks. On old DB, run the offline 25 retrofit **against the staging copy first**. Make a second staging DB copy for migration rehearsal. Apply full migration journal; run `PRAGMA integrity_check` and `PRAGMA foreign_key_check`.
4. Restore matching pnpm, Node, dependency-lock modules using approved offline registry/network in your release environment. Run `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm test`, `pnpm build`, targeted privacy/budget/document/history tests, and browser E2E on isolated staging. Confirm no refactor of Canvas/Data/Windows from other lanes.
5. Stage the Code HTTP sidecar with its mTLS/private network protections and operator-only token file, pinned OCI image digest and Docker present; perform a real no-network, read-only, pids/CPU/RAM, cancellation and snapshot digest test. Do **not** call this PASS on a mock runner. With config absent, verify fail-closed behavior.
6. Verify owner-scoped export ZIP and challenge flow with test accounts, original PDF/DOCX/TXT/CSV bytes, historical message attachments, research and media binaries. Test second-owner isolation, concurrent writes during quiesce, fail/rollback of deletion and ledger continuity. If any mandatory adapter is unavailable, export/deletion must be blocked.
7. Deploy **only after all gates green**, using an approved release owner and separate Git branch/PR. Validate `/health`, owner login, chat, Work v1, documents, history and complete ZIP. No migration 31 until WorkDAG v2 arrives.

## Rollback

**Do not downgrade in place:** migration 30/34 install owner fences, retained accounting and FTS triggers that the old binary does not understand. Stop API and workers, restore the exact preupgrade SQLite snapshot (including WAL state if applicable), application binary and matching media directory. Use the untouched offline backup created by the 25 retrofit only when it matches the _complete_ pre-deploy state. Verify SQLite integrity and object counts before restarting the previous binary. Retain a separate archive of post-migration audit/usage records before rollback for forensic reconciliation—do not simply discard charged but uncommitted usage and retry paid dispatch. If a deletion was partially applied, preserve the fenced database for recovery instead of replaying writes or silently un-fencing it.

## Gate matrix

| Area                          | Local evidence                                                    | Remaining release gate                    |
| ----------------------------- | ----------------------------------------------------------------- | ----------------------------------------- |
| 32 migrations                 | PASS: clean SQLite journal                                        | production migration rehearsal            |
| 25-old DB upgrade             | PASS: offline backup/retrofit test                                | real schema snapshot + rehearsal          |
| Owner account budget          | PASS: holds, canonical aux, uncertain, pre-dispatch tests         | actual provider usage and fault injection |
| Privacy export/delete         | PASS: real SQLite/ZIP/original, 2 owners, retained canonical cost | live concurrent workers and browser       |
| Root library                  | PASS: actual FTS, original bytes, owner isolation                 | PDF/DOCX/CSV browser tests                |
| Code executor                 | integrated authenticated HTTP sidecar; fail-closed when absent    | Docker isolation and cancellation live    |
| Build/typecheck/e2e           | 375 TS/TSX syntax/transpile clean                                 | **UNVERIFIED (deps unavailable)**         |
| WorkDAG v2                    | **not integrated**                                                | separate expected package + reserved 31   |
| Canvas 35 / Data 36 / Windows | untouched independent lanes                                       | integrate packages after arrival          |
