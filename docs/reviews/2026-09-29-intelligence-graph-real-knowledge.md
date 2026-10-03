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

- **434 nodes**;
- **1205 typed edges**;
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

## Open-review knowledge without authority leakage

The unified graph now records two open, unmerged work streams as candidate knowledge:

- Manager execution-contract hardening (#229, #237–#245);
- Settings / Companion / communication controls (#221, #244, #246, #248, #250, #252, #254, #257).

These nodes and edges use `verification_status = discovered`. Their relation vocabulary includes
`STACKED_BEFORE`, `PROPOSES_CHANGE_TO`, `PROPOSES_CONSTRAINT_FOR`,
`PROPOSES_UI_FOR`, `EXPOSES_CONTROL_FOR` and
`REQUIRES_EXPLICIT_CONSENT_FOR`.

They are intentionally visible for roadmap/review questions while `verified_only=true` removes
them from authoritative retrieval.

The graph therefore distinguishes:

- what is true in merged `main`;
- what was implemented historically;
- what is currently proposed in open PRs.

This prevents planning context from silently becoming runtime truth.

## Canonical knowledge artifacts

The repository now contains:

- `knowledge/cosmora/graph-manifest.v1.json` — machine-readable layer/count/authority manifest;
- `knowledge/cosmora/README.md` — consumption and quality rules;
- `scripts/export-cosmora-intelligence-graph.ts` — deterministic full snapshot exporter.

The exporter emits sorted node, edge and retrieval-record NDJSON plus `snapshot.json` and a generated
manifest with SHA-256 checksums.

## Verified product history

The graph now also records merged product evolution before the durable Manager runtime:

- background ordinary-chat execution (#145);
- read-only model connection status (#144);
- guarded live model smoke (#150);
- integrated non-API local-alpha hardening (#191);
- loopback-only local API proxy hardening (#200);
- direct Manager/chat model-request validation (#192);
- core runtime-boundary documentation (#193);
- web runtime architecture-boundary tests (#195).

These events connect to concrete implementation files, regression tests and semantic entities such as
the Model Registry, project-context surface and Agent Studio. The chronology is joined to the later
credential/model hardening history rather than stored as an isolated list.

## Regression impact layer

The unified graph now includes **27** deterministic `VERIFIED_BY_TEST` edges.

Examples include:

- routing evidence freshness → `packages/model-gateway/test/router.test.ts`;
- gateway fallback boundary → `packages/model-gateway/test/gateway.test.ts`;
- delegation no-expansion → `packages/policy-engine/test/agent-delegation.test.ts`;
- Manager publication / usage reservation / Emergency Stop → `apps/api/test/manager-work.test.ts`;
- D4 private-chat no-persistence → runtime-context validation tests;
- provenance acyclicity → artifact-provenance tests;
- checkpoint graph binding → checkpoint tests;
- conflict resolution artifact requirement → conflict tests;
- usage versioning / token-cost fail-closed behavior → usage-limit tests.

This turns the graph into a change-impact map rather than a static documentation index.

## Intelligence Graph development history

Open PRs #264–#269 are also represented as candidate work-experience evidence.

The graph preserves the actual branch topology:

- #264 architecture and #265 kernel both started from `main`;
- #265 → #266 retrieval;
- #266 → #267 Model Intelligence → #268 synthetic scale;
- #266 → #269 real knowledge.

A dedicated `SEPARATES_REAL_KNOWLEDGE_FROM` edge records that #269 intentionally excludes the
2M synthetic benchmark from project knowledge.

Because all six PRs remain open, these nodes are `discovered`, not authoritative merged facts.

## Agent Collaboration Graph

The unified graph now includes a real collaboration layer derived from
`MANAGER_RUNTIME_ROLE_CONTRACTS`.

It models:

- Manager, Architect, Researcher, Analyst and Critic role nodes;
- `ACCEPTS_ARTIFACT_KIND` and `EMITS_ARTIFACT_KIND` edges;
- plan, architecture, evidence, analysis, decision, handoff, checkpoint and critic-verdict artifact kinds;
- Manager's bounded delegation capability;
- Critic's review capability;
- the shared rule that all five roles are project-bound and have no external-action authority,
  permission authority or policy bypass.

This lets retrieval infer collaboration through shared artifacts rather than inventing direct
role-to-role relationships.

## Runtime Safety Scenario Graph

The graph now contains **19** verified scenario-evaluation nodes and **45** scenario relationships
derived from `MANAGER_RUNTIME_SCENARIOS`.

It covers:

- agent conflict and Manager arbitration;
- serious/false Critic behavior;
- bounded project memory;
- autonomy A0–A6;
- Emergency Stop;
- model switching and timeout fallback;
- operation replay/idempotency;
- project recovery;
- prompt injection;
- memory poisoning;
- cross-project isolation.

Every scenario is linked to the safety rule/component it evaluates and to the catalog validation
test. Scenarios directly exercised by the scenario runner also carry `EXECUTED_BY_TEST` edges.
The A6 scenario additionally requires the verified Step-up proof boundary.

## CI Learning Graph

The graph now records the actual quality-gate learning sequence for PR #269.

It preserves:

- run #1001 → formatting failure → repository Prettier fix;
- run #1005 → lint/source-ID issues → lint-fix sequence;
- run #1006 → temporal query typing issue → exactOptionalPropertyTypes fix;
- run #1007 → graph record-time/source-time confusion → candidate temporal-model fix;
- run #1011 → stale auth-test expectation → identity-test correction;
- run #1018 → ambiguous mobile Manager locator → targeted Playwright selector fix;
- run #1026 → complete green monorepo quality gate.

Relationships use `FOUND_ISSUE`, `RESOLVED_BY`, `VALIDATED_BY`,
`PRECEDES` and `CONFIRMS_GREEN_GATE_FOR`.

This makes failed checks reusable project knowledge instead of disposable CI noise.

## Runtime Interface Graph

The graph now includes **7** verified API-family nodes and **37** source-backed interface
relationships from current `main`.

Covered interface families:

- Manager Work;
- General Chat;
- Identity;
- Emergency Stop / clearance;
- Model Runtime status;
- Project Usage limits;
- Autonomy / policy profiles.

All non-health APIs are linked to the fail-closed owner identity boundary. High-impact mutations are
also connected to their exact Step-up purpose where the source code requires it. Interface families
link to the concrete handler file and API regression tests rather than duplicating every GET/POST as
a separate graph node.

This enables queries such as:

`usage limit → API family → Step-up proof → test`

and:

`General Chat API → persisted runtime → Model Gateway`.

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

## State & Persistence Graph

The graph now includes **6** verified store entities, **1** explicit Agent Blueprint concept and **33** persistence relationships.

It records:

- Manager Work persistence, client-request idempotency, optimistic versioning and recovery without
  automatic replay;
- project Usage Ledger persistence, versioned limits and preservation of unknown cost;
- owner-scoped Identity sessions with hashed token evidence;
- Policy operation idempotency, decision traces and recovery-required operations;
- versioned, project-bound Agent Blueprint persistence, explicitly distinct from runtime Agent Instance state;
- General Chat atomic queued-run claim and duplicate-execution guard.

Each store is connected to its exact source file, and where dedicated regression coverage exists, to
the corresponding test file.


## Model Intelligence Graph

The unified graph now includes **17** Model Intelligence nodes and **51** evidence-grounded
relationships.

Verified ModelVersion observations:

- `mock:manager-b0.1` from the default bootstrap Registry;
- `vibecode:gpt-5.5` from the owner-preview Registry;
- `vibecode:claude-sonnet-5` from the owner-preview Registry.

The two VibeCode observations are temporal: their authorized-discovery evidence is valid from
2026-09-13 through 2026-10-13, and graph validity follows that evidence window.

The layer records:

- Registry membership and exact source documents;
- streaming capability;
- bootstrap confidential compatibility and zero pricing;
- VibeCode non-confidential restriction and unknown pricing;
- Router hard-filter and deterministic-scoring evaluations;
- runtime binding checks requiring an active Registry route.

A dedicated `claim-model-intelligence-recommend-only` node has
`NOT_AUTHORITY_FOR` edges to both Model Registry and Router. Model Intelligence therefore stores
observations and evaluations but cannot grant permission, declare a route active or bypass Router
hard filters.
