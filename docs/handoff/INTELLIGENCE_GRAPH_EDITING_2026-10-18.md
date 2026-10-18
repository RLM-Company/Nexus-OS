# Intelligence Graph: authoring, transport and historical verification

Separate continuation of graph workspace PR #322, parent `26bc8cbd532ed002893d8866cf005882d912f48f`. Product Work/Skills/Canvas branches are not merged. Runtime registration remains OFF; the existing managed-migration and privacy integration requirements still apply. No paid model calls, generated scale data, deployment or main merge.

## Behavior

- Revision-CAS rename, node text revision and deletion. Editing rebinds incoming/outgoing live edges to a new node version and creates discovered relation versions. Old node text, edge endpoints and evidence remain in past workspace snapshots. Deletion creates a node tombstone and removes live incident edges without breaking historical supersession chains. Existing total-version limits (150 nodes/search records, 300 edges) remain; edits fail atomically when full.
- Literal node search, editing and deletion confirmation in the Russian monochrome workspace. Failed edits keep draft text. A successful write is accepted before secondary list/history refresh. Project changes clear the old selection.
- Strict `kosmora.intelligence-graph.v1` content-only JSON (800,000 UTF-8 bytes, 150 nodes/300 edges). Unknown fields, missing endpoints, self links and duplicate IDs fail. Browser and server validate independently. Import preview includes exact text and canonical-package SHA-256; POST requires the reviewed hash. A single repository create atomically stores the complete fresh graph with fresh IDs, revision 1 and discovered statuses. Source hashes are recorded as provenance. No verification/identity/permissions/history are imported. Export renumbers portable node keys; its hash can differ from the original import's source hash, which remains in provenance.
- Current and selected old revisions can be exported. Before restore, the UI shows exact changes to active text/types/statuses/versions and edges, then requires review. Confirmation is bound to project, graph and displayed base revision. Server CAS rejects a newer remote state. Read-only historical snapshots remain intact.
- Additive optional `previous_verification_status` on superseded node/edge records. Temporal retrieval and cognition require an explicit previous `verified` status; legacy unknown/candidate history is never promoted by replacement alone. Model-only historical verification is rejected. Validity end timestamps are exclusive. Workspace edits record the true pre-replacement status.

## HTTP additions (still behind existing OFF integration gate)

- `POST .../intelligence-graphs/:graphId/edits`: `rename`, `revise_node`, `remove_node`.
- `GET .../:graphId/revisions/:revision`.
- `GET .../:graphId/package?revision=N`: portable content + canonical SHA-256 + source revision, no-store.
- `POST .../intelligence-graphs/import/preview`: `{package}`; read-only.
- `POST .../intelligence-graphs/import`: `{package, expected_sha256}`; creates an independent graph.

Imports intentionally do not automatically retry after a lost response. This slice has no durable import receipt: verify the graph list before a new attempt, especially after reload. The current tab blocks uncertain repeated imports until explicit dismissal. Integration must retain this limitation or add durable idempotency before enabling broad use.

## Validation

- 195 focused tests passed on exact parent source plus this delta: kernel, cognitive evidence, retrieval/evaluation, real-knowledge fixtures/manifest, authoring, transport HTTP, SQLite persistence/reopen and UI comparison.
- Core/API/web TypeScript; contracts/core/DB builds; Next webpack production build (12 generated pages) passed on the separate graph source, with unchanged parent dependencies.
- Changed source ESLint, Prettier, diff and secret checks passed. Playwright types and discovery cover three new UI contract scenarios; Chromium is absent, so browser execution is not claimed.
- Real knowledge counts and candidate/verified boundaries are unchanged. The 2M synthetic benchmark is not represented as meaningful knowledge.
