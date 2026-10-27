# Intelligence Graph — conflict-aware readings and reports

19 October 2026. Parent Draft PR371 `0d6694457709e55140e6ba2d92aa3c6e8798818f`. Graph runtime remains OFF; no managed migrations, feature registration, model calls or deployment.

## Reading

`explain(owner, project, graph, query, revision?)` can read an exact saved revision. The existing unpinned call remains compatible. HTTP adds optional `revision` and sends `Cache-Control: no-store`.

Relevant conflicts are selected from retrieved stable node identities or literal token overlap with pinned subject/position/decision text, including historical text. This is lexical relevance, never adjudication. Every selected conflict includes all position refs, its subject, its decision if present, and exact version texts in a deduplicated context table.

Budgets: at most 10 conflicts and 60 unique conflict node versions, separate from the existing 24 node / 40 edge / depth 2 / fan-out 8 / 2400 context-token retrieval budget. A conflict is skipped as a whole if its closure would exceed the limit; one side is never silently omitted. Counts, both budgets and truncation are explicit. Stale/open relevant conflicts or truncated conflict review require review even if upstream nodes previously passed verification. An abstention is never upgraded by an owner decision.

Returned navigation paths retain exact seed/target/edge refs. UI states that graph traversal is not a proof. The explanation now shows matched texts, quote locations/source versions, both sides of conflicts, owner decisions, stale refs and Russian concern/status labels.

## Reproducible report

`GET /api/v1/projects/:projectId/intelligence-graphs/:graphId/report?q=...&revision=N` requires explicit revision, strict query validation, active owned project and graph scope. Response is `{report, sha256}`; report format is `kosmora.intelligence-graph-report.v1` and contains the full bounded reading. SHA-256 covers `JSON.stringify(report)`.

Reports contain no wall-clock generation time, random IDs, owner identity or execution state. The same saved revision and normalized query reproduce the same bytes after subsequent graph edits. They are a bounded reading, not the full privacy archive or a certificate of truth. The report has no import/execute endpoint.

The download button uses the displayed reading's saved query and revision, even after the user edits the search draft. It checks format, graph ID, revision, query and hash before creating a local JSON download. Nothing is published or sent to third parties.

## Verification

270 focused tests across 21 files pass on exact graph source. Cases cover old pinned text after deletion, irrelevant reviews, independent verified nodes downgraded to review for open conflicts, resolved/stale decisions, deterministic historical bytes, owner scope, strict query and full-conflict closure at both limits. Backend builds, web/E2E TypeScript, ESLint/Prettier, secrets/diff and production Next webpack build pass. Ten Playwright scenarios are discovered/type-checked; actual Chromium execution is unconfirmed. Hosted CI pass is not claimed (PR371 job failed before steps, runner_id=0).
