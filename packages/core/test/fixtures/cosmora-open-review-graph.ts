import type { IntelligenceGraphEdge, IntelligenceGraphNode } from "@cosmora/contracts";
import type { IntelligenceGraphSearchRecord } from "../../src/index.js";
import { repositoryStructureFileId } from "./cosmora-repository-structure-graph.js";

const ownerId = "owner-cosmora";
const projectId = "project-nexus-os";
const observedAt = "2026-09-30T19:54:28.000Z";
const sourceId = "source-open-manager-execution-pr-stack";

const sourceNode: IntelligenceGraphNode = {
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
    location: "github:pulls/229,237,238,239,240,241,242,243,245"
  },
  provenance_kind: "runtime_record",
  confidence_method: "deterministic_check",
  extractor_version: "github-open-review-v1",
  supersedes: null,
  deleted_at: null
};

const proposalFile = (id: string, path: string, createdAt: string): IntelligenceGraphNode => ({
  contract_version: 1,
  node_id: id,
  node_version: 1,
  kind: "Document",
  owner_id: ownerId,
  project_id: projectId,
  scope: "project",
  created_at: createdAt,
  observed_at: observedAt,
  valid_from: createdAt,
  valid_to: null,
  verification_status: "discovered",
  sensitivity: "D1_PROJECT",
  source_ref: {
    source_id: sourceId,
    source_version: 1,
    location: path
  },
  provenance_kind: "runtime_record",
  confidence_method: "deterministic_check",
  extractor_version: "github-open-review-v1",
  supersedes: null,
  deleted_at: null
});

const proposedManagerExecution = proposalFile(
  "candidate-file-manager-execution",
  "pull:229:packages/contracts/src/manager-execution.ts",
  "2026-09-22T20:43:14.000Z"
);
const proposedManagerExecutionTest = proposalFile(
  "candidate-file-manager-execution-test",
  "pull:229:packages/contracts/test/manager-execution.test.ts",
  "2026-09-22T20:43:14.000Z"
);
const proposedManagerExecutionBoundaries = proposalFile(
  "candidate-file-manager-execution-boundaries-test",
  "pull:242:packages/contracts/test/manager-execution-boundaries.test.ts",
  "2026-09-22T21:09:25.000Z"
);

interface PullEventInput {
  number: number;
  id: string;
  title: string;
  excerpt: string;
  createdAt: string;
  headSha: string;
}

const pullEvent = (input: PullEventInput): IntelligenceGraphNode => ({
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
  extractor_version: "github-open-review-v1",
  supersedes: null,
  deleted_at: null
});

const pulls = [
  pullEvent({
    number: 229,
    id: "proposal-pr-229-manager-execution",
    title: "Manager execution lifecycle contract",
    excerpt:
      "Proposes bounded owner task to plan, task graph, role execution, artifacts, verification and result contracts.",
    createdAt: "2026-09-22T20:43:14.000Z",
    headSha: "99fa596694683119cf50d4339dcdb33896490106"
  }),
  pullEvent({
    number: 237,
    id: "proposal-pr-237-verification-consistency",
    title: "Manager verified-result consistency",
    excerpt: "Proposes rejecting verified artifacts when any verification for the artifact failed.",
    createdAt: "2026-09-22T20:59:04.000Z",
    headSha: "a5fd5f0563cb88e1cecc66f7e9bdb8ab99d2b477"
  }),
  pullEvent({
    number: 238,
    id: "proposal-pr-238-trace-correlation",
    title: "Manager execution request and trace correlation",
    excerpt:
      "Proposes binding owner-approved request, execution ID, project, task graph and snapshot into one validated trace.",
    createdAt: "2026-09-22T21:00:02.000Z",
    headSha: "72c0f99319ef81fa7dbb3bd9b90ce2b1100c6ad2"
  }),
  pullEvent({
    number: 239,
    id: "proposal-pr-239-unresolved-task-completeness",
    title: "Manager unresolved task completeness",
    excerpt:
      "Proposes requiring every non-completed task in blocked, failed or cancelled results to appear in unresolved_task_ids.",
    createdAt: "2026-09-22T21:03:09.000Z",
    headSha: "fa51fec1c8c1aedb794c97d17780a10b9914051b"
  }),
  pullEvent({
    number: 240,
    id: "proposal-pr-240-terminal-artifact-references",
    title: "Manager terminal artifact reference validation",
    excerpt:
      "Proposes validating summary, deliverable and verified artifact references for every terminal result state.",
    createdAt: "2026-09-22T21:04:08.000Z",
    headSha: "d2772268fe47a4ad87618951dc16b44d1cac0768"
  }),
  pullEvent({
    number: 241,
    id: "proposal-pr-241-critic-verdict-binding",
    title: "Critic verdict evidence binding",
    excerpt:
      "Proposes requiring critic verdict provenance to directly reference the artifact being verified.",
    createdAt: "2026-09-22T21:05:44.000Z",
    headSha: "d4b25e65b569a6aaeec4381b44eb169da7b2c2f3"
  }),
  pullEvent({
    number: 242,
    id: "proposal-pr-242-manager-schema-boundaries",
    title: "Manager execution schema boundary coverage",
    excerpt:
      "Proposes exhaustive test-only coverage for execution phases, result states, budgets, IDs, timestamps and strict schemas.",
    createdAt: "2026-09-22T21:09:25.000Z",
    headSha: "ca260bdf42580228c47b6c7e923a76181cf050e1"
  }),
  pullEvent({
    number: 243,
    id: "proposal-pr-243-verification-time-order",
    title: "Manager verification temporal ordering",
    excerpt:
      "Proposes rejecting verification before its artifact, after its snapshot, or before referenced critic verdict evidence.",
    createdAt: "2026-09-22T21:12:52.000Z",
    headSha: "f9893ab9be8c846feb0a7164e0c1682cd15cfb53"
  }),
  pullEvent({
    number: 245,
    id: "proposal-pr-245-result-time-order",
    title: "Manager terminal result temporal ordering",
    excerpt:
      "Proposes causal ordering between task graph, snapshot, terminal result, verifications and referenced artifacts.",
    createdAt: "2026-09-22T21:13:58.000Z",
    headSha: "0144dbad6a0c2334c68d3bfe9cea8f0f2bb9e44d"
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
  extractor_version: "github-open-review-v1",
  supersedes: null,
  deleted_at: null
});

const stackEdges = [
  [
    "proposal-pr-229-manager-execution",
    "proposal-pr-237-verification-consistency",
    "pull:237",
    "2026-09-22T20:59:04.000Z"
  ],
  [
    "proposal-pr-237-verification-consistency",
    "proposal-pr-238-trace-correlation",
    "pull:238",
    "2026-09-22T21:00:02.000Z"
  ],
  [
    "proposal-pr-238-trace-correlation",
    "proposal-pr-239-unresolved-task-completeness",
    "pull:239",
    "2026-09-22T21:03:09.000Z"
  ],
  [
    "proposal-pr-239-unresolved-task-completeness",
    "proposal-pr-240-terminal-artifact-references",
    "pull:240",
    "2026-09-22T21:04:08.000Z"
  ],
  [
    "proposal-pr-240-terminal-artifact-references",
    "proposal-pr-241-critic-verdict-binding",
    "pull:241",
    "2026-09-22T21:05:44.000Z"
  ],
  [
    "proposal-pr-241-critic-verdict-binding",
    "proposal-pr-243-verification-time-order",
    "pull:243",
    "2026-09-22T21:12:52.000Z"
  ],
  [
    "proposal-pr-243-verification-time-order",
    "proposal-pr-245-result-time-order",
    "pull:245",
    "2026-09-22T21:13:58.000Z"
  ],
  [
    "proposal-pr-229-manager-execution",
    "proposal-pr-242-manager-schema-boundaries",
    "pull:242",
    "2026-09-22T21:09:25.000Z"
  ]
] as const;

const stacked = stackEdges.map(([from, to, location, createdAt], index) =>
  edge({
    id: `candidate-stack-${index + 1}`,
    type: "STACKED_BEFORE",
    from,
    to,
    location,
    createdAt
  })
);

const commonChangedTargets = [
  repositoryStructureFileId("packages/contracts/src/index.ts"),
  proposedManagerExecution.node_id,
  proposedManagerExecutionTest.node_id
] as const;

const changed: IntelligenceGraphEdge[] = [];
for (const proposal of pulls) {
  const pullNumber = proposal.source_ref.location.match(/^pull:(\d+)/u)?.[1];
  if (!pullNumber) throw new Error(`Missing PR number for ${proposal.node_id}`);

  for (const [index, target] of commonChangedTargets.entries()) {
    changed.push(
      edge({
        id: `candidate-change-${pullNumber}-${index + 1}`,
        type: "PROPOSES_CHANGE_TO",
        from: proposal.node_id,
        to: target,
        location: `pull:${pullNumber}`,
        createdAt: proposal.created_at
      })
    );
  }
}
changed.push(
  edge({
    id: "candidate-change-242-boundary-test",
    type: "PROPOSES_CHANGE_TO",
    from: "proposal-pr-242-manager-schema-boundaries",
    to: proposedManagerExecutionBoundaries.node_id,
    location: "pull:242",
    createdAt: "2026-09-22T21:09:25.000Z"
  })
);

const semanticTargets = [
  ["proposal-pr-229-manager-execution", "entity-runtime-task-graph"],
  ["proposal-pr-237-verification-consistency", "entity-runtime-artifact"],
  ["proposal-pr-238-trace-correlation", "entity-runtime-task-graph"],
  ["proposal-pr-239-unresolved-task-completeness", "entity-runtime-task-graph"],
  ["proposal-pr-240-terminal-artifact-references", "entity-runtime-artifact"],
  ["proposal-pr-241-critic-verdict-binding", "entity-critic-role"],
  ["proposal-pr-242-manager-schema-boundaries", "doc-manager-runtime-contract"],
  ["proposal-pr-243-verification-time-order", "entity-runtime-artifact"],
  ["proposal-pr-245-result-time-order", "entity-runtime-task-graph"]
] as const;

const semantic = semanticTargets.map(([from, to], index) =>
  edge({
    id: `candidate-semantic-${index + 1}`,
    type: "PROPOSES_CONSTRAINT_FOR",
    from,
    to,
    location: `pull:${from.match(/proposal-pr-(\d+)/u)?.[1] ?? "unknown"}`,
    createdAt: pulls.find((proposal) => proposal.node_id === from)?.created_at ?? observedAt
  })
);

const records: IntelligenceGraphSearchRecord[] = [
  {
    node: { id: sourceNode.node_id, version: 1 },
    text: "open GitHub Manager execution pull request review stack",
    excerpt: "Open, unmerged Manager execution contract and hardening PR evidence.",
    estimated_tokens: 16
  },
  ...pulls.map((proposal) => ({
    node: { id: proposal.node_id, version: 1 },
    text: proposal.node_id.replaceAll("-", " "),
    excerpt: proposal.source_ref.location,
    estimated_tokens: 12
  })),
  {
    node: { id: proposedManagerExecution.node_id, version: 1 },
    text: "proposed Manager execution contract source file",
    excerpt: "Open-PR-only packages/contracts/src/manager-execution.ts.",
    estimated_tokens: 10
  },
  {
    node: { id: proposedManagerExecutionTest.node_id, version: 1 },
    text: "proposed Manager execution contract regression tests",
    excerpt: "Open-PR-only Manager execution contract tests.",
    estimated_tokens: 10
  },
  {
    node: { id: proposedManagerExecutionBoundaries.node_id, version: 1 },
    text: "proposed Manager execution schema boundary test",
    excerpt: "Open-PR-only exhaustive Manager execution schema boundary coverage.",
    estimated_tokens: 10
  }
];

export const cosmoraOpenReviewGraph = (): {
  nodes: IntelligenceGraphNode[];
  edges: IntelligenceGraphEdge[];
  records: IntelligenceGraphSearchRecord[];
} => ({
  nodes: [
    sourceNode,
    ...pulls,
    proposedManagerExecution,
    proposedManagerExecutionTest,
    proposedManagerExecutionBoundaries
  ],
  edges: [...stacked, ...changed, ...semantic],
  records
});

export const COSMORA_OPEN_REVIEW_NODE_COUNT = 13;
export const COSMORA_OPEN_REVIEW_EDGE_COUNT = stacked.length + changed.length + semantic.length;
