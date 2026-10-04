# Cosmora Intelligence Graph knowledge

This directory is the repository entry point for Cosmora's evidence-grounded project knowledge.

It is deliberately separate from the 2M synthetic scale benchmark. Synthetic edges prove storage and
traversal mechanics; they are not project knowledge and must never be mixed into this graph.

## Current snapshot

Authoritative repository baseline:

`main@62bc5234b24e3b0c10262b043063fd31be9732bd`

Current unified graph on the real-knowledge branch:

- 572 nodes;
- 1716 typed edges;
- 572 retrieval records.

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

## State and persistence

Persistent runtime state is explicit rather than inferred from file names. The graph maps Manager
work, project usage, identity sessions, policy decisions, agent blueprints and General Chat runtime
to the exact stores that persist them.

State-specific invariants include idempotency, optimistic versioning, fail-closed recovery without
automatic replay, unknown-cost preservation, owner/project scoping, session-token hashing and atomic
queued-run claims. Agent Blueprint persistence is modeled separately from runtime Agent Instance state.

## Model Intelligence

Model Intelligence is **observe/recommend-only**. It never activates a route and never replaces the
Model Registry or Router.

The graph currently records:

- the checked-in bootstrap `mock:manager-b0.1` ModelVersion;
- the checked-in owner-preview `vibecode:gpt-5.5` and
  `vibecode:claude-sonnet-5` ModelVersions;
- Registry evidence, streaming capability, privacy compatibility, pricing status, Router hard
  filters and deterministic scoring;
- runtime binding tests that require an active Registry route.

The VibeCode owner-preview observations are time-bounded to their Registry evidence window and have
`valid_to = 2026-10-13T00:00:00.000Z`. They are explicitly marked non-confidential-compatible with
unknown pricing, so the graph cannot silently turn preview metadata into a confidential or
cost-bounded recommendation.

## Memory Governance

Memory governance distinguishes **owner-approved specification** from **current runtime
enforcement**.

The owner-approved Memory Constitution v1.1 explicitly says it is not runtime policy by itself.
Accordingly, the graph uses different relationship types:

- `RUNTIME_GUARDED_BY` for rules backed by current validators;
- `PROPOSES_PARTIAL_ENFORCEMENT_IN` where an unmerged Intelligence Graph PR proposes partial enforcement;
- `SPEC_ONLY_UNTIL_IMPLEMENTED` where the approved rule has no verified runtime enforcement yet.

The current layer includes D0–D4 data classes, project isolation, data-only treatment for untrusted
instructions, provenance constraints, versioned corrections and private-chat exclusion.

`D4_PRIVATE_CHAT` is already blocked from persistent write-back by the merged Manager runtime.
The stricter Intelligence Graph snapshot-persistence rejection exists in open PR #269 and is stored
as candidate knowledge until that change is merged. Deletion/trash behavior, global-owner-memory
authorization, training-setting precedence, source transparency and memory-secret exclusion remain
explicitly spec-only until their dedicated runtime paths exist.

## Authority & Capability

The graph now materializes the actual Cosmora authority model instead of treating policy as a
single opaque component.

The layer contains **41 nodes** and **222 typed relationships**, including the complete canonical
autonomy matrix:

- 19 capability IDs;
- 7 autonomy levels (A0–A6);
- 5 permission modes;
- all **133 capability × autonomy-level cells** from `AUTONOMY_MATRIX`;
- the 7 capabilities listed by `STEP_UP_CAPABILITIES`;
- all four Step-Up proof purposes;
- capability profiles, permission contracts, Guarded Tool Runtime and agent-delegation validation.

The layer also records runtime safety properties verified by tests: compound actions take the
strictest affected capability, conditional expansions only come from the trusted runtime resolver,
scoped controls fail closed when a tool cannot enforce them, and child agent delegation cannot
expand capabilities, tools, data scopes, objects, budgets, delegation depth or expiry.

## Execution & Recovery

The graph now materializes the durable execution state machines instead of representing recovery
only as isolated scenarios.

The layer contains **33 nodes** and **108 relationships** across:

- Manager Work stages and statuses;
- Policy / Tool Operation statuses;
- Confirmation lifecycle;
- Step-Up proof lifecycle;
- recovery and replay invariants.

Verified paths distinguish safe replay from uncertain external effects. A completed policy
operation may replay its stored result, while an already RESERVED operation returns
`RECOVERY_REQUIRED` rather than silently invoking the tool again. Interrupted Manager work also
fails closed: work with an in-flight provider call or publish stage becomes
`RECOVERY_REQUIRED`; otherwise it recovers to a durable pause without automatic replay.

Confirmation is modeled as PENDING → APPROVED / REJECTED / EXPIRED and APPROVED → CONSUMED.
Step-Up proof is modeled as active → consumed / expired. Runtime checkpoints remain explicitly
unable to restore permissions, sessions or autonomy escalation.

## Identity & Trust

The graph now models how identity trust is created, bounded and revoked instead of representing
authentication as a single generic session node.

The layer contains **31 nodes** and **76 relationships** covering:

- owner, system and agent actor kinds;
- active/disabled actor state;
- active/revoked/expired session state;
- local, single-factor and multi-factor assurance;
- the exact Google/Telegram external-auth provider set;
- external-identity verification states;
- all seven identity/Step-Up audit event types;
- owner-scoped session and audit access;
- hashed session-token storage rather than raw-token persistence;
- exact one-use Step-Up binding to owner/session/purpose/challenge;
- fail-closed Step-Up behavior after expiry or session revocation;
- owner-only API access, with agent/system sessions rejected at that boundary.


## Data Lineage & Provenance

The graph now represents provenance as a first-class runtime structure rather than a generic
relationship.

The layer contains **19 nodes** and **62 relationships** covering:

- all four RuntimeArtifact source-trust classes: system, owner, project and external-untrusted;
- unique artifact identity and same-project provenance;
- rejection of self-references, unknown sources, future sources and provenance cycles;
- artifact-to-task binding;
- producer-role / assigned-role consistency;
- task-declared output kinds and input-artifact lineage;
- artifact chronology relative to task and task graph;
- Critic review lineage limited to supported, existing, same-project artifacts created before the
  verdict.

Every lineage invariant points to its validator and regression test. External-untrusted source trust
is also tied back to the existing data-only instruction boundary.
