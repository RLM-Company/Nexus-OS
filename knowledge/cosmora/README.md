# Cosmora Intelligence Graph knowledge

This directory is the repository entry point for Cosmora's evidence-grounded project knowledge.

It is deliberately separate from the 2M synthetic scale benchmark. Synthetic edges prove storage and
traversal mechanics; they are not project knowledge and must never be mixed into this graph.

## Current snapshot

Authoritative repository baseline:

`main@62bc5234b24e3b0c10262b043063fd31be9732bd`

Current unified graph on the real-knowledge branch:

- 410 nodes;
- 1121 typed edges;
- 410 retrieval records.

Layer breakdown is recorded in `graph-manifest.v1.json`.

## Authority model

The graph contains two evidence classes.

### Verified repository evidence

Merged architecture decisions, source files, contracts, imports, workspace dependencies, merged Git
history and deterministic bridges are authoritative for the repository snapshot they cite.

Typical relation types include:

- `REQUIRES`;
- `CONSTRAINS`;
- `ENFORCED_BY`;
- `IMPLEMENTED_BY`;
- `IMPLEMENTED_IN_FILE`;
- `DEFINED_IN_FILE`;
- `PERSISTED_BY`;
- `CHANGED_FILE`;
- `IMPORTS_FILE`;
- `IMPORTS_MODULE`;
- `DEPENDS_ON_MODULE`;
- `PRECEDES`;
- `HARDENS`.

### Candidate / open-review evidence

Open pull requests are useful project knowledge, but they are not current runtime truth.

They are therefore stored as `discovered` nodes and edges with relation types such as:

- `STACKED_BEFORE`;
- `PROPOSES_CHANGE_TO`;
- `PROPOSES_CONSTRAINT_FOR`.

Queries with `verified_only=true` exclude these candidates.

A merged PR must be re-ingested from `main` as verified Git evidence; its candidate representation
must not be silently treated as equivalent to a merge.

## Materializing the graph

The deterministic exporter writes a complete machine-readable snapshot:

```bash
pnpm --filter @cosmora/api exec node --import tsx --conditions=development \
  ../../scripts/export-cosmora-intelligence-graph.ts \
  --output-dir=../../knowledge/cosmora/generated
```

It produces:

- `nodes.ndjson`;
- `edges.ndjson`;
- `records.ndjson`;
- `snapshot.json`;
- `manifest.generated.json`.

The generated manifest contains SHA-256 checksums and verification-state counts.

The generated directory is an artifact. Source-of-truth relationships remain the evidence-grounded
graph sources and repository evidence they cite.

## Knowledge quality rules

1. Every edge must have a concrete reason to exist.
2. Similarity alone is not a factual relationship.
3. Repository and Git evidence is preferred over inferred prose.
4. Open PRs remain candidate knowledge until merged.
5. Model-only inference cannot self-promote to verified fact.
6. Conflicts are preserved instead of overwritten.
7. Historical events use their actual Git timestamps.
8. Private-chat material is not persistent graph knowledge.
9. Secret-like material is rejected from fixture ingestion.
10. The graph must improve retrieval or project reasoning; edge count is not a quality metric.

## Growth strategy

Prefer deterministic extraction where the repository can prove the relationship:

- Git commit → changed file;
- file → module;
- source file → imported module/file;
- workspace package → declared dependency;
- ADR/contract → implementation file;
- durable concept → persistence store;
- PR → exact proposed files;
- stacked PR → parent proposal;
- merged change → work-experience event.

Use curated semantic edges for relationships that require understanding rather than syntax, such as
why a policy constraint exists or why one artifact is authoritative over another.

Regression impact is explicit: `VERIFIED_BY_TEST` connects high-value decisions and constraints to
the exact repository tests that exercise them. This enables `rule → implementation → regression`
impact queries without guessing from file names.

Agent collaboration is represented from the actual Manager runtime role contracts: each role's
accepted/emitted artifact kinds, Manager delegation boundary, Critic review capability, and the
shared no-external-authority / no-permission-authority / no-policy-bypass constraint.

Runtime safety scenarios are first-class Evaluation nodes. They map release-gate scenarios to the
policy, routing, memory, checkpoint, critic and Emergency Stop rules they exercise, plus the exact
catalog/runner tests that verify those scenarios.

CI learning is retained as verified work experience: failed quality-gate runs are connected to the
issue they exposed, the fix that resolved it, and the next validation run. A final green run is
stored as branch evidence rather than silently discarded once the PR passes.

Runtime interfaces are modeled as compact API families rather than one node per HTTP method. Each
family carries the exact route patterns in retrieval text and connects to its handler file, owner
identity boundary, domain state, Model Gateway or Policy/Step-up controls, and concrete API tests.

Do not create bulk generic `RELATES_TO` edges to inflate graph density.
