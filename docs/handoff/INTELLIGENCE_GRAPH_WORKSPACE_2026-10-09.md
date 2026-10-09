# Intelligence Graph workspace — integration handoff

**Date:** 2026-10-09  
**Branch:** `codex/intelligence-graph-workspace-20261009`  
**Parent:** #321 cognitive evidence, which is stacked on #269 real knowledge  
**Target:** owner-scoped project graph CRUD + version restore; not Manager Work DAG.

## Supported user path

1. Open `/graph-workspace?projectId=<existing-active-project-id>`.
2. After the integration gate is enabled, load existing graph workspaces or create an **empty** one.
3. Add owner-entered nodes, then typed directed links, and inspect their explicit discovery state.
4. Edit a link's endpoints as a new edge version. Removal creates a tombstone in the current snapshot.
5. Load bounded revision history, restore an earlier workspace state as a **new** revision.
6. Ask a free-text question. A bounded lexical/graph traversal returns actual node excerpts,
   exact edge refs, statuses, readable Russian relation descriptions, and honest abstention
   when evidence is not independently verified.

New graphs contain **zero fabricated nodes**. All manually created facts, sources and links
remain `discovered` with `owner_assertion` provenance and `owner_direct` confidence.
The UI deliberately does not assert that user-entered content is a verified fact.

## Feature flag and integration

The server's existing `buildApp` has one optional dependency:

```ts
intelligenceGraphWorkspace?: {
  enabled: boolean; // OFF when absent
  service: IntelligenceGraphWorkspaceService;
};
```

By default **no graph API routes are registered**. Only after the primary
integrator installs the managed migration, adds export/delete/quiesce lifecycle
support, checks authentication/privacy gates, and approves the feature should
`apps/api/src/server.ts` instantiate:

```ts
// Integration guidance only: do not add this to main before migration.
intelligenceGraphWorkspace: {
  enabled: true,
  service: new IntelligenceGraphWorkspaceService(
    new SqliteIntelligenceGraphWorkspaceRepository(database.sqlite)
  )
}
```

The editor page is isolated, is not added to shared navigation, and shows
an explicit unavailable state when the graph routes are OFF. No global redesign.

## Bounded API routes (all OFF by default)

All routes are under `/api/v1/projects/:projectId/intelligence-graphs`.
The owner_id is **always resolved server-side** from the authenticated
identity; all storage accesses additionally fence on both owner and project.
404 responses hide foreign projects/graphs.

| Method | Suffix                | Input                               | Response                                            |
| ------ | --------------------- | ----------------------------------- | --------------------------------------------------- |
| GET    | `/`                   | `?limit=1..20`                      | `{items: Graph[]}`                                  |
| POST   | `/`                   | `{title: string<=80}`               | Created empty Graph, 201                            |
| GET    | `/:graphId`           | —                                   | Exact current Graph revision                        |
| GET    | `/:graphId/revisions` | `?limit=1..50`                      | Bounded revision metadata                           |
| POST   | `/:graphId/edits`     | `{expected_revision,operation}`     | Updated Graph                                       |
| POST   | `/:graphId/restore`   | `{expected_revision,from_revision}` | Restored Graph, new revision                        |
| GET    | `/:graphId/explain`   | `?q=string<=500`                    | Evidence readiness and actual matched relationships |

Mutations return `409 REVISION_CONFLICT` on stale optimistic revisions;
invalid requests return 400, oversize graphs 413, and unauthorized/unknown
resources 404. At most 150 node versions and 300 edge versions are stored in
a workspace, and the cognitive retrieval is bounded to 24 nodes / 40 edges /
depth 2 / fan-out 8 per request.

Supported edit variants:

- `add_node`: `node_kind`, `label`, `detail`; generated node ID, `discovered` status.
- `add_edge`: typed relation `SUPPORTS|CONTRADICTS|DEPENDS_ON|IMPLEMENTS|REFERENCES`,
  `from:{id,version}`, `to:{id,version}`; generated edge ID, discovered state.
- `revise_edge`: `edge_id`, updated `from`, `to`; prior version superseded.
- `remove_edge`: `edge_id`; tombstone retained in current workspace.
  No patch can arbitrarily set `verified`, `owner_id`, or billing fields.

## SQLite migration proposal / reserved slot handoff

`docs/handoff/INTELLIGENCE_GRAPH_MIGRATION_PROPOSAL.sql` contains the exact
DDL for `intelligence_graph_workspaces` and
`intelligence_graph_workspace_revisions`. This is a **separate proposal**
and is NOT under `packages/db/migrations` and is NOT recorded as applied.

- Slots **0025–0034** are assigned to other teams and MUST NOT be reused.
- The integrator must check their migration journal and other parallel allocations
  and assign the **next actually free** slot, no default number is assumed.
- Copy SQL through normal Drizzle migration generation/application; do not use
  startup DDL. Update schema metadata and migration journal consistently.
- Scope tables with the existing `projects` owner semantics and preserve FKs.
- Historical snapshot JSON includes owner-entered content: the privacy coordinator
  must implement per-owner export/delete/quiesce. **Do not enable before coverage.**
- Deleting graph workspaces must not cascade into payment/usage history.
  No usage records are created by this module.

## Non-goals and explicit limitations

- No autonomous learning, model weights, self-improving "brain", distributed workers,
  paid calls or fictitious two-million-edge factual graph.
- No changes to Manager Work DAG, Model Gateway, Registry, Policy Engine, A0–A6,
  billing, VPS, secrets, deployment configuration or global design.
- The repository knowledge fixture (#269) is distinct from owner-authored workspaces:
  candidate open PRs do not become verified merely because users link them.
- Graph retrieval paths are navigational context, **not** causal or logical proof.
- Cross-process correctness comes from SQLite `BEGIN IMMEDIATE` + version CAS.
- Until migration + privacy lifecycle + enablement land, the feature is a
  testable integration candidate, **not** a live deployed user feature.

## Verification requirements before enabling

Run `pnpm check` (Prettier, secret scan, lint, types, tests, build, E2E),
SQLite store/revision isolation tests, route identity tests, and a real browser
flow for create -> reopen -> link -> revise -> restore -> explain with a
migrated development DB and production-style owner authorization. Confirm
flag OFF returns 404 and emits no writes. Do not merge automatically.
