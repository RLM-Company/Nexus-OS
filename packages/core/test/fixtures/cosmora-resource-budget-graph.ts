import type { IntelligenceGraphEdge, IntelligenceGraphNode } from "@cosmora/contracts";
import type { IntelligenceGraphSearchRecord } from "../../src/index.js";
import { repositoryStructureFileId } from "./cosmora-repository-structure-graph.js";

const ownerId = "owner-cosmora";
const projectId = "project-nexus-os";
const sourceId = "source-nexus-os-main-62bc523";
const recordedAt = "2026-10-04T05:40:00.000Z";
const validFrom = "2026-09-26T11:00:05.000Z";

const usageStatuses = ["reserved", "committed", "failed", "cancelled"] as const;

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
  extractor_version: "resource-budget-v1",
  supersedes: null,
  deleted_at: null
});

const statusNodes = usageStatuses.map((status) =>
  node({
    id: `usage-attempt-status-${status}`,
    location: `packages/db/src/usage-store.ts:UsageStatus:${status}`
  })
);

const budgetNodes = [
  node({
    id: "entity-project-usage-limit",
    location: "packages/contracts/src/usage.ts:ProjectUsageLimitSchema"
  }),
  node({
    id: "entity-model-usage-reservation",
    location: "packages/db/src/project-store.ts:reserveModelUsage"
  }),
  node({
    id: "entity-model-route-budget",
    location: "packages/contracts/src/model.ts:ModelRequestSchema.routing.max_cost"
  }),
  node({
    id: "entity-model-response-usage",
    location: "packages/contracts/src/model.ts:ModelResponseSchema.usage"
  }),
  node({
    id: "entity-manager-work-budget",
    location: "packages/contracts/src/manager-work.ts:CreateManagerWorkSchema"
  })
] as const;

const claim = (id: string, location: string): IntelligenceGraphNode =>
  node({ id, kind: "Claim", location });

const claimNodes = [
  claim(
    "claim-usage-reserve-before-dispatch",
    "apps/api/src/manager-work-coordinator.ts:model reservation before gateway dispatch"
  ),
  claim(
    "claim-usage-token-limit-fail-closed",
    "packages/db/src/project-store.ts:PROJECT_TOKEN_LIMIT_EXCEEDED"
  ),
  claim(
    "claim-usage-cost-limit-fail-closed",
    "packages/db/src/project-store.ts:PROJECT_COST_LIMIT_EXCEEDED"
  ),
  claim(
    "claim-usage-missing-evidence-fail-closed",
    "packages/db/src/project-store.ts:PROJECT_USAGE_EVIDENCE_MISSING"
  ),
  claim(
    "claim-usage-failure-not-refund",
    "packages/db/src/usage-store.ts:failed/cancelled requests may already have been billed"
  ),
  claim(
    "claim-usage-unknown-cost-preserved",
    "packages/db/src/usage-store.ts:unknown_committed_cost_attempts"
  ),
  claim(
    "claim-manager-retries-consume-budget",
    "apps/api/test/manager-work.test.ts:counts every retry"
  ),
  claim(
    "claim-router-cost-limit-needs-known-pricing",
    "packages/model-gateway/src/router.ts:costed max_cost filter"
  ),
  claim(
    "claim-manager-work-request-bounded",
    "packages/contracts/src/manager-work.ts:CreateManagerWorkSchema"
  )
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
  extractor_version: "resource-budget-v1",
  supersedes: null,
  deleted_at: null
});

const usageContractFile = repositoryStructureFileId("packages/contracts/src/usage.ts");
const modelContractFile = repositoryStructureFileId("packages/contracts/src/model.ts");
const managerWorkContractFile = repositoryStructureFileId("packages/contracts/src/manager-work.ts");
const usageStoreFile = repositoryStructureFileId("packages/db/src/usage-store.ts");
const projectStoreFile = repositoryStructureFileId("packages/db/src/project-store.ts");
const routerFile = repositoryStructureFileId("packages/model-gateway/src/router.ts");
const usageStoreTest = repositoryStructureFileId("packages/db/test/usage-store.test.ts");
const usageLimitsTest = repositoryStructureFileId("packages/db/test/usage-limits.test.ts");
const routerTest = repositoryStructureFileId("packages/model-gateway/test/router.test.ts");
const managerWorkTest = repositoryStructureFileId("apps/api/test/manager-work.test.ts");

const edges: IntelligenceGraphEdge[] = [
  ...statusNodes.flatMap((item) => [
    edge({
      id: `budget-status-defined-${item.node_id}`,
      type: "DEFINED_IN_FILE",
      from: item.node_id,
      to: usageStoreFile,
      location: item.source_ref.location
    }),
    edge({
      id: `budget-status-state-of-${item.node_id}`,
      type: "STATE_OF",
      from: item.node_id,
      to: "entity-model-usage-reservation",
      location: "packages/db/src/usage-store.ts:UsageStatus"
    })
  ]),

  edge({
    id: "budget-limit-contract",
    type: "DEFINED_IN_FILE",
    from: "entity-project-usage-limit",
    to: usageContractFile,
    location: "packages/contracts/src/usage.ts:ProjectUsageLimitSchema"
  }),
  edge({
    id: "budget-limit-persisted",
    type: "PERSISTED_BY",
    from: "entity-project-usage-limit",
    to: "entity-store-project-usage",
    location: "packages/db/src/usage-store.ts:project_usage_limits"
  }),
  edge({
    id: "budget-limit-versioned",
    type: "USES_OPTIMISTIC_VERSIONING_FOR",
    from: "entity-store-project-usage",
    to: "entity-project-usage-limit",
    location: "packages/db/src/usage-store.ts:updateLimit expected_version"
  }),
  edge({
    id: "budget-limit-step-up",
    type: "EXPANSION_REQUIRES",
    from: "entity-project-usage-limit",
    to: "step-up-purpose-project-usage-limit-expansion",
    location: "apps/api/src/app.ts:project_usage_limit_expansion"
  }),
  edge({
    id: "budget-limit-tested",
    type: "VERIFIED_BY_TEST",
    from: "entity-project-usage-limit",
    to: usageLimitsTest,
    location: "packages/db/test/usage-limits.test.ts"
  }),

  edge({
    id: "budget-reservation-implemented",
    type: "IMPLEMENTED_IN_FILE",
    from: "entity-model-usage-reservation",
    to: projectStoreFile,
    location: "packages/db/src/project-store.ts:reserveModelUsage"
  }),
  edge({
    id: "budget-reservation-updates-project-usage",
    type: "UPDATES",
    from: "entity-model-usage-reservation",
    to: "entity-project-usage",
    location: "packages/db/src/project-store.ts:model_usage_ledger"
  }),
  edge({
    id: "budget-reservation-enforces-limit",
    type: "ENFORCES",
    from: "entity-model-usage-reservation",
    to: "entity-project-usage-limit",
    location: "packages/db/src/project-store.ts:reserveModelUsage"
  }),
  edge({
    id: "budget-reservation-tested",
    type: "VERIFIED_BY_TEST",
    from: "entity-model-usage-reservation",
    to: usageLimitsTest,
    location: "packages/db/test/usage-limits.test.ts"
  }),

  edge({
    id: "budget-route-contract",
    type: "DEFINED_IN_FILE",
    from: "entity-model-route-budget",
    to: modelContractFile,
    location: "packages/contracts/src/model.ts:ModelRequestSchema.routing.max_cost"
  }),
  edge({
    id: "budget-route-enforced",
    type: "ENFORCED_BY",
    from: "entity-model-route-budget",
    to: "entity-router",
    location: "packages/model-gateway/src/router.ts:max_cost"
  }),
  edge({
    id: "budget-route-implementation",
    type: "IMPLEMENTED_IN_FILE",
    from: "entity-model-route-budget",
    to: routerFile,
    location: "packages/model-gateway/src/router.ts:estimateCost"
  }),
  edge({
    id: "budget-route-tested",
    type: "VERIFIED_BY_TEST",
    from: "entity-model-route-budget",
    to: routerTest,
    location: "packages/model-gateway/test/router.test.ts:BUDGET_EXCEEDED"
  }),

  edge({
    id: "budget-response-usage-contract",
    type: "DEFINED_IN_FILE",
    from: "entity-model-response-usage",
    to: modelContractFile,
    location: "packages/contracts/src/model.ts:ModelResponseSchema.usage"
  }),
  edge({
    id: "budget-response-recorded",
    type: "RECORDED_IN",
    from: "entity-model-response-usage",
    to: "entity-project-usage",
    location: "packages/db/src/project-store.ts:completeRun"
  }),

  edge({
    id: "budget-manager-contract",
    type: "DEFINED_IN_FILE",
    from: "entity-manager-work-budget",
    to: managerWorkContractFile,
    location: "packages/contracts/src/manager-work.ts:CreateManagerWorkSchema"
  }),
  edge({
    id: "budget-manager-constrains-work",
    type: "CONSTRAINS",
    from: "entity-manager-work-budget",
    to: "entity-manager-work",
    location: "packages/contracts/src/manager-work.ts:max_model_requests/max_input_tokens/max_output_tokens"
  }),
  edge({
    id: "budget-manager-tested",
    type: "VERIFIED_BY_TEST",
    from: "entity-manager-work-budget",
    to: managerWorkTest,
    location: "apps/api/test/manager-work.test.ts:counts every retry"
  }),

  edge({
    id: "budget-reserved-committed",
    type: "TRANSITIONS_TO",
    from: "usage-attempt-status-reserved",
    to: "usage-attempt-status-committed",
    location: "packages/db/src/project-store.ts:completeRun"
  }),
  edge({
    id: "budget-reserved-failed",
    type: "TRANSITIONS_TO",
    from: "usage-attempt-status-reserved",
    to: "usage-attempt-status-failed",
    location: "packages/db/src/project-store.ts:failModelUsage"
  }),
  edge({
    id: "budget-reserved-cancelled",
    type: "TRANSITIONS_TO",
    from: "usage-attempt-status-reserved",
    to: "usage-attempt-status-cancelled",
    location: "packages/db/src/project-store.ts:model usage cancellation"
  })
];

const claimBindings: Array<{
  claimId: string;
  target: string;
  test: string;
  source: string;
}> = [
  {
    claimId: "claim-usage-reserve-before-dispatch",
    target: "entity-model-usage-reservation",
    test: managerWorkTest,
    source: "apps/api/test/manager-work.test.ts:enforces project usage limits before dispatch"
  },
  {
    claimId: "claim-usage-token-limit-fail-closed",
    target: "entity-project-usage-limit",
    test: usageLimitsTest,
    source: "packages/db/test/usage-limits.test.ts:PROJECT_TOKEN_LIMIT_EXCEEDED"
  },
  {
    claimId: "claim-usage-cost-limit-fail-closed",
    target: "entity-project-usage-limit",
    test: usageLimitsTest,
    source: "packages/db/test/usage-limits.test.ts:PROJECT_COST_LIMIT_EXCEEDED"
  },
  {
    claimId: "claim-usage-missing-evidence-fail-closed",
    target: "entity-project-usage-limit",
    test: usageLimitsTest,
    source: "packages/db/test/usage-limits.test.ts:PROJECT_USAGE_EVIDENCE_MISSING"
  },
  {
    claimId: "claim-usage-failure-not-refund",
    target: "entity-project-usage",
    test: usageStoreTest,
    source: "packages/db/src/usage-store.ts:failed/cancelled upper bounds"
  },
  {
    claimId: "claim-usage-unknown-cost-preserved",
    target: "entity-project-usage",
    test: usageStoreTest,
    source: "packages/db/src/usage-store.ts:unknown cost counters"
  },
  {
    claimId: "claim-manager-retries-consume-budget",
    target: "entity-manager-work-budget",
    test: managerWorkTest,
    source: "apps/api/test/manager-work.test.ts:counts every retry"
  },
  {
    claimId: "claim-router-cost-limit-needs-known-pricing",
    target: "entity-model-route-budget",
    test: routerTest,
    source: "packages/model-gateway/test/router.test.ts:unknown pricing BUDGET_EXCEEDED"
  },
  {
    claimId: "claim-manager-work-request-bounded",
    target: "entity-manager-work-budget",
    test: managerWorkTest,
    source: "packages/contracts/src/manager-work.ts:CreateManagerWorkSchema"
  }
];

for (const binding of claimBindings) {
  edges.push(
    edge({
      id: `budget-${binding.claimId}-applies`,
      type: "CONSTRAINS",
      from: binding.claimId,
      to: binding.target,
      location: binding.source
    }),
    edge({
      id: `budget-${binding.claimId}-test`,
      type: "VERIFIED_BY_TEST",
      from: binding.claimId,
      to: binding.test,
      location: binding.source
    })
  );
}

edges.push(
  edge({
    id: "budget-reserve-before-dispatch-router",
    type: "PRECEDES",
    from: "entity-model-usage-reservation",
    to: "entity-router",
    location: "apps/api/src/manager-work-coordinator.ts:reserve before gateway.stream"
  }),
  edge({
    id: "budget-router-estimate-uses-registry-pricing",
    type: "USES_EVIDENCE_FROM",
    from: "entity-model-route-budget",
    to: "entity-model-registry",
    location: "packages/model-gateway/src/router.ts:entry.pricing"
  }),
  edge({
    id: "budget-unknown-pricing-model-intelligence",
    type: "CONSISTENT_WITH",
    from: "claim-router-cost-limit-needs-known-pricing",
    to: "evaluation-model-vibecode-unknown-pricing",
    location: "config/model-registry.vibecode.v1.json:pricing=null"
  }),
  edge({
    id: "budget-manager-reservation",
    type: "RESERVES_THROUGH",
    from: "entity-manager-work-budget",
    to: "entity-model-usage-reservation",
    location: "apps/api/src/manager-work-coordinator.ts:reserveModelUsage"
  })
);

const nodes = [...statusNodes, ...budgetNodes, ...claimNodes];

const records: IntelligenceGraphSearchRecord[] = nodes.map((item) => ({
  node: { id: item.node_id, version: 1 },
  text: item.node_id.replaceAll("-", " "),
  excerpt: item.source_ref.location,
  estimated_tokens: 12
}));

export const cosmoraResourceBudgetGraph = () => ({ nodes, edges, records });

export const COSMORA_RESOURCE_BUDGET_NODE_COUNT = nodes.length;
export const COSMORA_RESOURCE_BUDGET_EDGE_COUNT = edges.length;
