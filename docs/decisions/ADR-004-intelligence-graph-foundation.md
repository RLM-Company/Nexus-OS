# ADR-004: Cosmora Intelligence Graph foundation

**Date:** 2026-09-28  
**Status:** PROPOSED / PACKAGE A — CONTRACT AND EVALUATION FOUNDATION  
**Runtime status:** documentation only; no graph runtime, storage migration, router change, paid model call, or VPS deployment is introduced by this package.

## 1. Decision summary

Cosmora will treat “Intelligence Graph” as a family of linked, typed evidence graphs rather than as model weights or an undifferentiated set of “neural connections”.

The semantic contract is designed now for growth from a small project graph to tens of millions of edges without requiring a meaning-changing rewrite. Physical storage remains replaceable behind a strict interface and will be selected by measurements on Cosmora queries rather than by graph size alone.

The first implementation must fail closed on project and owner boundaries, preserve provenance, distinguish claims from evidence, version mutable facts, preserve temporal validity, support bounded retrieval, and make deletion propagate to derived indexes and edges.

This ADR does **not** authorize:
- a new production graph database;
- changes to `apps/api`, `packages/model-gateway`, `packages/policy-engine`, `packages/tool-runtime`, `packages/db` or migrations;
- changes to the active Model Registry or Router;
- model fine-tuning;
- cross-project memory by default;
- persistence of confidential-chat content;
- heavy indexing or million-edge load tests on the current 2 vCPU / 4 GB RAM / 70 GB VPS.

## 2. Repository boundary observed on 2026-09-28

The current default branch observed while preparing this ADR is `main@62bc5234b24e3b0c10262b043063fd31be9732bd` (`feat: connect durable Manager work runtime (#258)`).

The repository has no root `AGENTS.md` at this revision. The current README and older readiness documents still contain statements that Manager task-graph execution is not implemented, while `62bc523` adds a durable Manager work coordinator and routes. Therefore this ADR treats source code and the latest commit as authoritative for what actually runs, and treats older checkpoint language as historical evidence rather than current runtime truth.

Existing boundaries that this design preserves:

- **Model Registry / Router:** `packages/model-gateway` remains the only routing authority. Active external routes require dated evidence, and Router hard-filters safety/compatibility constraints before deterministic scoring.
- **Usage Ledger:** existing model usage accounting remains authoritative for token/cost accounting.
- **Manager Runtime contracts:** existing project-bound roles, artifacts, task graphs, provenance validation, checkpoint validation and conflict lifecycle are reusable evidence sources.
- **Project Context:** the existing web layer is browser-local preview state and explicitly not authoritative runtime memory.
- **Memory constitution:** project isolation, confidential-chat exclusion, correction-by-versioning, provenance transparency and deletion requirements are policy inputs, not yet a completed runtime memory implementation.
- **Decision Trace:** remains an audit/evidence source; Intelligence Graph must not grant new authority merely because a trace edge exists.

## 3. Five distinct layers

### 3.1 Project Knowledge & Memory Graph

Purpose: represent projects, sources, documents, chunks, entities, claims, events, goals, decisions, tasks and artifacts with evidence and temporal validity.

It answers:
- “What is true in this project?”
- “What changed?”
- “Where did this statement come from?”
- “What decision depended on which evidence?”

### 3.2 Work Experience Graph

Purpose: preserve a verified execution trace:

`task → plan → actions → artifacts → verification → owner feedback → outcome → lesson`.

It answers:
- “What approach worked previously?”
- “Which failure mode recurred?”
- “What was verified rather than merely attempted?”

### 3.3 Model Intelligence Graph

Purpose: store **observations and evaluations** tied to exact model versions, test conditions and evidence.

It never replaces Model Registry or Router authority.

It answers:
- “Which tested model/version performed well on this task family?”
- “How large was the sample?”
- “What latency/cost/failure evidence exists?”
- “Is the evidence stale?”

### 3.4 Agent Collaboration Graph

Purpose: connect agent roles, task dependencies, artifact handoffs, critiques, conflicts and decision provenance.

An edge expresses relationship, not permission. Existing Policy/Tool/Manager contracts continue to decide authority.

### 3.5 Parametric Model Training

Separate system and separate authorization path. Updating graph data, retrieval indexes, user memory or evaluation records is **non-parametric learning**. It does not update LLM weights. No fine-tuning is part of Packages A–F.

## 4. Logical data flow

1. **Authorized source/event arrives.**
2. Source is classified by owner/project, confidentiality and retention policy.
3. Deterministic ingestion assigns stable source/version identifiers.
4. Extraction creates candidate nodes/edges as `hypothesis`, never as verified fact solely because a model inferred them.
5. Evidence binding records exact source location and extraction version.
6. Deterministic validators enforce owner/project boundary, schema, temporal order, references and no secret-bearing fields.
7. Human or approved deterministic checks can promote eligible claims to `verified`.
8. Retrieval planner chooses baseline text, vector, local graph, multi-hop, temporal or summarized-region search according to query type and budget.
9. Context assembler returns a small evidence packet with provenance and uncertainty.
10. Feedback/outcome records append new evidence; corrections create a new version and supersede old active state.
11. Source deletion tombstones the source and invalidates/removes dependent derived nodes, edges, embeddings and summaries according to retention rules.

## 5. Minimum typed nodes

The semantic contract reserves these node kinds from the start, even if Package B implements only a safe subset:

| Node kind | Identity / source of truth | Notes |
| --- | --- | --- |
| `Project` | existing authoritative project identity | owner-bound |
| `Source` | authorized source catalog / runtime event | source container |
| `Document` | versioned source document | content may live outside graph |
| `Chunk` | deterministic chunker output | exact source offsets required |
| `Entity` | canonicalized project entity | merge/split history preserved |
| `Claim` | extracted or owner-stated proposition | lifecycle + evidence required |
| `Event` | observed time-bounded occurrence | observed/effective time distinct |
| `Goal` | owner/project goal source | not inferred as authority |
| `Decision` | Decision Trace / verified project decision | rationale/evidence links |
| `Task` | Manager/task graph source | project-bound |
| `Artifact` | Manager/runtime artifact source | versioned provenance |
| `AgentRole` | canonical runtime role contract | relationship only |
| `ModelVersion` | Registry identity plus dated evidence | graph cannot activate route |
| `Evaluation` | evaluation run | exact config/sample required |
| `Outcome` | verified task/result outcome | distinguish attempted/succeeded |
| `Feedback` | owner/human/approved evaluator feedback | source identity required |

Every node version carries at minimum:

`node_id`, `node_version`, `kind`, `owner_id`, `project_id|null`, `scope`, `created_at`, `observed_at|null`, `valid_from|null`, `valid_to|null`, `status`, `sensitivity`, `source_ref`, `extractor_version|null`, `supersedes|null`, `deleted_at|null`.

Global scope is opt-in and must be represented explicitly. Absence of `project_id` is not itself permission for global access.

## 6. Minimum edge contract

Every relationship version carries:

- `edge_id` — stable relationship identity;
- `edge_version`;
- `type`;
- `from_node_id` + `from_node_version`;
- `to_node_id` + `to_node_version`;
- `owner_id`;
- `project_id` or explicit approved global scope;
- primary `evidence_ref` and exact evidence location;
- `provenance_kind`: owner assertion, document, tool result, model inference, human verification, deterministic derivation;
- `confidence_method`, not an unexplained percentage;
- `observed_at`, `valid_from`, `valid_to` where relevant;
- `verification_status`;
- `sensitivity`;
- `extractor_version`;
- `supersedes_edge_id|null`;
- `deleted_at|null`.

Rules:

1. Semantic similarity may propose an edge, but cannot set `verification_status=verified`.
2. Instructions found inside documents are represented as document content, never owner authority.
3. A material answer must be traceable through a bounded evidence path to a primary source.
4. Cross-project edges are rejected unless an explicit owner-approved bridge exists.
5. Edge creation must not be used as a capability grant.

## 7. Claim lifecycle

Canonical lifecycle:

`discovered → hypothesis → verified → disputed → superseded → deleted`

Permitted interpretations:

- **discovered:** raw candidate was found;
- **hypothesis:** normalized proposition exists but is not trusted as fact;
- **verified:** evidence and verifier requirements for this claim class are satisfied;
- **disputed:** conflicting evidence exists and the conflict is unresolved;
- **superseded:** a newer version is active; old version remains historical;
- **deleted:** source/owner policy requires removal from active retrieval and derived indexes.

A correction creates a new immutable version. Active retrieval excludes superseded/deleted versions by default but audit paths may reveal them when authorized.

## 8. Contradiction and update rules

Conflicts are explicit data, not silently resolved by “latest wins”.

Resolution order:

1. eliminate evidence that is deleted, unauthorized or outside scope;
2. compare exact source versions and effective times;
3. prefer direct primary evidence over model inference for factual state;
4. prefer owner-approved project decisions for project intent, but not for external-world facts;
5. preserve both claims when they refer to different valid-time intervals;
6. if conflict remains, mark `disputed` and return uncertainty instead of synthesizing a false single truth;
7. human resolution creates a new evidence-bearing version and closes the conflict without erasing history.

Entity deduplication uses stable aliases plus evidence. Merge operations are reversible and retain original IDs so mistaken merges can be undone.

## 9. Isolation, privacy and secret handling

Required invariant:

`read/write candidate.owner_id == request.owner_id` and
`candidate.project_id == request.project_id`

unless an explicit global/cross-project authorization object is supplied and audited.

Additional rules:

- confidential-chat content (`D4_PRIVATE_CHAT` in current runtime terminology) is excluded from persistent graph, embeddings, summaries and analytics;
- secrets, passwords, bearer tokens, API keys, payment data and raw credentials are rejected by ingestion/redaction gates;
- graph traversal cannot widen authorization: every visited node/edge is independently scope-checked;
- deletion of a source must invalidate dependent embeddings, summaries, claim edges and cached traversal material;
- model/provider training rights are distinct from project-memory rights.

Target leakage between projects/confidential modes in evaluation: **zero**.

## 10. Retrieval planner

No single retrieval method is mandatory for every question.

### Baseline text search
Use for exact phrases, identifiers and narrow factual lookup.

### Vector search
Use for semantic recall where relationship traversal is not needed.

### Local graph traversal
Use for entity-centered questions and evidence neighborhoods.

### Multi-hop traversal
Use only when the question requires chained relations. Enforce strict budgets.

### Temporal retrieval
Use for “what changed?”, “what was true then?” and decision-history questions.

### Region/community summaries
Use for large-corpus overview. Summaries are navigation aids and never replace source evidence.

### Mandatory query budgets

Every graph query supplies bounded:
- wall-clock deadline;
- maximum depth;
- maximum visited nodes;
- maximum returned edges;
- maximum fan-out per node;
- maximum context tokens;
- memory ceiling;
- cost ceiling where paid extraction/re-ranking could occur.

Default online path must remain small and cheap. Expensive global summarization is asynchronous/offline infrastructure work and is not run on every user message.

High-degree nodes require caps, typed neighbor filters and optional precomputed summaries. Cycles use visited-set detection. Duplicate evidence paths are collapsed without losing distinct primary sources.

## 11. Retrieval output contract

The model receives an `EvidencePacket`, not an unrestricted graph dump.

Minimum fields:

- request scope: owner/project;
- query mode;
- bounded selected nodes/edges;
- source excerpts or artifact references;
- exact provenance path for material claims;
- temporal validity;
- verification status;
- unresolved conflicts;
- truncation/budget metadata.

If sufficient verified evidence cannot be assembled inside budget, the system must say evidence is insufficient rather than filling the gap from an unverified graph relation.

## 12. Storage abstraction

Package B should target an interface similar to:

- `putNodes(batch, scope)`
- `putEdges(batch, scope)`
- `getNode(id, version, scope)`
- `neighbors(seed, typedLimits, scope)`
- `findClaims(query, filters, scope)`
- `findTemporal(subject, interval, scope)`
- `supersede(oldId, newVersion, scope)`
- `deleteSourceCascade(sourceId, scope)`
- `checkpointIngest(jobId)`
- `resumeIngest(jobId)`
- `metrics()`

The contract must not expose storage-specific query language to Manager or Router. This allows an in-memory/fixture implementation first, an embedded store for small graphs, and later a dedicated graph/search backend without changing semantic node/edge meaning.

## 13. Scale plan

### Stage 0 — correctness graph
Small verified fixtures. Goals: schema correctness, provenance, temporal updates, deletion, conflict handling and tenant isolation.

### Stage 1 — ~2 million synthetic edges
First performance gate. Measure:
- bulk ingest throughput;
- index build time;
- p50/p95 bounded traversals;
- memory high-water mark;
- disk footprint;
- incremental update cost;
- deletion cascade;
- interrupted-ingest recovery.

### Stage 2 — ~10 million synthetic edges
Re-test index fan-out, update amplification, cold/warm query behavior and storage overhead. This is the first point at which a dedicated external store may become justified, but only if measured SLOs fail.

### Stage 3 — ~50 million synthetic edges
Separate infrastructure test, not the current VPS. Measure hardware and operational cost, backup/restore time, repartition strategy and hot/cold tiering.

### Stage 4 — 100 million+
Research target only after product evidence shows a need and preceding gates pass.

Synthetic scale proves storage/query behavior only. It does not prove intelligence or answer quality.

## 14. Candidate physical-storage decision process

Do not select a graph database solely because the roadmap includes millions of edges.

For each candidate implementation, benchmark the same Cosmora fixture and query set:

1. project-scoped entity neighborhood;
2. two- to four-hop evidence chain;
3. temporal “what changed” query;
4. decision → evidence → artifact path;
5. source deletion cascade;
6. incremental re-index of one changed document;
7. high-degree node with fan-out protection;
8. cold-history lookup;
9. interrupted bulk ingest and resume.

Record p50/p95 latency, throughput, peak RAM, disk/index size and operational cost.

Migration trigger is empirical: when the current implementation cannot meet defined latency/resource/recovery limits at a validated scale tier, replace the storage adapter while preserving graph semantic IDs and version contracts.

## 15. Evaluation: usefulness, not edge count

Quality suite must compare graph-assisted retrieval against a simple retrieval baseline using the same underlying authorized corpus.

Minimum metrics:

- retrieval precision/recall on labeled evidence;
- percentage of answer-supporting edges with recoverable primary evidence;
- multi-hop QA correctness;
- temporal “what changed” correctness;
- “why was this decision made?” evidence completeness;
- old-project context restoration;
- false-edge / unsupported-claim rate;
- cross-project/confidential leakage rate;
- p50/p95 latency;
- RAM and disk;
- indexing/update time;
- build and per-query cost;
- deletion correctness;
- interrupted-ingest recovery;
- component ablations (disable graph traversal, summaries, temporal index, re-ranking separately).

Quality and scalability are reported separately.

## 16. Model Intelligence Graph contract

Model Registry remains the authority for whether a route is allowed.

The Intelligence Graph may store an `Evaluation` linking:

`ModelVersion → task type → prompt/config version → sample → metric → latency → tokens → cost → failure mode → evidence`.

Required evaluation metadata:

- exact provider/model/version identity;
- date and evidence expiry;
- prompt/config version;
- task family and dataset version;
- sample size;
- human vs automatic metric distinction;
- uncertainty/confidence interval where meaningful;
- latency distribution, not only average;
- token and cost evidence;
- failure/censoring rules.

Graph observations begin in **observe/recommend-only** mode. Router must not treat an evaluation edge as permission, capability truth or route activation. Any later automated influence on Router requires a separate reviewed ADR and safety evaluation.

## 17. Integration contracts required later

No runtime changes are made in Package A. Future integration should use narrow contracts.

### Manager → Intelligence Graph
Request:
- owner/project scope;
- task/question type;
- context budget;
- allowed data classes;
- temporal intent;
- requested evidence depth.

Response:
- `EvidencePacket` with bounded verified/hypothesis distinction and provenance.

### Runtime/Artifacts → Intelligence Graph ingest
Append event:
- stable project/task/artifact IDs;
- artifact version;
- source references;
- data class;
- producer role/instance;
- created time;
- verification/outcome status.

### Decision Trace → Intelligence Graph
Read-only evidence import. Graph never mutates Decision Trace authority.

### Model Registry → Model Intelligence Graph
Registry identity/evidence may be mirrored as referenced source metadata. Registry remains source of truth.

### Intelligence Graph → Router
Package D/F: recommendation/report only. No direct hard-filter bypass or automatic route activation.

## 18. Rollback, recovery and deletion

- ingestion batches have deterministic job IDs and checkpoints;
- writes are idempotent by semantic version key;
- partial batches are resumable;
- derived indexes reference source/version generations so stale generations can be dropped;
- snapshots/backups must preserve provenance and version history;
- rollback switches the active generation pointer; it does not invent reverse facts;
- deleting a source schedules deterministic dependency traversal and removes/tombstones its derived chunks, embeddings, unverified claims, summaries and edges;
- claims supported by multiple surviving sources remain only with surviving evidence links;
- authorization changes invalidate relevant caches immediately.

## 19. Risk matrix

| Risk | Failure mode | Required mitigation before runtime integration |
| --- | --- | --- |
| Cross-project leak | traversal crosses tenant boundary | scope predicate on every read/write + adversarial isolation tests |
| Graph pollution | model inference becomes “fact” | hypothesis default + evidence/verification gates |
| Prompt injection from documents | document text gains authority | `data_only` treatment + no permission inference |
| High-degree explosion | latency/memory spike | fan-out/depth/node/token/time budgets |
| Cycles/duplicates | repeated traversal and inflated evidence | stable IDs, dedup, visited set |
| Temporal overwrite | old/new truth collapsed | valid-time versions + supersession |
| Bad entity merge | unrelated facts combine | reversible merge history + evidence threshold |
| Stale model evaluation | Router recommendation degrades | model-version binding + expiry |
| Secret ingestion | credentials persisted/indexed | reject/redact before graph write |
| Deletion drift | source removed but derivative remains | deterministic cascade + deletion audit |
| Store lock-in | semantics depend on one DB | storage-neutral interface |
| Scale vanity | millions of useless edges | quality suite independent of scale suite |
| VPS contention | demo becomes unstable | no large indexing/load tests on current VPS |

## 20. Research evidence considered

Research is used as design input, not as proof that Cosmora will reproduce published results.

1. Microsoft GraphRAG documentation, reviewed 2026-09-28: describes extracting entities/relationships/claims, hierarchical community summaries and distinct Local, Global, DRIFT and baseline search modes. This supports a query planner rather than “graph for every query”.  
   https://microsoft.github.io/graphrag/

2. Gutiérrez et al., **From RAG to Memory: Non-Parametric Continual Learning for Large Language Models**, ICML 2025. The paper reports that graph-augmented systems can improve associative/sense-making memory while also warning that structured approaches can regress simpler factual retrieval if designed poorly. This supports mandatory comparison against ordinary RAG and ablations.  
   https://proceedings.mlr.press/v267/gutierrez25a.html

3. Rasmussen et al., **Zep: A Temporal Knowledge Graph Architecture for Agent Memory**, arXiv:2501.13956v1, 2025-01-20. The work emphasizes dynamic temporal relationships and evaluates cross-session / temporal memory. Results are author-reported and must not be assumed to transfer to Cosmora.  
   https://arxiv.org/abs/2501.13956

No external implementation is copied by this ADR.

## 21. Package sequence

### Package A — this ADR
Architecture, schema semantics, access invariants, evaluation plan, scale plan, risk matrix, Registry compatibility. No runtime connection.

### Package B — deterministic kernel
Implement storage-neutral node/edge types and deterministic validators for:
- IDs and versions;
- provenance;
- owner/project isolation;
- temporal order;
- conflicts and supersession;
- deletion/tombstones;
- corrupt input;
- cross-project attempts.

No paid model calls.

### Package C — permitted-fixture extraction/retrieval
Bounded deterministic fixtures first; then optional extractors behind explicit interfaces. Compare against baseline retrieval and return explainable evidence paths.

### Package D — model/agent evaluations
Persist evaluation observations, uncertainty and expiry. Remain recommend-only.

### Package E — scale
2M then 10M synthetic-edge tests with resource profiles. 50M only on suitable separate infrastructure.

### Package F — integration plan
Exact Manager/Router contracts, migration, rollback and observability. Critical runtime changes remain separate reviewed PRs after demo stabilization.

## 22. Acceptance criteria for Package A

Package A is complete when review confirms:

- semantic node/edge contracts do not assume one database;
- project/owner isolation is explicit;
- claim lifecycle and contradiction handling are explicit;
- Model Registry authority is preserved;
- graph observations cannot grant permissions;
- retrieval is bounded and mode-selected;
- quality and scalability evaluations are separated;
- 2M/10M/50M/100M+ scale stages are defined without promising current-VPS operation;
- rollback, resume and deletion are specified;
- Package B can be implemented without changing forbidden runtime areas.
