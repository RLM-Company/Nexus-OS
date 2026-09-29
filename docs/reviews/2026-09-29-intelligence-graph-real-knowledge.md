# Intelligence Graph — real Cosmora knowledge checkpoint

**Date:** 2026-09-29  
**Branch:** `codex/intelligence-graph-real-knowledge-20260929`  
**Base:** Package C retrieval branch  
**Scope:** curated, evidence-grounded project knowledge and implementation history

## Why this exists

The 2M-edge Package E run is a scale benchmark only. It proves mechanics, not intelligence.

This branch is the opposite: it contains only relationships that can be tied to a concrete
repository source and that carry useful semantics for future reasoning.

No edge is added merely to increase graph density.

## Current graph

The semantic fixture compiles to:

- **97 nodes** including the repository snapshot Source;
- **140 typed semantic edges**;

The unified semantic + repository-structure + work-experience graph now contains:

- **286 nodes**;
- **775 typed edges**;
- **0 generic `RELATES_TO` edges**;
- every non-Source node has at least one graph relationship;
- every node and edge points to a non-fixture repository evidence location.

The graph is project-bound to Nexus-OS and contains no private-chat material, credentials or model
secrets.

## Covered knowledge domains

### Model routing and gateway

The graph connects:

`ADR-003 → registry authority → Model Registry → Router`

and separately:

`ADR-002 → all model access → Model Gateway → Router`

It records constraints for:

- hard filtering before scoring;
- fail-closed routing;
- dated external-route evidence;
- route trace and usage accounting;
- fallback only before the first text delta;
- server-only provider credentials;
- provider/model/token persistence.

The durable Manager runtime is connected to the Model Gateway because the current coordinator calls
the gateway for its model stages.

### Agent Studio and authority

The graph connects:

`ADR-004 → six-part composition → Agent instance`

`ADR-004 → instruction precedence → Agent instance`

`ADR-004 → no permission expansion → Policy Engine + Agent instance`

The decision nodes are then connected to concrete repository events:

- modular Agent Studio contracts;
- inert blueprint persistence;
- owner root proposal API.

This preserves the difference between a design decision and when that decision became code.

### Durable Manager work

The graph represents the current Manager work state machine and links the current runtime artifact to:

- `workspace.write` policy enforcement for publish;
- disabled model fallback;
- token/model-request budget reservation;
- process/project Emergency Stop;
- owner pause/resume/approve/cancel controls;
- A0/A1 and complex-A2 approval gates;
- project usage accounting;
- Model Gateway access.

These are constraints, not merely topical similarity edges.

### Runtime context and memory safety

The graph represents Runtime Context as a bounded data envelope and connects it to:

- task/project/role identity;
- declared task artifacts and memory sources;
- allowed data classes;
- `data_only` treatment for untrusted instructions;
- forbidden private-chat persistence;
- the project-bound runtime task graph.

The browser-local Project Context panel has an explicit:

`NOT_AUTHORITY_FOR → Runtime Context`

edge. This prevents the future memory system from conflating a UI preview with authoritative model
context.

### Runtime artifacts, provenance and recovery

The graph connects artifact/recovery invariants:

- artifact instructions are always data-only;
- artifact provenance is project-local and acyclic;
- source artifacts cannot come from the future;
- checkpoints are bound to their task graph;
- checkpoints do not restore permissions, sessions or autonomy escalation;
- resolved agent conflicts require a resolution artifact;
- Manager may arbitrate conflicts;
- Critic may review artifacts but may not bypass policy.

### Identity and step-up

Authentication evidence is connected to the identity/session model.

The graph records that identity sessions have explicit assurance, expiry and revocation lifecycle.

Step-up proofs are represented as short-lived, purpose-bound evidence and are connected to their
identity session. Their enumerated purposes include autonomy escalation, critical-tool confirmation,
Emergency Stop clearance and project-usage-limit expansion.

### Companion

Live Companion contracts are connected to their implementation event and to:

- frequency/daily-cap/minimum-gap/quiet-hour preferences;
- suppression reasons such as authentication, scope, activity and safety;
- in-app/push/Telegram surfaces.

The Companion gate depends on the authentication boundary rather than treating proactive messaging as
an unconditional permission.

### Usage and cost evidence

The graph represents project usage as explicit accounting state:

- reserved, committed, failed and cancelled attempts;
- committed/reserved token counts;
- known cost;
- **unknown cost remains unknown** rather than being fabricated;
- versioned token/cost limits.

Manager model reservations and routing trace requirements connect to this accounting node.

## Work-experience timeline

Repository Events are dated with their actual commit time, not the graph-build time.

Current implementation chain includes:

- `e5e1195` — initial versioned Model Registry and Router;
- `7be9f87` — runtime routing and atomic usage ledger;
- `cb802ac` — fail-closed unverified external routes;
- `a70f88d` — modular Agent Studio contracts and delegation validator;
- `617a6e8` — inert blueprint persistence;
- `0720b7f` — owner root proposal API;
- `479c016` — Live Companion contracts;
- `b2b5030` — Google/Telegram auth contracts;
- `62bc523` — durable Manager work runtime.

`PRECEDES`, `IMPLEMENTED_BY` and `PRODUCES` edges use those dates so historical retrieval can
distinguish what existed at different points in repository history.

## Repository structure and work-experience joins

The semantic graph is joined to deterministic repository structure rather than kept as an isolated
curated map.

The unified graph records:

- file → workspace-module membership;
- source/test file → imported file/module;
- workspace module → declared workspace dependency;
- semantic concept → contract/implementation/store file;
- implementation event → exact files changed by the corresponding Git commit;
- chronological `PRECEDES` relationships between recent hardening and product events.

For example, the durable Manager runtime event at `62bc523` is connected by `CHANGED_FILE`
edges to its coordinator, routes, Manager contract, persistence store, usage store, Model Gateway,
Policy Engine and Tool Runtime files. Google/Telegram auth and Live Companion events are similarly
connected to the exact contract and regression-test files changed by their commits.

Recent hardening events also preserve concrete history:

- `f413dd2` — core direct model-request bounds;
- `1a710aa` — shared model-request contract bounds;
- `7acf996` — canonical stream-completion metadata;
- `479c016` — Companion contracts;
- `b2b5030` — Google/Telegram auth contracts;
- `62bc523` — durable Manager work runtime.

These are evidence-backed work-experience relationships, not semantic similarity guesses.

## Quality rules exercised by tests

The focused tests check that:

1. the graph compiles under the Package B invariants;
2. the exact node/edge count is stable;
3. every non-Source node is connected;
4. no evidence location is a synthetic `fixture:` location;
5. the curated graph contains no generic `RELATES_TO` edge;
6. Manager publication retrieves its Policy Engine requirement;
7. delegation retrieves the no-authority-expansion rule;
8. Project Context remains separate from runtime context;
9. route freshness retrieves the Registry/Router path;
10. Critic review authority remains distinct from policy authority;
11. Companion authentication dependency is preserved;
12. private-chat and untrusted-instruction context rules are retrievable;
13. gateway fallback boundaries are retrievable;
14. step-up evidence is bound to identity session;
15. unknown model cost remains explicit;
16. architecture decisions connect to their implementation commits;
17. temporal retrieval can see the Registry foundation before later runtime/fail-closed commits;
18. provenance, checkpoint and conflict constraints exist as explicit graph structure.

## What is not claimed

This graph is still a curated first slice. It does not contain every repository fact and it does not
pretend that 140 useful edges are equivalent to millions of learned relationships.

The correct growth strategy is:

1. add high-value real relationships;
2. build deterministic extraction for relationships that are structurally provable;
3. separately evaluate whether those edges improve retrieval/reasoning;
4. reject low-confidence inferred links or keep them as hypotheses;
5. never inflate the graph with arbitrary similarity edges.

The 2M synthetic benchmark remains separate and should never be reported as 2M learned Cosmora facts.
