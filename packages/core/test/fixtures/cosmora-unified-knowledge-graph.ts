import type { IntelligenceGraphEdge } from "@cosmora/contracts";
import {
  compileAuthorizedIntelligenceGraphFixture,
  type CompiledIntelligenceGraphFixture
} from "../../src/index.js";
import { cosmoraRealKnowledgeGraphFixture } from "./cosmora-real-knowledge-graph.js";
import {
  cosmoraRepositoryStructureGraphFixture,
  repositoryStructureFileId
} from "./cosmora-repository-structure-graph.js";
import { cosmoraWorkExperienceGraph } from "./cosmora-work-experience-graph.js";
import { cosmoraOpenReviewGraph } from "./cosmora-open-review-graph.js";
import { cosmoraMainHardeningHistoryGraph } from "./cosmora-main-hardening-history-graph.js";
import { cosmoraOpenSettingsReviewGraph } from "./cosmora-open-settings-review-graph.js";
import { cosmoraTestCoverageGraph } from "./cosmora-test-coverage-graph.js";
import { cosmoraIntelligenceGraphDevelopment } from "./cosmora-intelligence-graph-development.js";
import { cosmoraProductHistoryGraph } from "./cosmora-product-history-graph.js";
import { cosmoraAgentCollaborationGraph } from "./cosmora-agent-collaboration-graph.js";
import { cosmoraRuntimeSafetyScenarioGraph } from "./cosmora-runtime-safety-scenario-graph.js";
import { cosmoraCiLearningGraph } from "./cosmora-ci-learning-graph.js";
import { cosmoraRuntimeInterfaceGraph } from "./cosmora-runtime-interface-graph.js";
import { cosmoraStatePersistenceGraph } from "./cosmora-state-persistence-graph.js";
import { cosmoraModelIntelligenceGraph } from "./cosmora-model-intelligence-graph.js";
import { cosmoraMemoryGovernanceGraph } from "./cosmora-memory-governance-graph.js";
import { cosmoraAuthorityCapabilityGraph } from "./cosmora-authority-capability-graph.js";
import { cosmoraExecutionRecoveryGraph } from "./cosmora-execution-recovery-graph.js";
import { cosmoraIdentityTrustGraph } from "./cosmora-identity-trust-graph.js";
import { cosmoraDataLineageGraph } from "./cosmora-data-lineage-graph.js";
import { cosmoraResourceBudgetGraph } from "./cosmora-resource-budget-graph.js";
import { cosmoraConfigurationSecretBoundaryGraph } from "./cosmora-configuration-secret-boundary-graph.js";
import { cosmoraModelReliabilityGraph } from "./cosmora-model-reliability-graph.js";
import { cosmoraApiBoundaryGraph } from "./cosmora-api-boundary-graph.js";

const recordedAt = "2026-09-29T20:00:00.000Z";

interface Bridge {
  id: string;
  type: string;
  from: string;
  to: string;
  location: string;
}

const bridgeRows: readonly Bridge[] = [
  {
    id: "bridge-registry-contract",
    type: "DEFINED_IN_FILE",
    from: "entity-model-registry",
    to: repositoryStructureFileId("packages/contracts/src/model-registry.ts"),
    location: "packages/contracts/src/model-registry.ts"
  },
  {
    id: "bridge-registry-implementation",
    type: "IMPLEMENTED_BY_MODULE",
    from: "entity-model-registry",
    to: "module:packages/model-gateway",
    location: "packages/model-gateway/package.json"
  },
  {
    id: "bridge-router-file",
    type: "IMPLEMENTED_IN_FILE",
    from: "entity-router",
    to: repositoryStructureFileId("packages/model-gateway/src/router.ts"),
    location: "packages/model-gateway/src/router.ts"
  },
  {
    id: "bridge-gateway-file",
    type: "IMPLEMENTED_IN_FILE",
    from: "entity-model-gateway",
    to: repositoryStructureFileId("packages/model-gateway/src/gateway.ts"),
    location: "packages/model-gateway/src/gateway.ts"
  },
  {
    id: "bridge-policy-engine-file",
    type: "IMPLEMENTED_IN_FILE",
    from: "entity-policy-engine",
    to: repositoryStructureFileId("packages/policy-engine/src/index.ts"),
    location: "packages/policy-engine/src/index.ts"
  },
  {
    id: "bridge-agent-studio-contract",
    type: "DEFINED_IN_FILE",
    from: "entity-agent-instance",
    to: repositoryStructureFileId("packages/contracts/src/agent-studio.ts"),
    location: "packages/contracts/src/agent-studio.ts"
  },
  {
    id: "bridge-manager-work-contract",
    type: "RESOLVES_TO_FILE",
    from: "doc-manager-work-contract",
    to: repositoryStructureFileId("packages/contracts/src/manager-work.ts"),
    location: "packages/contracts/src/manager-work.ts"
  },
  {
    id: "bridge-manager-runtime-contract",
    type: "RESOLVES_TO_FILE",
    from: "doc-manager-runtime-contract",
    to: repositoryStructureFileId("packages/contracts/src/manager-runtime.ts"),
    location: "packages/contracts/src/manager-runtime.ts"
  },
  {
    id: "bridge-runtime-provenance",
    type: "RESOLVES_TO_FILE",
    from: "doc-runtime-provenance",
    to: repositoryStructureFileId("packages/contracts/src/manager-runtime-artifact-provenance.ts"),
    location: "packages/contracts/src/manager-runtime-artifact-provenance.ts"
  },
  {
    id: "bridge-runtime-checkpoint",
    type: "RESOLVES_TO_FILE",
    from: "doc-runtime-checkpoint",
    to: repositoryStructureFileId("packages/contracts/src/manager-runtime-checkpoint.ts"),
    location: "packages/contracts/src/manager-runtime-checkpoint.ts"
  },
  {
    id: "bridge-runtime-conflict",
    type: "RESOLVES_TO_FILE",
    from: "doc-runtime-conflict",
    to: repositoryStructureFileId("packages/contracts/src/manager-runtime-conflict.ts"),
    location: "packages/contracts/src/manager-runtime-conflict.ts"
  },
  {
    id: "bridge-runtime-state",
    type: "RESOLVES_TO_FILE",
    from: "doc-runtime-state",
    to: repositoryStructureFileId("packages/contracts/src/manager-runtime-state.ts"),
    location: "packages/contracts/src/manager-runtime-state.ts"
  },
  {
    id: "bridge-runtime-context-validation",
    type: "RESOLVES_TO_FILE",
    from: "doc-runtime-context-validation",
    to: repositoryStructureFileId("packages/contracts/src/manager-runtime-context-validation.ts"),
    location: "packages/contracts/src/manager-runtime-context-validation.ts"
  },
  {
    id: "bridge-auth-contract",
    type: "RESOLVES_TO_FILE",
    from: "doc-auth-contract",
    to: repositoryStructureFileId("packages/contracts/src/auth.ts"),
    location: "packages/contracts/src/auth.ts"
  },
  {
    id: "bridge-companion-contract",
    type: "RESOLVES_TO_FILE",
    from: "doc-companion-contract",
    to: repositoryStructureFileId("packages/contracts/src/companion.ts"),
    location: "packages/contracts/src/companion.ts"
  },
  {
    id: "bridge-policy-contract",
    type: "RESOLVES_TO_FILE",
    from: "doc-policy-contract",
    to: repositoryStructureFileId("packages/contracts/src/policy.ts"),
    location: "packages/contracts/src/policy.ts"
  },
  {
    id: "bridge-identity-contract",
    type: "RESOLVES_TO_FILE",
    from: "doc-identity-contract",
    to: repositoryStructureFileId("packages/contracts/src/identity.ts"),
    location: "packages/contracts/src/identity.ts"
  },
  {
    id: "bridge-step-up-contract",
    type: "RESOLVES_TO_FILE",
    from: "doc-step-up-contract",
    to: repositoryStructureFileId("packages/contracts/src/step-up.ts"),
    location: "packages/contracts/src/step-up.ts"
  },
  {
    id: "bridge-usage-contract",
    type: "RESOLVES_TO_FILE",
    from: "doc-usage-contract",
    to: repositoryStructureFileId("packages/contracts/src/usage.ts"),
    location: "packages/contracts/src/usage.ts"
  },
  {
    id: "bridge-manager-runtime-implementation",
    type: "IMPLEMENTED_IN_FILE",
    from: "artifact-manager-work-runtime",
    to: repositoryStructureFileId("apps/api/src/manager-work-coordinator.ts"),
    location: "apps/api/src/manager-work-coordinator.ts"
  },
  {
    id: "bridge-manager-routes",
    type: "EXPOSED_BY_FILE",
    from: "artifact-manager-work-runtime",
    to: repositoryStructureFileId("apps/api/src/manager-work-routes.ts"),
    location: "apps/api/src/manager-work-routes.ts"
  },
  {
    id: "bridge-project-context-ui",
    type: "IMPLEMENTED_IN_FILE",
    from: "entity-project-context-panel",
    to: repositoryStructureFileId("apps/web/src/app/project-context-panel.tsx"),
    location: "apps/web/src/app/project-context-panel.tsx"
  },
  {
    id: "bridge-usage-store",
    type: "PERSISTED_BY",
    from: "entity-project-usage",
    to: repositoryStructureFileId("packages/db/src/usage-store.ts"),
    location: "packages/db/src/usage-store.ts"
  },
  {
    id: "bridge-identity-store",
    type: "PERSISTED_BY",
    from: "entity-identity-session",
    to: repositoryStructureFileId("packages/db/src/identity-store.ts"),
    location: "packages/db/src/identity-store.ts"
  },
  {
    id: "bridge-step-up-store",
    type: "PERSISTED_BY",
    from: "entity-step-up-proof",
    to: repositoryStructureFileId("packages/db/src/step-up-proof-store.ts"),
    location: "packages/db/src/step-up-proof-store.ts"
  },
  {
    id: "bridge-manager-work-store",
    type: "PERSISTED_BY",
    from: "entity-manager-work",
    to: repositoryStructureFileId("packages/db/src/manager-work-store.ts"),
    location: "packages/db/src/manager-work-store.ts"
  },
  {
    id: "bridge-runtime-context-schema",
    type: "DEFINED_IN_FILE",
    from: "entity-runtime-context",
    to: repositoryStructureFileId("packages/contracts/src/manager-runtime-state.ts"),
    location: "packages/contracts/src/manager-runtime-state.ts"
  },
  {
    id: "bridge-auth-flow-schema",
    type: "DEFINED_IN_FILE",
    from: "entity-auth-flow",
    to: repositoryStructureFileId("packages/contracts/src/auth.ts"),
    location: "packages/contracts/src/auth.ts"
  },
  {
    id: "bridge-companion-gate-schema",
    type: "DEFINED_IN_FILE",
    from: "entity-companion-gate",
    to: repositoryStructureFileId("packages/contracts/src/companion.ts"),
    location: "packages/contracts/src/companion.ts"
  },
  {
    id: "bridge-runtime-artifact-schema",
    type: "DEFINED_IN_FILE",
    from: "entity-runtime-artifact",
    to: repositoryStructureFileId("packages/contracts/src/manager-runtime.ts"),
    location: "packages/contracts/src/manager-runtime.ts"
  }
];

const bridgeEdge = (bridge: Bridge): IntelligenceGraphEdge => ({
  contract_version: 1,
  edge_id: bridge.id,
  edge_version: 1,
  type: bridge.type,
  from: { id: bridge.from, version: 1 },
  to: { id: bridge.to, version: 1 },
  owner_id: "owner-cosmora",
  project_id: "project-nexus-os",
  scope: "project",
  created_at: recordedAt,
  observed_at: recordedAt,
  valid_from: recordedAt,
  valid_to: null,
  verification_status: "verified",
  sensitivity: "D1_PROJECT",
  evidence_ref: {
    source_id: "source-nexus-os-main-62bc523",
    source_version: 1,
    location: bridge.location
  },
  provenance_kind: "deterministic_derivation",
  confidence_method: "deterministic_check",
  extractor_version: "repository-bridge-v1",
  supersedes: null,
  deleted_at: null
});

const versionKey = (id: string, version: number): string => `${id}@${version}`;

export const cosmoraUnifiedKnowledgeGraph = (): CompiledIntelligenceGraphFixture => {
  const semantic = compileAuthorizedIntelligenceGraphFixture(cosmoraRealKnowledgeGraphFixture());
  const structural = compileAuthorizedIntelligenceGraphFixture(
    cosmoraRepositoryStructureGraphFixture()
  );
  const workExperience = cosmoraWorkExperienceGraph();
  const openReview = cosmoraOpenReviewGraph();
  const mainHardening = cosmoraMainHardeningHistoryGraph();
  const openSettings = cosmoraOpenSettingsReviewGraph();
  const testCoverage = cosmoraTestCoverageGraph();
  const intelligenceDevelopment = cosmoraIntelligenceGraphDevelopment();
  const productHistory = cosmoraProductHistoryGraph();
  const agentCollaboration = cosmoraAgentCollaborationGraph();
  const runtimeSafetyScenarios = cosmoraRuntimeSafetyScenarioGraph();
  const ciLearning = cosmoraCiLearningGraph();
  const runtimeInterface = cosmoraRuntimeInterfaceGraph();
  const statePersistence = cosmoraStatePersistenceGraph();
  const modelIntelligence = cosmoraModelIntelligenceGraph();
  const memoryGovernance = cosmoraMemoryGovernanceGraph();
  const authorityCapability = cosmoraAuthorityCapabilityGraph();
  const executionRecovery = cosmoraExecutionRecoveryGraph();
  const identityTrust = cosmoraIdentityTrustGraph();
  const dataLineage = cosmoraDataLineageGraph();
  const resourceBudget = cosmoraResourceBudgetGraph();
  const configurationSecretBoundary = cosmoraConfigurationSecretBoundaryGraph();
  const modelReliability = cosmoraModelReliabilityGraph();
  const apiBoundary = cosmoraApiBoundaryGraph();

  const nodes = [
    ...semantic.nodes,
    ...structural.nodes,
    ...workExperience.nodes,
    ...openReview.nodes,
    ...mainHardening.nodes,
    ...openSettings.nodes,
    ...intelligenceDevelopment.nodes,
    ...productHistory.nodes,
    ...agentCollaboration.nodes,
    ...runtimeSafetyScenarios.nodes,
    ...ciLearning.nodes,
    ...runtimeInterface.nodes,
    ...statePersistence.nodes,
    ...modelIntelligence.nodes,
    ...memoryGovernance.nodes,
    ...authorityCapability.nodes,
    ...executionRecovery.nodes,
    ...identityTrust.nodes,
    ...dataLineage.nodes,
    ...resourceBudget.nodes,
    ...configurationSecretBoundary.nodes,
    ...modelReliability.nodes,
    ...apiBoundary.nodes
  ];
  const records = [
    ...semantic.records,
    ...structural.records,
    ...workExperience.records,
    ...openReview.records,
    ...mainHardening.records,
    ...openSettings.records,
    ...testCoverage.records,
    ...intelligenceDevelopment.records,
    ...productHistory.records,
    ...agentCollaboration.records,
    ...runtimeSafetyScenarios.records,
    ...ciLearning.records,
    ...runtimeInterface.records,
    ...statePersistence.records,
    ...modelIntelligence.records,
    ...memoryGovernance.records,
    ...authorityCapability.records,
    ...executionRecovery.records,
    ...identityTrust.records,
    ...dataLineage.records,
    ...resourceBudget.records,
    ...configurationSecretBoundary.records,
    ...modelReliability.records,
    ...apiBoundary.records
  ];
  const edges = [
    ...semantic.edges,
    ...structural.edges,
    ...bridgeRows.map(bridgeEdge),
    ...workExperience.edges,
    ...openReview.edges,
    ...mainHardening.edges,
    ...openSettings.edges,
    ...testCoverage.edges,
    ...intelligenceDevelopment.edges,
    ...productHistory.edges,
    ...agentCollaboration.edges,
    ...runtimeSafetyScenarios.edges,
    ...ciLearning.edges,
    ...runtimeInterface.edges,
    ...statePersistence.edges,
    ...modelIntelligence.edges,
    ...memoryGovernance.edges,
    ...authorityCapability.edges,
    ...executionRecovery.edges,
    ...identityTrust.edges,
    ...dataLineage.edges,
    ...resourceBudget.edges,
    ...configurationSecretBoundary.edges,
    ...modelReliability.edges,
    ...apiBoundary.edges
  ];

  const nodeKeys = nodes.map((node) => versionKey(node.node_id, node.node_version));
  if (new Set(nodeKeys).size !== nodeKeys.length) {
    throw new Error("Unified Cosmora graph contains duplicate node versions");
  }

  const edgeKeys = edges.map((edge) => versionKey(edge.edge_id, edge.edge_version));
  if (new Set(edgeKeys).size !== edgeKeys.length) {
    throw new Error("Unified Cosmora graph contains duplicate edge versions");
  }

  return { nodes, edges, records };
};

export const COSMORA_UNIFIED_BRIDGE_COUNT = bridgeRows.length;
