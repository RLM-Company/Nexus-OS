import type { IntelligenceGraphEdge, IntelligenceGraphNode } from "@cosmora/contracts";
import type { IntelligenceGraphSearchRecord } from "../../src/index.js";
import { repositoryStructureFileId } from "./cosmora-repository-structure-graph.js";

const ownerId = "owner-cosmora";
const projectId = "project-nexus-os";
const sourceId = "source-nexus-os-main-62bc523";
const recordedAt = "2026-10-06T08:20:00.000Z";
const validFrom = "2026-09-26T11:00:05.000Z";

const scopes = ["product", "owner", "project"] as const;
const behaviorStatuses = ["untested", "verified", "restricted", "rejected"] as const;
const memoryReadModes = ["none", "task", "project_segments", "handoff"] as const;
const memoryWriteModes = ["none", "result_only", "result_and_evidence"] as const;
const instanceStatuses = [
  "proposed",
  "active",
  "paused",
  "completed",
  "replaced",
  "closed",
  "failed"
] as const;
const decisionOperations = [
  "function.create",
  "function.version",
  "pattern.create",
  "pattern.version",
  "pattern.archive",
  "blueprint.create",
  "blueprint.version",
  "proposal.root",
  "proposal.delegated"
] as const;
const decisionObjectTypes = ["function", "pattern", "blueprint", "proposal"] as const;
const instructionLayers = ["constitution", "policy", "function", "behavior", "task"] as const;

const safeId = (value: string): string =>
  value.toLowerCase().replaceAll(".", "-").replaceAll("_", "-");

const node = (input: {
  id: string;
  location: string;
  kind?: IntelligenceGraphNode["kind"];
}): IntelligenceGraphNode => ({
  contract_version: 1,
  node_id: input.id,
  node_version: 1,
  kind: input.kind ?? "Entity",
  owner_id: ownerId,
  project_id: projectId,
  scope: "project",
  created_at: recordedAt,
  observed_at: recordedAt,
  valid_from: validFrom,
  valid_to: null,
  verification_status: "verified",
  sensitivity: "D1_PROJECT",
  source_ref: {
    source_id: sourceId,
    source_version: 1,
    location: input.location
  },
  provenance_kind: "document",
  confidence_method: "primary_source",
  extractor_version: "agent-composition-v1",
  supersedes: null,
  deleted_at: null
});

const coreNodes = [
  node({ id: "entity-agent-function-definition-contract", location: "packages/contracts/src/agent-studio.ts:AgentFunctionDefinitionSchema" }),
  node({ id: "entity-behavior-pattern-contract", location: "packages/contracts/src/agent-studio.ts:BehaviorPatternSchema" }),
  node({ id: "entity-agent-model-profile-ref", location: "packages/contracts/src/agent-studio.ts:AgentBlueprintSchema.model_profile_ref" }),
  node({ id: "entity-agent-grant-contract", location: "packages/contracts/src/agent-studio.ts:AgentGrantSchema" }),
  node({ id: "entity-agent-memory-scope-contract", location: "packages/contracts/src/agent-studio.ts:AgentMemoryScopeSchema" }),
  node({ id: "entity-agent-instruction-plan-contract", location: "packages/contracts/src/agent-studio.ts:AgentInstructionPlanSchema" }),
  node({ id: "entity-agent-studio-decision-event-contract", location: "packages/contracts/src/agent-studio.ts:AgentStudioDecisionEventSchema" }),
  node({ id: "entity-agent-handoff-contract", location: "packages/contracts/src/agent-studio.ts:AgentHandoffSchema" })
] as const;

const scopeNodes = scopes.map((scope) =>
  node({
    id: `agent-definition-scope-${safeId(scope)}`,
    location: `packages/contracts/src/agent-studio.ts:AgentDefinitionScopeSchema:${scope}`
  })
);
const behaviorStatusNodes = behaviorStatuses.map((status) =>
  node({
    id: `behavior-test-status-${safeId(status)}`,
    location: `packages/contracts/src/agent-studio.ts:BehaviorPatternTestStatusSchema:${status}`
  })
);
const memoryReadNodes = memoryReadModes.map((mode) =>
  node({
    id: `agent-memory-read-${safeId(mode)}`,
    location: `packages/contracts/src/agent-studio.ts:AgentMemoryScopeSchema.read_mode:${mode}`
  })
);
const memoryWriteNodes = memoryWriteModes.map((mode) =>
  node({
    id: `agent-memory-write-${safeId(mode)}`,
    location: `packages/contracts/src/agent-studio.ts:AgentMemoryScopeSchema.write_back:${mode}`
  })
);
const instanceStatusNodes = instanceStatuses.map((status) =>
  node({
    id: `agent-instance-status-${safeId(status)}`,
    location: `packages/contracts/src/agent-studio.ts:AgentInstanceStatusSchema:${status}`
  })
);
const decisionOperationNodes = decisionOperations.map((operation) =>
  node({
    id: `agent-studio-op-${safeId(operation)}`,
    location: `packages/contracts/src/agent-studio.ts:AgentStudioDecisionOperationSchema:${operation}`
  })
);
const decisionObjectNodes = decisionObjectTypes.map((type) =>
  node({
    id: `agent-studio-object-${safeId(type)}`,
    location: `packages/contracts/src/agent-studio.ts:AgentStudioDecisionObjectTypeSchema:${type}`
  })
);
const instructionLayerNodes = instructionLayers.map((layer) =>
  node({
    id: `instruction-authority-${safeId(layer)}`,
    location: `packages/contracts/src/agent-studio.ts:AgentInstructionPrecedenceSchema:${layer}`
  })
);

const claim = (id: string, location: string): IntelligenceGraphNode =>
  node({ id, kind: "Claim", location });

const claimNodes = [
  claim("claim-agent-scope-visibility", "packages/db/src/pattern-library-store.ts:visibilitySql"),
  claim("claim-agent-version-append-only", "packages/db/src/pattern-library-store.ts:createFunctionVersion/createPatternVersion"),
  claim("claim-agent-pattern-function-compatible", "packages/db/src/agent-blueprint-store.ts:allowed_function_ids"),
  claim("claim-agent-archived-pattern-not-composable", "packages/db/src/agent-blueprint-store.ts:archived_at"),
  claim("claim-agent-grant-project-bound", "packages/db/src/agent-blueprint-store.ts:grant.project_id"),
  claim("claim-agent-grant-unexpired", "packages/db/src/agent-blueprint-store.ts:grant.valid_until"),
  claim("claim-agent-instruction-exact-versioned-sources", "packages/policy-engine/src/agent-instruction-plan.ts:sameReference"),
  claim("claim-agent-instruction-precedence-fixed", "packages/policy-engine/src/agent-instruction-plan.ts:precedence"),
  claim("claim-agent-instruction-plan-nonexecutable", "packages/policy-engine/src/agent-instruction-plan.ts:executable=false"),
  claim("claim-agent-delegated-proposal-validator-required", "packages/db/src/agent-instance-store.ts:delegationValidator"),
  claim("claim-agent-studio-create-idempotent", "packages/db/src/agent-studio-mutation-store.ts:idempotency_key"),
  claim("claim-agent-studio-audit-content-minimized", "packages/db/src/agent-studio-mutation-store.ts:decision events")
] as const;

const edge = (input: {
  id: string;
  type: string;
  from: string;
  to: string;
  location: string;
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
  valid_from: validFrom,
  valid_to: null,
  verification_status: "verified",
  sensitivity: "D1_PROJECT",
  evidence_ref: {
    source_id: sourceId,
    source_version: 1,
    location: input.location
  },
  provenance_kind: "deterministic_derivation",
  confidence_method: "deterministic_check",
  extractor_version: "agent-composition-v1",
  supersedes: null,
  deleted_at: null
});

const contractFile = repositoryStructureFileId("packages/contracts/src/agent-studio.ts");
const patternFile = repositoryStructureFileId("packages/db/src/pattern-library-store.ts");
const blueprintFile = repositoryStructureFileId("packages/db/src/agent-blueprint-store.ts");
const instanceFile = repositoryStructureFileId("packages/db/src/agent-instance-store.ts");
const mutationFile = repositoryStructureFileId("packages/db/src/agent-studio-mutation-store.ts");
const instructionFile = repositoryStructureFileId("packages/policy-engine/src/agent-instruction-plan.ts");

const definitionNodes = [
  ...coreNodes,
  ...scopeNodes,
  ...behaviorStatusNodes,
  ...memoryReadNodes,
  ...memoryWriteNodes,
  ...instanceStatusNodes,
  ...decisionOperationNodes,
  ...decisionObjectNodes,
  ...instructionLayerNodes
];

const definitionEdges = definitionNodes.map((item) =>
  edge({
    id: `composition-${item.node_id}-defined`,
    type: "DEFINED_IN_FILE",
    from: item.node_id,
    to: contractFile,
    location: item.source_ref.location
  })
);

const operationObjectType: Record<(typeof decisionOperations)[number], (typeof decisionObjectTypes)[number]> = {
  "function.create": "function",
  "function.version": "function",
  "pattern.create": "pattern",
  "pattern.version": "pattern",
  "pattern.archive": "pattern",
  "blueprint.create": "blueprint",
  "blueprint.version": "blueprint",
  "proposal.root": "proposal",
  "proposal.delegated": "proposal"
};

const semanticEdges: IntelligenceGraphEdge[] = [
  edge({ id: "composition-blueprint-function", type: "COMPOSES_WITH", from: "entity-agent-blueprint", to: "entity-agent-function-definition-contract", location: "packages/contracts/src/agent-studio.ts:AgentBlueprintSchema.function_ref" }),
  edge({ id: "composition-blueprint-behavior", type: "COMPOSES_WITH", from: "entity-agent-blueprint", to: "entity-behavior-pattern-contract", location: "packages/contracts/src/agent-studio.ts:AgentBlueprintSchema.behavior_pattern_ref" }),
  edge({ id: "composition-blueprint-model-profile", type: "COMPOSES_WITH", from: "entity-agent-blueprint", to: "entity-agent-model-profile-ref", location: "packages/contracts/src/agent-studio.ts:AgentBlueprintSchema.model_profile_ref" }),
  edge({ id: "composition-blueprint-grant", type: "COMPOSES_WITH", from: "entity-agent-blueprint", to: "entity-agent-grant-contract", location: "packages/contracts/src/agent-studio.ts:AgentBlueprintSchema.grant" }),
  edge({ id: "composition-blueprint-memory", type: "COMPOSES_WITH", from: "entity-agent-blueprint", to: "entity-agent-memory-scope-contract", location: "packages/contracts/src/agent-studio.ts:AgentBlueprintSchema.memory_scope" }),
  edge({ id: "composition-instance-blueprint", type: "EMBEDS_BLUEPRINT", from: "entity-agent-instance", to: "entity-agent-blueprint", location: "packages/contracts/src/agent-studio.ts:AgentInstanceSchema.blueprint" }),
  edge({ id: "composition-pattern-allows-function", type: "ALLOWS_FUNCTION_KIND", from: "entity-behavior-pattern-contract", to: "entity-agent-function-definition-contract", location: "packages/contracts/src/agent-studio.ts:allowed_function_ids" }),
  edge({ id: "composition-memory-governance", type: "SUBJECT_TO", from: "entity-agent-memory-scope-contract", to: "entity-memory-governance", location: "packages/contracts/src/agent-studio.ts:AgentMemoryScopeSchema" }),
  edge({ id: "composition-handoff-from", type: "FROM_AGENT_INSTANCE", from: "entity-agent-handoff-contract", to: "entity-agent-instance", location: "packages/contracts/src/agent-studio.ts:from_instance_id" }),
  edge({ id: "composition-handoff-to", type: "TO_AGENT_INSTANCE", from: "entity-agent-handoff-contract", to: "entity-agent-instance", location: "packages/contracts/src/agent-studio.ts:to_instance_id" }),

  ...scopeNodes.flatMap((scope) => [
    edge({ id: `composition-${scope.node_id}-function`, type: "VISIBILITY_SCOPE_FOR", from: scope.node_id, to: "entity-agent-function-definition-contract", location: scope.source_ref.location }),
    edge({ id: `composition-${scope.node_id}-behavior`, type: "VISIBILITY_SCOPE_FOR", from: scope.node_id, to: "entity-behavior-pattern-contract", location: scope.source_ref.location })
  ]),
  ...behaviorStatusNodes.map((status) =>
    edge({ id: `composition-${status.node_id}-behavior`, type: "TEST_STATUS_FOR", from: status.node_id, to: "entity-behavior-pattern-contract", location: status.source_ref.location })
  ),
  ...memoryReadNodes.map((mode) =>
    edge({ id: `composition-${mode.node_id}-memory`, type: "READ_MODE_FOR", from: mode.node_id, to: "entity-agent-memory-scope-contract", location: mode.source_ref.location })
  ),
  ...memoryWriteNodes.map((mode) =>
    edge({ id: `composition-${mode.node_id}-memory`, type: "WRITE_BACK_MODE_FOR", from: mode.node_id, to: "entity-agent-memory-scope-contract", location: mode.source_ref.location })
  ),
  ...instanceStatusNodes.map((status) =>
    edge({ id: `composition-${status.node_id}-instance`, type: "STATUS_FOR", from: status.node_id, to: "entity-agent-instance", location: status.source_ref.location })
  ),
  ...instructionLayerNodes.map((layer) =>
    edge({ id: `composition-${layer.node_id}-plan`, type: "AUTHORITY_LAYER_OF", from: layer.node_id, to: "entity-agent-instruction-plan-contract", location: layer.source_ref.location })
  ),
  ...instructionLayers.slice(0, -1).map((layer, index) =>
    edge({
      id: `composition-precedence-${safeId(layer)}`,
      type: "PRECEDES_IN_INSTRUCTION_AUTHORITY",
      from: `instruction-authority-${safeId(layer)}`,
      to: `instruction-authority-${safeId(instructionLayers[index + 1]!)}`,
      location: "packages/contracts/src/agent-studio.ts:AgentInstructionPrecedenceSchema"
    })
  ),
  edge({ id: "composition-plan-blueprint", type: "COMPOSED_FROM", from: "entity-agent-instruction-plan-contract", to: "entity-agent-blueprint", location: "packages/policy-engine/src/agent-instruction-plan.ts:blueprint" }),
  edge({ id: "composition-plan-function", type: "COMPOSED_FROM", from: "entity-agent-instruction-plan-contract", to: "entity-agent-function-definition-contract", location: "packages/policy-engine/src/agent-instruction-plan.ts:agentFunction" }),
  edge({ id: "composition-plan-behavior", type: "COMPOSED_FROM", from: "entity-agent-instruction-plan-contract", to: "entity-behavior-pattern-contract", location: "packages/policy-engine/src/agent-instruction-plan.ts:behaviorPattern" }),

  ...decisionOperationNodes.flatMap((operationNode, index) => {
    const operation = decisionOperations[index]!;
    const objectType = operationObjectType[operation];
    return [
      edge({ id: `composition-${operationNode.node_id}-event`, type: "RECORDED_AS_OPERATION_BY", from: operationNode.node_id, to: "entity-agent-studio-decision-event-contract", location: operationNode.source_ref.location }),
      edge({ id: `composition-${operationNode.node_id}-object`, type: "TARGETS_OBJECT_TYPE", from: operationNode.node_id, to: `agent-studio-object-${safeId(objectType)}`, location: "packages/db/src/agent-studio-mutation-store.ts:objectTypeFor" })
    ];
  }),
  ...decisionObjectNodes.map((objectType) =>
    edge({ id: `composition-${objectType.node_id}-event`, type: "OBJECT_TYPE_FOR", from: objectType.node_id, to: "entity-agent-studio-decision-event-contract", location: objectType.source_ref.location })
  )
];

const claimSpecs = [
  {
    id: "claim-agent-scope-visibility",
    implementation: patternFile,
    test: "packages/db/test/pattern-library-store.test.ts",
    target: "entity-agent-function-definition-contract",
    source: "packages/db/src/pattern-library-store.ts:visibilitySql"
  },
  {
    id: "claim-agent-version-append-only",
    implementation: patternFile,
    test: "packages/db/test/pattern-library-store.test.ts",
    target: "entity-behavior-pattern-contract",
    source: "packages/db/src/pattern-library-store.ts:createFunctionVersion/createPatternVersion"
  },
  {
    id: "claim-agent-pattern-function-compatible",
    implementation: blueprintFile,
    test: "packages/db/test/agent-blueprint-store.test.ts",
    target: "entity-agent-blueprint",
    source: "packages/db/src/agent-blueprint-store.ts:allowed_function_ids"
  },
  {
    id: "claim-agent-archived-pattern-not-composable",
    implementation: blueprintFile,
    test: "packages/db/test/agent-blueprint-store.test.ts",
    target: "entity-agent-blueprint",
    source: "packages/db/src/agent-blueprint-store.ts:archived_at"
  },
  {
    id: "claim-agent-grant-project-bound",
    implementation: blueprintFile,
    test: "packages/db/test/agent-blueprint-store.test.ts",
    target: "entity-agent-grant-contract",
    source: "packages/db/src/agent-blueprint-store.ts:grant.project_id"
  },
  {
    id: "claim-agent-grant-unexpired",
    implementation: blueprintFile,
    test: "packages/db/test/agent-blueprint-store.test.ts",
    target: "entity-agent-grant-contract",
    source: "packages/db/src/agent-blueprint-store.ts:grant.valid_until"
  },
  {
    id: "claim-agent-instruction-exact-versioned-sources",
    implementation: instructionFile,
    test: "packages/policy-engine/test/agent-instruction-plan.test.ts",
    target: "entity-agent-instruction-plan-contract",
    source: "packages/policy-engine/src/agent-instruction-plan.ts:sameReference"
  },
  {
    id: "claim-agent-instruction-precedence-fixed",
    implementation: instructionFile,
    test: "packages/policy-engine/test/agent-instruction-plan.test.ts",
    target: "entity-agent-instruction-plan-contract",
    source: "packages/policy-engine/src/agent-instruction-plan.ts:precedence"
  },
  {
    id: "claim-agent-instruction-plan-nonexecutable",
    implementation: instructionFile,
    test: "packages/policy-engine/test/agent-instruction-plan.test.ts",
    target: "entity-agent-instruction-plan-contract",
    source: "packages/policy-engine/src/agent-instruction-plan.ts:executable=false"
  },
  {
    id: "claim-agent-delegated-proposal-validator-required",
    implementation: instanceFile,
    test: "packages/db/test/agent-instance-store.test.ts",
    target: "entity-agent-instance",
    source: "packages/db/src/agent-instance-store.ts:delegationValidator"
  },
  {
    id: "claim-agent-studio-create-idempotent",
    implementation: mutationFile,
    test: "packages/db/test/agent-studio-mutation-store.test.ts",
    target: "entity-agent-studio-decision-event-contract",
    source: "packages/db/src/agent-studio-mutation-store.ts:idempotency_key"
  },
  {
    id: "claim-agent-studio-audit-content-minimized",
    implementation: mutationFile,
    test: "packages/db/test/agent-studio-mutation-store.test.ts",
    target: "entity-agent-studio-decision-event-contract",
    source: "packages/db/src/agent-studio-mutation-store.ts:decision events"
  }
] as const;

const claimEdges = claimSpecs.flatMap((spec) => [
  edge({ id: `composition-${spec.id}-enforced`, type: "ENFORCED_BY", from: spec.id, to: spec.implementation, location: spec.source }),
  edge({ id: `composition-${spec.id}-tested`, type: "VERIFIED_BY_TEST", from: spec.id, to: repositoryStructureFileId(spec.test), location: spec.test }),
  edge({ id: `composition-${spec.id}-constrains`, type: "CONSTRAINS", from: spec.id, to: spec.target, location: spec.source })
]);

const nodes = [
  ...definitionNodes,
  ...claimNodes
];
const edges = [
  ...definitionEdges,
  ...semanticEdges,
  ...claimEdges,
  edge({ id: "composition-plan-implementation", type: "IMPLEMENTED_IN_FILE", from: "entity-agent-instruction-plan-contract", to: instructionFile, location: "packages/policy-engine/src/agent-instruction-plan.ts:composeAgentInstructionPlan" }),
  edge({ id: "composition-delegation-validator", type: "REQUIRES", from: "claim-agent-delegated-proposal-validator-required", to: "entity-agent-delegation-validator", location: "packages/db/src/agent-instance-store.ts:delegationValidator" }),
  edge({ id: "composition-delegation-bounds", type: "CONSISTENT_WITH", from: "claim-agent-delegated-proposal-validator-required", to: "decision-delegation-no-expansion", location: "packages/policy-engine/src/agent-delegation.ts" })
];

const records: IntelligenceGraphSearchRecord[] = nodes.map((item) => ({
  node: { id: item.node_id, version: 1 },
  text: item.node_id.replaceAll("-", " "),
  excerpt: item.source_ref.location,
  estimated_tokens: 12
}));

export const cosmoraAgentCompositionGraph = () => ({ nodes, edges, records });

export const COSMORA_AGENT_COMPOSITION_NODE_COUNT = nodes.length;
export const COSMORA_AGENT_COMPOSITION_EDGE_COUNT = edges.length;
