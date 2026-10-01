import type { IntelligenceGraphEdge, IntelligenceGraphNode } from "@cosmora/contracts";
import type { IntelligenceGraphSearchRecord } from "../../src/index.js";
import { repositoryStructureFileId } from "./cosmora-repository-structure-graph.js";

const ownerId = "owner-cosmora";
const projectId = "project-nexus-os";
const sourceId = "source-nexus-os-main-62bc523";
const recordedAt = "2026-10-01T20:31:01.000Z";

const role = (input: {
  id: string;
  roleName: string;
  excerpt: string;
}): IntelligenceGraphNode => ({
  contract_version: 1,
  node_id: input.id,
  node_version: 1,
  kind: "AgentRole",
  owner_id: ownerId,
  project_id: projectId,
  scope: "project",
  created_at: recordedAt,
  observed_at: recordedAt,
  valid_from: recordedAt,
  valid_to: null,
  verification_status: "verified",
  sensitivity: "D1_PROJECT",
  source_ref: {
    source_id: sourceId,
    source_version: 1,
    location: `packages/contracts/src/manager-runtime.ts:MANAGER_RUNTIME_ROLE_CONTRACTS.${input.roleName}`
  },
  provenance_kind: "document",
  confidence_method: "primary_source",
  extractor_version: "manager-role-collaboration-v1",
  supersedes: null,
  deleted_at: null
});

const artifactKind = (input: {
  id: string;
  name: string;
}): IntelligenceGraphNode => ({
  contract_version: 1,
  node_id: input.id,
  node_version: 1,
  kind: "Entity",
  owner_id: ownerId,
  project_id: projectId,
  scope: "project",
  created_at: recordedAt,
  observed_at: recordedAt,
  valid_from: recordedAt,
  valid_to: null,
  verification_status: "verified",
  sensitivity: "D1_PROJECT",
  source_ref: {
    source_id: sourceId,
    source_version: 1,
    location: "packages/contracts/src/manager-runtime.ts:RuntimeArtifactKindSchema"
  },
  provenance_kind: "document",
  confidence_method: "primary_source",
  extractor_version: "manager-role-collaboration-v1",
  supersedes: null,
  deleted_at: null
});

const architect = role({
  id: "entity-architect-role",
  roleName: "architect",
  excerpt: "Architect accepts plan/evidence/analysis/handoff and emits architecture/handoff."
});
const researcher = role({
  id: "entity-researcher-role",
  roleName: "researcher",
  excerpt: "Researcher accepts plan/handoff and emits evidence/handoff."
});
const analyst = role({
  id: "entity-analyst-role",
  roleName: "analyst",
  excerpt: "Analyst accepts plan/evidence/architecture/handoff and emits analysis/handoff."
});

const artifactNodes = [
  artifactKind({ id: "entity-artifact-kind-plan", name: "plan" }),
  artifactKind({ id: "entity-artifact-kind-architecture", name: "architecture" }),
  artifactKind({ id: "entity-artifact-kind-evidence", name: "evidence" }),
  artifactKind({ id: "entity-artifact-kind-analysis", name: "analysis" }),
  artifactKind({ id: "entity-artifact-kind-decision", name: "decision" }),
  artifactKind({ id: "entity-artifact-kind-handoff", name: "handoff" }),
  artifactKind({ id: "entity-artifact-kind-critic-verdict", name: "critic_verdict" })
] as const;

const authorityClaim: IntelligenceGraphNode = {
  contract_version: 1,
  node_id: "claim-runtime-roles-no-authority-bypass",
  node_version: 1,
  kind: "Claim",
  owner_id: ownerId,
  project_id: projectId,
  scope: "project",
  created_at: recordedAt,
  observed_at: recordedAt,
  valid_from: recordedAt,
  valid_to: null,
  verification_status: "verified",
  sensitivity: "D1_PROJECT",
  source_ref: {
    source_id: sourceId,
    source_version: 1,
    location: "packages/contracts/src/manager-runtime.ts:MANAGER_RUNTIME_ROLE_CONTRACTS"
  },
  provenance_kind: "document",
  confidence_method: "primary_source",
  extractor_version: "manager-role-collaboration-v1",
  supersedes: null,
  deleted_at: null
};

const artifactId = (kind: string): string =>
  kind === "checkpoint" ? "entity-runtime-checkpoint" : `entity-artifact-kind-${kind.replace("_", "-")}`;

const edge = (input: {
  id: string;
  type: string;
  from: string;
  to: string;
  evidence: string;
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
  created_at: recordedAt,
  observed_at: recordedAt,
  valid_from: recordedAt,
  valid_to: null,
  verification_status: "verified",
  sensitivity: "D1_PROJECT",
  evidence_ref: {
    source_id: sourceId,
    source_version: 1,
    location: input.evidence
  },
  provenance_kind: "deterministic_derivation",
  confidence_method: "deterministic_check",
  extractor_version: "manager-role-collaboration-v1",
  supersedes: null,
  deleted_at: null
});

const roleContracts = [
  {
    id: "entity-manager-role",
    role: "manager",
    accepts: ["architecture", "evidence", "analysis", "critic_verdict", "handoff", "checkpoint"],
    emits: ["plan", "decision", "handoff", "checkpoint"]
  },
  {
    id: architect.node_id,
    role: "architect",
    accepts: ["plan", "evidence", "analysis", "handoff"],
    emits: ["architecture", "handoff"]
  },
  {
    id: researcher.node_id,
    role: "researcher",
    accepts: ["plan", "handoff"],
    emits: ["evidence", "handoff"]
  },
  {
    id: analyst.node_id,
    role: "analyst",
    accepts: ["plan", "evidence", "architecture", "handoff"],
    emits: ["analysis", "handoff"]
  },
  {
    id: "entity-critic-role",
    role: "critic",
    accepts: ["architecture", "evidence", "analysis", "decision", "handoff"],
    emits: ["critic_verdict", "handoff"]
  }
] as const;

const edges: IntelligenceGraphEdge[] = [];
for (const contract of roleContracts) {
  for (const [index, kind] of contract.accepts.entries()) {
    edges.push(
      edge({
        id: `collab-${contract.role}-accepts-${index + 1}`,
        type: "ACCEPTS_ARTIFACT_KIND",
        from: contract.id,
        to: artifactId(kind),
        evidence: `packages/contracts/src/manager-runtime.ts:MANAGER_RUNTIME_ROLE_CONTRACTS.${contract.role}.accepts`
      })
    );
  }
  for (const [index, kind] of contract.emits.entries()) {
    edges.push(
      edge({
        id: `collab-${contract.role}-emits-${index + 1}`,
        type: "EMITS_ARTIFACT_KIND",
        from: contract.id,
        to: artifactId(kind),
        evidence: `packages/contracts/src/manager-runtime.ts:MANAGER_RUNTIME_ROLE_CONTRACTS.${contract.role}.emits`
      })
    );
  }
  edges.push(
    edge({
      id: `collab-${contract.role}-authority-boundary`,
      type: "CONSTRAINED_BY",
      from: contract.id,
      to: authorityClaim.node_id,
      evidence: `packages/contracts/src/manager-runtime.ts:MANAGER_RUNTIME_ROLE_CONTRACTS.${contract.role}`
    })
  );
}

edges.push(
  edge({
    id: "collab-manager-can-delegate",
    type: "CAN_DELEGATE_WITHIN",
    from: "entity-manager-role",
    to: "entity-runtime-task-graph",
    evidence: "packages/contracts/src/manager-runtime.ts:MANAGER_RUNTIME_ROLE_CONTRACTS.manager.can_delegate"
  }),
  edge({
    id: "collab-critic-can-review",
    type: "CAN_REVIEW",
    from: "entity-critic-role",
    to: "entity-runtime-artifact",
    evidence: "packages/contracts/src/manager-runtime.ts:MANAGER_RUNTIME_ROLE_CONTRACTS.critic.can_review"
  }),
  edge({
    id: "collab-authority-regression",
    type: "VERIFIED_BY_TEST",
    from: authorityClaim.node_id,
    to: repositoryStructureFileId("packages/contracts/test/manager-runtime.test.ts"),
    evidence: "packages/contracts/test/manager-runtime.test.ts:keeps all five roles project-bound and unable to bypass policy or issue authority"
  })
);

const nodes = [architect, researcher, analyst, ...artifactNodes, authorityClaim];

const records: IntelligenceGraphSearchRecord[] = [
  ...nodes.map((node) => ({
    node: { id: node.node_id, version: 1 },
    text: node.node_id.replaceAll("-", " "),
    excerpt: node.source_ref.location,
    estimated_tokens: 12
  }))
];

export const cosmoraAgentCollaborationGraph = () => ({ nodes, edges, records });

export const COSMORA_AGENT_COLLABORATION_NODE_COUNT = nodes.length;
export const COSMORA_AGENT_COLLABORATION_EDGE_COUNT = edges.length;
