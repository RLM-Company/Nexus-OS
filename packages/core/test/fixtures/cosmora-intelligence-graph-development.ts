import type { IntelligenceGraphEdge, IntelligenceGraphNode } from "@cosmora/contracts";
import type { IntelligenceGraphSearchRecord } from "../../src/index.js";

const ownerId = "owner-cosmora";
const projectId = "project-nexus-os";
const observedAt = "2026-10-01T20:34:07.000Z";
const sourceId = "source-open-intelligence-graph-pr-stack";

const source: IntelligenceGraphNode = {
  contract_version: 1,
  node_id: sourceId,
  node_version: 1,
  kind: "Source",
  owner_id: ownerId,
  project_id: projectId,
  scope: "project",
  created_at: observedAt,
  observed_at: observedAt,
  valid_from: observedAt,
  valid_to: null,
  verification_status: "verified",
  sensitivity: "D1_PROJECT",
  source_ref: {
    source_id: sourceId,
    source_version: 1,
    location: "github:pulls/264-269"
  },
  provenance_kind: "runtime_record",
  confidence_method: "deterministic_check",
  extractor_version: "github-intelligence-graph-development-v1",
  supersedes: null,
  deleted_at: null
};

const proposal = (input: {
  number: number;
  id: string;
  title: string;
  excerpt: string;
  createdAt: string;
  headSha: string;
}): IntelligenceGraphNode => ({
  contract_version: 1,
  node_id: input.id,
  node_version: 1,
  kind: "Event",
  owner_id: ownerId,
  project_id: projectId,
  scope: "project",
  created_at: input.createdAt,
  observed_at: observedAt,
  valid_from: input.createdAt,
  valid_to: null,
  verification_status: "discovered",
  sensitivity: "D1_PROJECT",
  source_ref: {
    source_id: sourceId,
    source_version: 1,
    location: `pull:${input.number}@${input.headSha}`
  },
  provenance_kind: "runtime_record",
  confidence_method: "deterministic_check",
  extractor_version: "github-intelligence-graph-development-v1",
  supersedes: null,
  deleted_at: null
});

const proposals = [
  proposal({
    number: 264,
    id: "proposal-pr-264-intelligence-graph-architecture",
    title: "Intelligence Graph architecture foundation",
    excerpt:
      "Defines typed knowledge, work-experience, model-intelligence and retrieval architecture plus staged scale gates.",
    createdAt: "2026-09-28T19:55:48.000Z",
    headSha: "9261d5261871f2c0bbb6addbd411dd6de555a0eb"
  }),
  proposal({
    number: 265,
    id: "proposal-pr-265-intelligence-graph-kernel",
    title: "Intelligence Graph deterministic kernel",
    excerpt:
      "Implements typed node, edge, conflict, scope, provenance, temporal and supersession validation.",
    createdAt: "2026-09-28T20:00:33.000Z",
    headSha: "9b6d53be450b95e1ef22d0ac6222b9f037899d71"
  }),
  proposal({
    number: 266,
    id: "proposal-pr-266-intelligence-graph-retrieval",
    title: "Bounded Intelligence Graph retrieval",
    excerpt:
      "Implements fixture ingest, baseline/local/multi-hop/temporal retrieval and evidence-packet evaluation.",
    createdAt: "2026-09-29T04:34:36.000Z",
    headSha: "f301f0ba2416712e0696c3150e761109311bad58"
  }),
  proposal({
    number: 267,
    id: "proposal-pr-267-model-intelligence",
    title: "Model Intelligence Graph observations",
    excerpt:
      "Adds dated model quality, latency, token and cost observations with recommend-only authority.",
    createdAt: "2026-09-29T20:03:46.000Z",
    headSha: "4f3eeada67b6eb665c4ee8688153dd9bdd3366b5"
  }),
  proposal({
    number: 268,
    id: "proposal-pr-268-synthetic-scale",
    title: "2M synthetic graph scale benchmark",
    excerpt:
      "Validates deterministic generation, storage-stream mechanics and bounded traversal at two million synthetic edges.",
    createdAt: "2026-09-29T20:10:37.000Z",
    headSha: "36b501d47917861c54f50929b912ef3a317cb769"
  }),
  proposal({
    number: 269,
    id: "proposal-pr-269-real-knowledge",
    title: "Evidence-grounded Cosmora knowledge graph",
    excerpt:
      "Builds real repository knowledge, work history, candidate review layers and impact-analysis links separately from synthetic scale.",
    createdAt: "2026-09-29T20:28:07.000Z",
    headSha: "dabfd62b2a54b7910eff4946f785c268471b94c0"
  })
] as const;

const edge = (input: {
  id: string;
  type: string;
  from: string;
  to: string;
  location: string;
  createdAt: string;
}): IntelligenceGraphEdge => ({
  contract_version: 1,
  edge_id: input.id,
  edge_version: 1,
  type: input.type,
  from: { id: input.from, version: 1 },
  to: { id: input.to, version: 1 },
  owner_id: ownerId,
  project_id: projectId,
  scope: "project",
  created_at: input.createdAt,
  observed_at: observedAt,
  valid_from: input.createdAt,
  valid_to: null,
  verification_status: "discovered",
  sensitivity: "D1_PROJECT",
  evidence_ref: {
    source_id: sourceId,
    source_version: 1,
    location: input.location
  },
  provenance_kind: "deterministic_derivation",
  confidence_method: "deterministic_check",
  extractor_version: "github-intelligence-graph-development-v1",
  supersedes: null,
  deleted_at: null
});

const edges: IntelligenceGraphEdge[] = [
  edge({
    id: "ig-dev-architecture-project",
    type: "PROPOSES_ARCHITECTURE_FOR",
    from: "proposal-pr-264-intelligence-graph-architecture",
    to: "project-cosmora-os",
    location: "pull:264",
    createdAt: "2026-09-28T19:55:48.000Z"
  }),
  edge({
    id: "ig-dev-kernel-project",
    type: "PROPOSES_KERNEL_FOR",
    from: "proposal-pr-265-intelligence-graph-kernel",
    to: "project-cosmora-os",
    location: "pull:265",
    createdAt: "2026-09-28T20:00:33.000Z"
  }),
  edge({
    id: "ig-dev-kernel-before-retrieval",
    type: "STACKED_BEFORE",
    from: "proposal-pr-265-intelligence-graph-kernel",
    to: "proposal-pr-266-intelligence-graph-retrieval",
    location: "pull:266:base=codex/intelligence-graph-package-b-20260928",
    createdAt: "2026-09-29T04:34:36.000Z"
  }),
  edge({
    id: "ig-dev-retrieval-before-model",
    type: "STACKED_BEFORE",
    from: "proposal-pr-266-intelligence-graph-retrieval",
    to: "proposal-pr-267-model-intelligence",
    location: "pull:267:base=codex/intelligence-graph-package-c-20260929",
    createdAt: "2026-09-29T20:03:46.000Z"
  }),
  edge({
    id: "ig-dev-model-before-scale",
    type: "STACKED_BEFORE",
    from: "proposal-pr-267-model-intelligence",
    to: "proposal-pr-268-synthetic-scale",
    location: "pull:268:base=codex/intelligence-graph-package-d-20260929",
    createdAt: "2026-09-29T20:10:37.000Z"
  }),
  edge({
    id: "ig-dev-retrieval-before-real-knowledge",
    type: "STACKED_BEFORE",
    from: "proposal-pr-266-intelligence-graph-retrieval",
    to: "proposal-pr-269-real-knowledge",
    location: "pull:269:base=codex/intelligence-graph-package-c-20260929",
    createdAt: "2026-09-29T20:28:07.000Z"
  }),
  edge({
    id: "ig-dev-model-registry-boundary",
    type: "PROPOSES_RECOMMEND_ONLY_OBSERVATIONS_FOR",
    from: "proposal-pr-267-model-intelligence",
    to: "entity-model-registry",
    location: "pull:267",
    createdAt: "2026-09-29T20:03:46.000Z"
  }),
  edge({
    id: "ig-dev-scale-project",
    type: "BENCHMARKS_SCALE_FOR",
    from: "proposal-pr-268-synthetic-scale",
    to: "project-cosmora-os",
    location: "pull:268",
    createdAt: "2026-09-29T20:10:37.000Z"
  }),
  edge({
    id: "ig-dev-real-knowledge-project",
    type: "PROPOSES_KNOWLEDGE_LAYER_FOR",
    from: "proposal-pr-269-real-knowledge",
    to: "project-cosmora-os",
    location: "pull:269",
    createdAt: "2026-09-29T20:28:07.000Z"
  }),
  edge({
    id: "ig-dev-real-separate-scale",
    type: "SEPARATES_REAL_KNOWLEDGE_FROM",
    from: "proposal-pr-269-real-knowledge",
    to: "proposal-pr-268-synthetic-scale",
    location: "pull:269:real-knowledge-vs-synthetic-scale",
    createdAt: "2026-09-29T20:28:07.000Z"
  })
];

const records: IntelligenceGraphSearchRecord[] = [
  {
    node: { id: source.node_id, version: 1 },
    text: "open Intelligence Graph pull request development stack 264 265 266 267 268 269",
    excerpt: "Open PR evidence describing the staged Intelligence Graph implementation.",
    estimated_tokens: 18
  },
  ...proposals.map((node) => ({
    node: { id: node.node_id, version: 1 },
    text: node.node_id.replaceAll("-", " "),
    excerpt: node.source_ref.location,
    estimated_tokens: 12
  }))
];

export const cosmoraIntelligenceGraphDevelopment = () => ({
  nodes: [source, ...proposals],
  edges,
  records
});

export const COSMORA_INTELLIGENCE_GRAPH_DEVELOPMENT_NODE_COUNT =
  proposals.length + 1;
export const COSMORA_INTELLIGENCE_GRAPH_DEVELOPMENT_EDGE_COUNT = edges.length;
