# Durable Intelligence Graph import recovery

Stacked on navigation PR #366. This closes the import-retry limitation recorded in PR #365 without enabling product integration. Managed migration allocation, privacy export/delete/quiesce adapters and integrator acceptance remain required before enabling graph routes.

## Behavior

- Optional `creation_key` on the existing import POST. Legacy keyless imports remain compatible. Keyed calls atomically create the workspace, its initial revision and a scoped SQLite receipt. Identical canonical portable content returns the same graph ID, including the current revision after later edits. A different package under that key fails with 409. Graph deletion leaves a tombstone and returns 410 rather than recreating the graph. Project deletion cascades receipts. The limit is 1,000 receipts per owner/project, including tombstones.
- `GET .../intelligence-graphs/imports/:creationKey` reads the canonical graph and original package hash with no-store caching. It always requires the authenticated owner and owned active project. Keys are not bearer capabilities.
- The tab persists and rereads a key/digest before POST in a project-specific sessionStorage slot. No graph text or portable package is put in browser storage. After reload, recovery is a user-triggered GET; a write retry requires explicitly selecting/reviewing the original JSON and uses the same key. Changed JSON fails locally and on the server. No automatic second POST.
- The pending attempt survives connection loss. A confirmed response clears the local receipt before auxiliary list/history refresh. Corrupt or inaccessible browser storage blocks writes until the user explicitly clears/checks it. Closing the preview preserves pending receipt metadata. Forgetting metadata does not delete server data; closing the tab/clearing sessionStorage loses local recovery metadata, while server receipts remain.
- SQL is a separate unnumbered proposal, `INTELLIGENCE_GRAPH_IMPORT_RECOVERY_PROPOSAL.sql`, applied after the graph workspace schema. Constructors/startup do not execute it. Privacy integration must include the receipt table along with graph workspaces/history. No managed journal slot was changed or installed.

## Validation

212 focused tests passed on the exact graph parent source with the complete authored/navigation/recovery delta (18 files). Coverage includes schema/kernel, temporal evidence, real-knowledge fixtures, editing/history/transport, deterministic visual navigation, read recovery, key/payload conflicts, SQLite reopen, owner/project fences, tombstones, project cascade, receipt quota and injected atomic rollback. Five metadata tests reject corrupt/content-bearing browser state.

Core/API/web and Playwright TypeScript, scoped source ESLint/Prettier, secret/diff checks, contracts/core/DB/API builds and production Next webpack build passed. Five Playwright scenarios are discovered, including lost response -> reload -> GET recovery without another POST; their execution is unconfirmed because Chromium is absent. Hosted CI for PR #365/#366 stopped before all steps (runner_id=0); no hosted success is claimed.

No paid models, autonomous verification, source-data expansion, main merge or deployment. The 789-node/2,387-edge real-knowledge fixtures and separate synthetic scale benchmark are unchanged.
