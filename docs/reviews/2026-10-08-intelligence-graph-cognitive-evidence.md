# Intelligence Graph: deterministic cognitive evidence gate

Date: 2026-10-08  
Branch: `codex/intelligence-graph-cognitive-evidence-20261008`  
Parent: `codex/intelligence-graph-real-knowledge-20260929` (#269)

## Why

The project graph already distinguishes verified facts, hypotheses, discovered proposals,
and versioned history. The retrieval layer previously applied `verified_only` to
**nodes**, not to **edges**. If two verified nodes were linked by a discovered
or model-only relationship, that relation could still enter a verified-only packet.
Because traversal fan-out was limited _before_ edge verification, untrusted edges
could also crowd out verified ones. This must fail closed before using graph
output to inform decisions.

## Proposed cognitive process (read-only)

```text
user query + owner/project scope
  -> bounded lexical seed retrieval
  -> verified node AND verified edge filter (historical as_of is explicit)
  -> bounded graph traversal and path reconstruction
  -> path integrity audit and source-reference inventory
  -> readiness: grounded_context | review_required | abstain
  -> eventual Manager / Critic consumer (separate integration)
```

The new `runIntelligenceGraphCognitiveCycle` helper performs a **deterministic,
public evidence audit**. It does not expose or simulate a hidden model thought chain.

- `verified_only` defaults to true. Exploratory mode is opt-in.
- An edge is admissible in verified-only mode if it is `verified`, or if it is
  `superseded` and explicitly queried in a valid temporal slice.
- Unverified edges are removed **before** applying `max_fan_out`.
- Path auditing ensures every returned navigation path is continuous and connects
  existing packet nodes through included edge versions.
- Distinct `source_ref.source_id` values are counted as references, **not**
  independently corroborated authorities.
- `grounded_context` means graph context passed these checks; it never means a
  proposition, generated answer, or planned action has been proved correct.
- A candidate relation, disputed node, or truncated result triggers
  `review_required`; missing verified context, too few distinct source refs,
  or invalid navigation paths triggers `abstain`.
- The gate makes **no writes**, tool calls, API calls, model requests, policy
  changes, approvals, financial actions, migrations or VPS changes.

## Separate the three trust decisions

1. **Retrieval**: are these versioned nodes and relationships visible and
   admissible for this owner, project, and requested time?
2. **Evidence readiness**: is the retrieved context suitably grounded for
   downstream consideration? This module decides only this point.
3. **Action authority**: may an agent execute a command or publish a result?
   This is always evaluated by the existing Manager, Policy Engine, Tool Runtime,
   owner approval and Step-Up boundaries; the intelligence graph never grants it.

A navigable path is **not** logical entailment: an undirected graph traversal
may walk through context, dependency, implementation, or negative edges.
Future semantic reasoners must interpret relation direction, contradiction,
time and evidence independently rather than treating hop count as proof.

## Acceptance tests

- `verified_only` omits discovered and model-only edges even when both
  endpoint nodes are verified;
- candidate edges are removed before fan-out limits, preserving verified neighbors;
- past, superseded edge versions remain available only for valid temporal queries;
- strict mode yields grounded context from a verified source path;
- exploratory candidates return `review_required`, not verified truth;
- missing verified evidence and an unmet source-reference threshold yield
  `abstain`;
- truncated traversals return `review_required`.

## Status / integration

This change is deliberately stacked **on #269**, not on `main`.
It is a proposed pure-core and test slice, with no live Manager/API integration.
Before merge: run the package test suite and repo typecheck in a working CI runner,
inspect any regression from the tightened trust filter, then integrate in order:
Package B/C -> #269 -> this change (or rebase safely after #269).
Do not auto-merge or deploy.
