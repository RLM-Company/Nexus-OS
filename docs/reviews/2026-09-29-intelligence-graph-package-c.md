# Intelligence Graph Package C — fixture ingest and bounded retrieval

**Date:** 2026-09-29  
**Status:** IMPLEMENTED IN STACKED REVIEW BRANCH / EXECUTABLE CI NOT YET CONFIRMED  
**Branch:** `codex/intelligence-graph-package-c-20260929`  
**Dependency:** Package B contract head `9b6d53be450b95e1ef22d0ac6222b9f037899d71`

## Purpose

Package C is the first slice that creates and queries an actual Cosmora Intelligence Graph.

It deliberately uses authorized deterministic fixtures rather than LLM extraction or private project
content. This proves graph semantics, retrieval behavior and evaluation mechanics before any runtime
database, paid model, background indexer or production integration is introduced.

## Implemented

### Authorized fixture ingest

`compileAuthorizedIntelligenceGraphFixture` turns one explicitly scoped fixture into:

- a project-bound `Source` node;
- typed graph nodes;
- typed relations;
- bounded lexical search records.

The compiler rejects:

- malformed IDs, timestamps and relation types;
- references to unknown node versions;
- duplicate node or edge versions;
- secret-like material;
- `D4_PRIVATE_CHAT` material;
- graph snapshots that violate Package B invariants.

Model inference remains hypothesis data unless an independent verification method supports promotion.
A fixture that marks model-only inference as verified is rejected by the graph validator.

### Bounded retrieval

`IntelligenceGraphIndex` provides four deterministic modes:

1. `baseline` — lexical retrieval only, no graph traversal;
2. `local` — seed records plus one graph neighborhood;
3. `multi_hop` — bounded breadth-first evidence traversal;
4. `temporal` — historical retrieval with `as_of` validity filtering.

Every graph query has hard limits for:

- depth;
- returned nodes;
- returned edges;
- fan-out;
- estimated context tokens.

Cycles use a visited set. High-degree neighborhoods are clipped. The returned EvidencePacket records
whether the result was truncated and contains explicit seed-to-target edge paths.

The index is bound to one owner and project. A query with another project ID fails closed.

### Historical versions

Current retrieval excludes superseded and deleted versions by default.

Temporal retrieval can expose a superseded historical version when it was the valid version at the
requested instant. Later versions are excluded if they did not yet exist.

### Insufficient-evidence behavior

A model-only hypothesis can be returned as unresolved context when explicitly allowed, but it does
not make `sufficient_evidence=true`.

With `verified_only=true`, unsupported hypotheses are excluded.

### Baseline comparison

`evaluateIntelligenceGraphRetrieval` runs the same labeled evidence cases through multiple retrieval
modes and records:

- precision;
- recall;
- sufficient-evidence rate;
- truncation rate.

The included deterministic evaluation fixture is intentionally constructed so the query lexically
finds an implementation artifact while the expected decision and supporting claim require graph
traversal. The test asserts that multi-hop evidence recall exceeds the baseline and reaches the full
labeled evidence chain.

This is a test design assertion until executable CI runs; no benchmark result is claimed from an
unexecuted test.

## Research rationale

Microsoft GraphRAG documentation distinguishes Basic, Local, Global and DRIFT query modes rather than
using graph traversal for every question. Local search combines graph structure with source text,
while Global Search is described as resource-intensive and aimed at whole-corpus questions. Package C
therefore implements a cheap baseline, local traversal and bounded multi-hop first; it does not run
global summarization on every message.

- https://microsoft.github.io/graphrag/
- https://microsoft.github.io/graphrag/query/overview/
- https://microsoft.github.io/graphrag/query/local_search/
- https://microsoft.github.io/graphrag/query/drift_search/

Gutiérrez et al., *From RAG to Memory: Non-Parametric Continual Learning for Large Language Models*
(ICML 2025), note that graph-structured retrieval approaches can improve associative/sense-making
memory while some approaches regress simpler factual memory. Package C therefore keeps baseline
retrieval as a mandatory comparison rather than assuming graph retrieval is always superior.

- https://proceedings.mlr.press/v267/gutierrez25a.html

Rasmussen et al., *Zep: A Temporal Knowledge Graph Architecture for Agent Memory* (2025), evaluate
temporally aware graph memory for changing information and cross-session retrieval. Their reported
results are not treated as Cosmora results. Package C uses only the architectural lesson that
historical facts require explicit time-aware retrieval.

- https://arxiv.org/abs/2501.13956

## Repository-grounded fixture

Package C now also includes a non-secret graph compiled from the current Cosmora repository evidence
snapshot. It is not synthetic domain prose: its nodes represent current project architecture facts
and one explicit documentation/runtime contradiction.

The fixture currently links:

- Cosmora OS project → owner-control goal;
- owner-control goal → Model Registry routing decision;
- Model Registry decision → Router hard-filter evidence;
- project-memory isolation → Project Context preview boundary;
- project-memory isolation → no-automatic-training decision;
- current durable Manager runtime evidence ↔ disputed older README boundary via `CONTRADICTS`.

Focused queries verify that retrieval can surface the Router evidence path, the memory/context/training
boundaries, and the unresolved Manager documentation conflict instead of silently selecting whichever
statement is more convenient.

## Deliberately not implemented

Package C does not add:

- LLM-based entity or relationship extraction;
- embeddings or a vector database;
- community detection or global summaries;
- a production graph database;
- persistence or migrations;
- background indexing;
- Manager/API/Router integration;
- cross-project memory;
- confidential-chat persistence;
- model fine-tuning;
- automatic model routing changes;
- million-edge load tests.

Those remain later packages and require executable correctness evidence first.

## Verification gate

Package A and B GitHub Actions runs have repeatedly failed before executing any job steps
(`steps: null`). Package C is therefore stacked on the exact Package B head instead of merging
unverified contracts into `main`.

Before integration:

1. Package B must receive a real executable TypeScript/Vitest/quality-gate run.
2. Package C must receive its own executable run.
3. If B is merged, C must be rebased onto the then-current `origin/main`.
4. The diff must be rechecked for forbidden runtime areas.
5. No claim of graph-quality improvement is valid until the labeled evaluation actually executes.

## Next slice after green correctness evidence

The next Package C extension should add a larger non-secret labeled fixture suite covering:

- exact factual lookup;
- two-hop and three-hop evidence;
- “why was this decision made?”;
- “what changed?”;
- contradictory claims;
- high-degree entities;
- deleted sources;
- deliberately irrelevant neighbors.

Only after that should Package D add model/agent evaluation observations, and Package E start
synthetic scale work.
