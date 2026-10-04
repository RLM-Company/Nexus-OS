import type { IntelligenceGraphEdge, IntelligenceGraphNode } from "@cosmora/contracts";
import type { IntelligenceGraphSearchRecord } from "../../src/index.js";
import { repositoryStructureFileId } from "./cosmora-repository-structure-graph.js";

const ownerId = "owner-cosmora";
const projectId = "project-nexus-os";
const sourceId = "source-nexus-os-main-62bc523";
const recordedAt = "2026-10-04T03:54:43.000Z";
const validFrom = "2026-09-26T11:00:05.000Z";

const managerStages = ["plan", "draft", "review", "publish", "done"] as const;
const managerStatuses = [
  "queued",
  "running",
  "paused",
  "awaiting_approval",
  "blocked",
  "completed",
  "failed",
  "cancelled"
] as const;
const toolOperationStatuses = [
  "WAITING_CONFIRMATION",
  "READY",
  "RESERVED",
  "SUCCEEDED",
  "FAILED",
  "DENIED",
  "PAUSED"
] as const;
const confirmationStatuses = ["PENDING", "APPROVED", "REJECTED", "EXPIRED", "CONSUMED"] as const;
const stepUpStatuses = ["active", "consumed", "expired"] as const;

const safeId = (value: string): string => value.replaceAll("_", "-").toLowerCase();

const node = (input: {
  id: string;
  kind?: IntelligenceGraphNode["kind"];
  location: string;
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
  extractor_version: "execution-recovery-v1",
  supersedes: null,
  deleted_at: null
});

const managerStageNodes = managerStages.map((stage) =>
  node({
    id: `manager-stage-${safeId(stage)}`,
    location: `packages/contracts/src/manager-work.ts:ManagerWorkStage:${stage}`
  })
);
const managerStatusNodes = managerStatuses.map((status) =>
  node({
    id: `manager-status-${safeId(status)}`,
    location: `packages/contracts/src/manager-work.ts:ManagerWorkStatus:${status}`
  })
);
const toolStatusNodes = toolOperationStatuses.map((status) =>
  node({
    id: `tool-operation-status-${safeId(status)}`,
    location: `packages/contracts/src/policy.ts:ToolOperationStatusSchema:${status}`
  })
);
const confirmationStatusNodes = confirmationStatuses.map((status) =>
  node({
    id: `confirmation-status-${safeId(status)}`,
    location: `packages/contracts/src/policy.ts:ConfirmationStatusSchema:${status}`
  })
);
const stepUpStatusNodes = stepUpStatuses.map((status) =>
  node({
    id: `step-up-status-${safeId(status)}`,
    location: `packages/contracts/src/step-up.ts:StepUpProofStatusSchema:${status}`
  })
);

const lifecycleNodes = [
  node({
    id: "entity-policy-operation",
    location: "packages/db/src/policy-store.ts:StoredPolicyOperation"
  }),
  node({
    id: "entity-confirmation-request",
    location: "packages/contracts/src/policy.ts:ConfirmationRequestSchema"
  })
] as const;

const claimNodes = [
  node({
    id: "claim-manager-recovery-no-auto-replay",
    kind: "Claim",
    location: "packages/db/src/manager-work-store.ts:recover"
  }),
  node({
    id: "claim-policy-reserved-recovery-required",
    kind: "Claim",
    location: "packages/db/src/policy-store.ts:reserveAllowed"
  }),
  node({
    id: "claim-policy-succeeded-replay-safe",
    kind: "Claim",
    location: "packages/db/src/policy-store.ts:reserveAllowed"
  })
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
  extractor_version: "execution-recovery-v1",
  supersedes: null,
  deleted_at: null
});

const managerContractFile = repositoryStructureFileId("packages/contracts/src/manager-work.ts");
const policyContractFile = repositoryStructureFileId("packages/contracts/src/policy.ts");
const stepUpContractFile = repositoryStructureFileId("packages/contracts/src/step-up.ts");
const managerCoordinatorFile = repositoryStructureFileId("apps/api/src/manager-work-coordinator.ts");
const managerStoreFile = repositoryStructureFileId("packages/db/src/manager-work-store.ts");
const policyStoreFile = repositoryStructureFileId("packages/db/src/policy-store.ts");
const stepUpStoreFile = repositoryStructureFileId("packages/db/src/step-up-proof-store.ts");
const managerTest = repositoryStructureFileId("apps/api/test/manager-work.test.ts");
const policyStoreTest = repositoryStructureFileId("packages/db/test/policy-store.test.ts");
const toolRuntimeTest = repositoryStructureFileId("packages/tool-runtime/test/tool-runtime.test.ts");
const stepUpStoreTest = repositoryStructureFileId("packages/db/test/step-up-proof-store.test.ts");

const definitionEdges: IntelligenceGraphEdge[] = [
  ...managerStageNodes.map((item) =>
    edge({
      id: `execution-definition-${item.node_id}`,
      type: "DEFINED_IN_FILE",
      from: item.node_id,
      to: managerContractFile,
      location: item.source_ref.location
    })
  ),
  ...managerStatusNodes.map((item) =>
    edge({
      id: `execution-definition-${item.node_id}`,
      type: "DEFINED_IN_FILE",
      from: item.node_id,
      to: managerContractFile,
      location: item.source_ref.location
    })
  ),
  ...toolStatusNodes.map((item) =>
    edge({
      id: `execution-definition-${item.node_id}`,
      type: "DEFINED_IN_FILE",
      from: item.node_id,
      to: policyContractFile,
      location: item.source_ref.location
    })
  ),
  ...confirmationStatusNodes.map((item) =>
    edge({
      id: `execution-definition-${item.node_id}`,
      type: "DEFINED_IN_FILE",
      from: item.node_id,
      to: policyContractFile,
      location: item.source_ref.location
    })
  ),
  ...stepUpStatusNodes.map((item) =>
    edge({
      id: `execution-definition-${item.node_id}`,
      type: "DEFINED_IN_FILE",
      from: item.node_id,
      to: stepUpContractFile,
      location: item.source_ref.location
    })
  )
];

const ownershipEdges: IntelligenceGraphEdge[] = [
  ...managerStageNodes.map((item) =>
    edge({
      id: `execution-owner-${item.node_id}`,
      type: "STATE_OF",
      from: item.node_id,
      to: "entity-manager-work",
      location: "packages/contracts/src/manager-work.ts:ManagerWork.stage"
    })
  ),
  ...managerStatusNodes.map((item) =>
    edge({
      id: `execution-owner-${item.node_id}`,
      type: "STATE_OF",
      from: item.node_id,
      to: "entity-manager-work",
      location: "packages/contracts/src/manager-work.ts:ManagerWork.status"
    })
  ),
  ...toolStatusNodes.map((item) =>
    edge({
      id: `execution-owner-${item.node_id}`,
      type: "STATE_OF",
      from: item.node_id,
      to: "entity-policy-operation",
      location: "packages/db/src/policy-store.ts:StoredPolicyOperation.status"
    })
  ),
  ...confirmationStatusNodes.map((item) =>
    edge({
      id: `execution-owner-${item.node_id}`,
      type: "STATE_OF",
      from: item.node_id,
      to: "entity-confirmation-request",
      location: "packages/contracts/src/policy.ts:ConfirmationRequestSchema.status"
    })
  ),
  ...stepUpStatusNodes.map((item) =>
    edge({
      id: `execution-owner-${item.node_id}`,
      type: "STATE_OF",
      from: item.node_id,
      to: "entity-step-up-proof",
      location: "packages/contracts/src/step-up.ts:StepUpProofSchema.status"
    })
  )
];

const transition = (
  id: string,
  from: string,
  to: string,
  type: string,
  location: string
): IntelligenceGraphEdge => edge({ id, from, to, type, location });

const managerStageEdges = [
  transition(
    "execution-manager-stage-plan-draft",
    "manager-stage-plan",
    "manager-stage-draft",
    "ADVANCES_TO",
    "apps/api/src/manager-work-coordinator.ts:execute:plan"
  ),
  transition(
    "execution-manager-stage-draft-review",
    "manager-stage-draft",
    "manager-stage-review",
    "MAY_ADVANCE_TO",
    "apps/api/src/manager-work-coordinator.ts:execute:draft:needs_critic"
  ),
  transition(
    "execution-manager-stage-draft-publish",
    "manager-stage-draft",
    "manager-stage-publish",
    "MAY_ADVANCE_TO",
    "apps/api/src/manager-work-coordinator.ts:execute:draft:no_critic"
  ),
  transition(
    "execution-manager-stage-review-publish",
    "manager-stage-review",
    "manager-stage-publish",
    "ADVANCES_TO",
    "apps/api/src/manager-work-coordinator.ts:execute:review:PASS"
  ),
  transition(
    "execution-manager-stage-publish-done",
    "manager-stage-publish",
    "manager-stage-done",
    "ADVANCES_TO",
    "apps/api/src/manager-work-coordinator.ts:execute:publish:EXECUTED"
  )
];

const managerStatusEdges = [
  transition(
    "execution-manager-queued-running",
    "manager-status-queued",
    "manager-status-running",
    "TRANSITIONS_TO",
    "apps/api/src/manager-work-coordinator.ts:execute"
  ),
  transition(
    "execution-manager-running-paused",
    "manager-status-running",
    "manager-status-paused",
    "TRANSITIONS_TO",
    "apps/api/src/manager-work-coordinator.ts:pause_requested"
  ),
  transition(
    "execution-manager-paused-queued",
    "manager-status-paused",
    "manager-status-queued",
    "RESUMES_TO",
    "apps/api/src/manager-work-coordinator.ts:control:resume"
  ),
  transition(
    "execution-manager-blocked-queued",
    "manager-status-blocked",
    "manager-status-queued",
    "RESUMES_TO",
    "apps/api/src/manager-work-coordinator.ts:control:resume"
  ),
  transition(
    "execution-manager-approval-queued",
    "manager-status-awaiting-approval",
    "manager-status-queued",
    "APPROVAL_RESUMES_TO",
    "apps/api/src/manager-work-coordinator.ts:control:approve"
  ),
  ...["queued", "running", "paused", "awaiting-approval", "blocked"].map((status) =>
    transition(
      `execution-manager-${status}-cancelled`,
      `manager-status-${status}`,
      "manager-status-cancelled",
      "OWNER_CAN_CANCEL_TO",
      "apps/api/src/manager-work-coordinator.ts:control:cancel"
    )
  ),
  transition(
    "execution-manager-running-blocked",
    "manager-status-running",
    "manager-status-blocked",
    "TOOL_GATE_CAN_BLOCK_TO",
    "apps/api/src/manager-work-coordinator.ts:publish:non-EXECUTED"
  ),
  transition(
    "execution-manager-running-completed",
    "manager-status-running",
    "manager-status-completed",
    "COMPLETES_TO",
    "apps/api/src/manager-work-coordinator.ts:publish:EXECUTED"
  ),
  transition(
    "execution-manager-running-failed",
    "manager-status-running",
    "manager-status-failed",
    "ERROR_TRANSITIONS_TO",
    "apps/api/src/manager-work-coordinator.ts:execute:catch"
  ),
  transition(
    "execution-manager-recovery-paused",
    "manager-status-running",
    "manager-status-paused",
    "SAFE_RECOVERY_TO",
    "packages/db/src/manager-work-store.ts:recover:no_inflight_not_publish"
  ),
  transition(
    "execution-manager-recovery-failed",
    "manager-status-running",
    "manager-status-failed",
    "UNCERTAIN_RECOVERY_TO",
    "packages/db/src/manager-work-store.ts:recover:RECOVERY_REQUIRED"
  )
];

const toolOperationEdges = [
  transition(
    "execution-tool-waiting-ready",
    "tool-operation-status-waiting-confirmation",
    "tool-operation-status-ready",
    "APPROVAL_TRANSITIONS_TO",
    "packages/db/src/policy-store.ts:decideConfirmation:approve"
  ),
  transition(
    "execution-tool-waiting-denied-reject",
    "tool-operation-status-waiting-confirmation",
    "tool-operation-status-denied",
    "REJECTION_TRANSITIONS_TO",
    "packages/db/src/policy-store.ts:decideConfirmation:reject"
  ),
  transition(
    "execution-tool-waiting-denied-expire",
    "tool-operation-status-waiting-confirmation",
    "tool-operation-status-denied",
    "EXPIRY_TRANSITIONS_TO",
    "packages/db/src/policy-store.ts:listConfirmations:expired"
  ),
  transition(
    "execution-tool-ready-reserved",
    "tool-operation-status-ready",
    "tool-operation-status-reserved",
    "ATOMICALLY_RESERVES_TO",
    "packages/db/src/policy-store.ts:reserveAllowed"
  ),
  transition(
    "execution-tool-reserved-succeeded",
    "tool-operation-status-reserved",
    "tool-operation-status-succeeded",
    "COMPLETES_TO",
    "packages/db/src/policy-store.ts:completeOperation"
  ),
  transition(
    "execution-tool-reserved-failed",
    "tool-operation-status-reserved",
    "tool-operation-status-failed",
    "FAILS_TO",
    "packages/db/src/policy-store.ts:failOperation"
  )
];

const confirmationEdges = [
  transition(
    "execution-confirmation-pending-approved",
    "confirmation-status-pending",
    "confirmation-status-approved",
    "OWNER_APPROVES_TO",
    "packages/db/src/policy-store.ts:decideConfirmation:approve"
  ),
  transition(
    "execution-confirmation-pending-rejected",
    "confirmation-status-pending",
    "confirmation-status-rejected",
    "OWNER_REJECTS_TO",
    "packages/db/src/policy-store.ts:decideConfirmation:reject"
  ),
  transition(
    "execution-confirmation-pending-expired",
    "confirmation-status-pending",
    "confirmation-status-expired",
    "EXPIRES_TO",
    "packages/db/src/policy-store.ts:listConfirmations/decideConfirmation"
  ),
  transition(
    "execution-confirmation-approved-consumed",
    "confirmation-status-approved",
    "confirmation-status-consumed",
    "ONE_USE_CONSUMPTION_TO",
    "packages/db/src/policy-store.ts:reserveAllowed"
  )
];

const stepUpEdges = [
  transition(
    "execution-step-up-active-consumed",
    "step-up-status-active",
    "step-up-status-consumed",
    "CONSUMES_TO",
    "packages/db/src/step-up-proof-store.ts:consumeProof"
  ),
  transition(
    "execution-step-up-active-expired",
    "step-up-status-active",
    "step-up-status-expired",
    "EXPIRES_TO",
    "packages/db/src/step-up-proof-store.ts:consumeProof"
  )
];

const semanticEdges: IntelligenceGraphEdge[] = [
  edge({
    id: "execution-policy-operation-implemented",
    type: "IMPLEMENTED_IN_FILE",
    from: "entity-policy-operation",
    to: policyStoreFile,
    location: "packages/db/src/policy-store.ts:StoredPolicyOperation"
  }),
  edge({
    id: "execution-confirmation-defined",
    type: "DEFINED_IN_FILE",
    from: "entity-confirmation-request",
    to: policyContractFile,
    location: "packages/contracts/src/policy.ts:ConfirmationRequestSchema"
  }),
  edge({
    id: "execution-confirmation-persisted",
    type: "PERSISTED_BY",
    from: "entity-confirmation-request",
    to: policyStoreFile,
    location: "packages/db/src/policy-store.ts:confirmation_requests"
  }),
  edge({
    id: "execution-manager-coordinator",
    type: "EXECUTED_BY_FILE",
    from: "entity-manager-work",
    to: managerCoordinatorFile,
    location: "apps/api/src/manager-work-coordinator.ts:ManagerWorkCoordinator"
  }),
  edge({
    id: "execution-manager-store",
    type: "PERSISTED_BY",
    from: "entity-manager-work",
    to: managerStoreFile,
    location: "packages/db/src/manager-work-store.ts:ManagerWorkStore"
  }),
  edge({
    id: "execution-step-up-store",
    type: "PERSISTED_BY",
    from: "entity-step-up-proof",
    to: stepUpStoreFile,
    location: "packages/db/src/step-up-proof-store.ts:StepUpProofStore"
  }),

  edge({
    id: "execution-manager-recovery-claim-store",
    type: "ENFORCED_BY",
    from: "claim-manager-recovery-no-auto-replay",
    to: managerStoreFile,
    location: "packages/db/src/manager-work-store.ts:recover"
  }),
  edge({
    id: "execution-manager-recovery-claim-test",
    type: "VERIFIED_BY_TEST",
    from: "claim-manager-recovery-no-auto-replay",
    to: managerTest,
    location: "apps/api/test/manager-work.test.ts:recovers uncertain in-flight work"
  }),
  edge({
    id: "execution-manager-recovery-claim-status",
    type: "CONSTRAINS",
    from: "claim-manager-recovery-no-auto-replay",
    to: "manager-status-running",
    location: "packages/db/src/manager-work-store.ts:recover"
  }),

  edge({
    id: "execution-policy-recovery-claim-store",
    type: "ENFORCED_BY",
    from: "claim-policy-reserved-recovery-required",
    to: policyStoreFile,
    location: "packages/db/src/policy-store.ts:reserveAllowed:RESERVED"
  }),
  edge({
    id: "execution-policy-recovery-claim-test",
    type: "VERIFIED_BY_TEST",
    from: "claim-policy-reserved-recovery-required",
    to: policyStoreTest,
    location: "packages/db/test/policy-store.test.ts:recovery-required"
  }),
  edge({
    id: "execution-policy-recovery-claim-status",
    type: "APPLIES_TO",
    from: "claim-policy-reserved-recovery-required",
    to: "tool-operation-status-reserved",
    location: "packages/db/src/policy-store.ts:reserveAllowed"
  }),

  edge({
    id: "execution-policy-replay-claim-store",
    type: "ENFORCED_BY",
    from: "claim-policy-succeeded-replay-safe",
    to: policyStoreFile,
    location: "packages/db/src/policy-store.ts:reserveAllowed:SUCCEEDED"
  }),
  edge({
    id: "execution-policy-replay-claim-test",
    type: "VERIFIED_BY_TEST",
    from: "claim-policy-succeeded-replay-safe",
    to: toolRuntimeTest,
    location: "packages/tool-runtime/test/tool-runtime.test.ts:idempotent replay"
  }),
  edge({
    id: "execution-policy-replay-claim-status",
    type: "APPLIES_TO",
    from: "claim-policy-succeeded-replay-safe",
    to: "tool-operation-status-succeeded",
    location: "packages/db/src/policy-store.ts:reserveAllowed"
  }),

  edge({
    id: "execution-manager-lifecycle-test",
    type: "VERIFIED_BY_TEST",
    from: "entity-manager-work",
    to: managerTest,
    location: "apps/api/test/manager-work.test.ts"
  }),
  edge({
    id: "execution-policy-operation-test",
    type: "VERIFIED_BY_TEST",
    from: "entity-policy-operation",
    to: policyStoreTest,
    location: "packages/db/test/policy-store.test.ts"
  }),
  edge({
    id: "execution-confirmation-test",
    type: "VERIFIED_BY_TEST",
    from: "entity-confirmation-request",
    to: policyStoreTest,
    location: "packages/db/test/policy-store.test.ts:confirmation"
  }),
  edge({
    id: "execution-step-up-lifecycle-test",
    type: "VERIFIED_BY_TEST",
    from: "entity-step-up-proof",
    to: stepUpStoreTest,
    location: "packages/db/test/step-up-proof-store.test.ts"
  }),
  edge({
    id: "execution-checkpoint-no-authority-restore",
    type: "RECOVERY_CONSTRAINED_BY",
    from: "entity-runtime-checkpoint",
    to: "claim-checkpoint-no-authority-restore",
    location: "packages/contracts/src/manager-runtime-state.ts:RuntimeCheckpointSchema"
  })
];

const nodes = [
  ...managerStageNodes,
  ...managerStatusNodes,
  ...toolStatusNodes,
  ...confirmationStatusNodes,
  ...stepUpStatusNodes,
  ...lifecycleNodes,
  ...claimNodes
];

const edges = [
  ...definitionEdges,
  ...ownershipEdges,
  ...managerStageEdges,
  ...managerStatusEdges,
  ...toolOperationEdges,
  ...confirmationEdges,
  ...stepUpEdges,
  ...semanticEdges
];

const records: IntelligenceGraphSearchRecord[] = [
  ...nodes.map((item) => ({
    node: { id: item.node_id, version: 1 },
    text: item.node_id.replaceAll("-", " "),
    excerpt: item.source_ref.location,
    estimated_tokens: item.kind === "Claim" ? 16 : 12
  }))
];

export const cosmoraExecutionRecoveryGraph = () => ({ nodes, edges, records });

export const COSMORA_EXECUTION_RECOVERY_NODE_COUNT = nodes.length;
export const COSMORA_EXECUTION_RECOVERY_EDGE_COUNT = edges.length;
