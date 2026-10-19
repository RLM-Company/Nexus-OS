# Intelligence Graph privacy lifecycle

Separate continuation of graph PR #367 at `b76e7a50e2eb884c2806578124938c49f45a26ca`. No product branch merge, managed migration allocation, runtime registration or deployment is performed. The existing graph feature flag remains OFF.

## Implemented

- Every SQLite create/import/save checks the durable B22 owner lifecycle under the same `BEGIN IMMEDIATE` writer lock. Quiescing/deleting/deleted/error owners cannot write, including import replays and restores. Missing lifecycle schema fails closed rather than creating tables. Existing read-only endpoints remain owner/project scoped. HTTP writes report 423 for a fenced owner and 503 for missing privacy prerequisites.
- `intelligenceGraphPrivacyAdapter` structurally matches the product OwnerPrivacyCoordinator interface under ID `intelligence-graphs`. It does not depend on a newer product branch. Quiesce checks the exact owner epoch/state and acquires a SQLite writer lock, draining synchronous writes across connections. Writes remain fenced after adapter/server restart. Resume only forgets the adapter's in-memory receipt and cannot reset the durable lifecycle.
- Export covers owner workspace metadata, every historical snapshot and all import receipts, including tombstones and graphs in archived projects. It has no binary originals. Counts and raw snapshot bytes are checked before enumerating payloads; output is bounded to 10,000 records/12 MiB by default. An oversized or inconsistent snapshot causes an error, never a partial `complete=true` response. Root/node/edge ownership and project scope are validated, and each workspace must have its current revision.
- Deletion requires an exact deleting epoch after successful quiesce. Workspaces, revisions and import receipts are removed in one idempotent transaction. Auth/accounting/audit/lifecycle/project rows and other owners remain untouched. Injected failure rolls back deletion and leaves the durable fence active.

## Integration contract

Before enabling routes, integrate B22's existing `kosmora_owner_data_lifecycle` table and both graph schema proposals through managed migrations. Register the graph privacy adapter and add `intelligence-graphs` to the coordinator's required manifest whenever graph persistence is enabled. Missing graph receipts/history are not an empty complete export. The coordinator owns active/quiescing/deleting transitions and failure recovery. No graph constructor or request handler performs startup DDL.

This slice intentionally does not install a guessed global migration slot or silently enable the graph feature. Standalone graph consumers must now provide the lifecycle schema too; fixtures explicitly create a minimal B22-shaped table.

## Validation

- Parent focused suite plus privacy coverage: 219 tests passed on exact graph source; an additional real Fastify/SQLite prerequisite case passed (220 distinct checks total).
- Eight new lifecycle cases cover complete/archived/tombstone export, owner isolation, all writers, multiple SQLite connections, reopen, stale epochs, quota refusal, idempotent deletion, rollback, inconsistent history and missing prerequisites.
- API and DB TypeScript/builds, changed-source ESLint/Prettier, diff and secret checks passed. UI is unchanged; prior browser-execution limitation remains. No paid models, main merge or hosted success is claimed.
