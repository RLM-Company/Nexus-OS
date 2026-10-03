import type { IntelligenceGraphEdge, IntelligenceGraphNode } from "@cosmora/contracts";
import type { IntelligenceGraphSearchRecord } from "../../src/index.js";
import { repositoryStructureFileId } from "./cosmora-repository-structure-graph.js";

const ownerId = "owner-cosmora";
const projectId = "project-nexus-os";
const sourceId = "source-nexus-os-main-62bc523";
const recordedAt = "2026-10-03T06:35:29.000Z";
const validFrom = "2026-09-26T11:00:05.000Z";

const storeNode = (input: { id: string; location: string }): IntelligenceGraphNode => ({
  contract_version: 1,
  node_id: input.id,
  node_version: 1,
  kind: "Entity",
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
  extractor_version: "state-persistence-v1",
  supersedes: null,
  deleted_at: null
});

const nodes = [
  storeNode({
    id: "entity-store-manager-work",
    location: "packages/db/src/manager-work-store.ts:ManagerWorkStore"
  }),
  storeNode({
    id: "entity-store-project-usage",
    location: "packages/db/src/usage-store.ts:UsageStore"
  }),
  storeNode({
    id: "entity-store-identity",
    location: "packages/db/src/identity-store.ts:IdentityStore"
  }),
  storeNode({
    id: "entity-store-policy",
    location: "packages/db/src/policy-store.ts:PolicyStore"
  }),
  storeNode({
    id: "entity-store-agent-blueprint",
    location: "packages/db/src/agent-blueprint-store.ts:AgentBlueprintStore"
  }),
  storeNode({
    id: "entity-store-general-chat-runtime",
    location: "apps/api/src/general-chat-runtime-store.ts:GeneralChatRuntimeStore"
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
  extractor_version: "state-persistence-v1",
  supersedes: null,
  deleted_at: null
});

const edges: IntelligenceGraphEdge[] = [
  edge({
    id: "state-manager-persists-work",
    type: "PERSISTS",
    from: "entity-store-manager-work",
    to: "entity-manager-work",
    location: "packages/db/src/manager-work-store.ts:manager_work"
  }),
  edge({
    id: "state-manager-file",
    type: "IMPLEMENTED_IN_FILE",
    from: "entity-store-manager-work",
    to: repositoryStructureFileId("packages/db/src/manager-work-store.ts"),
    location: "packages/db/src/manager-work-store.ts"
  }),
  edge({
    id: "state-manager-idempotency",
    type: "ENFORCES_IDEMPOTENCY_FOR",
    from: "entity-store-manager-work",
    to: "entity-manager-work",
    location: "packages/db/src/manager-work-store.ts:create:client_request_id"
  }),
  edge({
    id: "state-manager-versioning",
    type: "USES_OPTIMISTIC_VERSIONING_FOR",
    from: "entity-store-manager-work",
    to: "entity-manager-work",
    location: "packages/db/src/manager-work-store.ts:save:version"
  }),
  edge({
    id: "state-manager-recovery",
    type: "RECOVERS_WITHOUT_AUTOMATIC_REPLAY",
    from: "entity-store-manager-work",
    to: "entity-manager-work",
    location: "packages/db/src/manager-work-store.ts:recover"
  }),

  edge({
    id: "state-usage-persists",
    type: "PERSISTS",
    from: "entity-store-project-usage",
    to: "entity-project-usage",
    location: "packages/db/src/usage-store.ts:model_usage_ledger"
  }),
  edge({
    id: "state-usage-file",
    type: "IMPLEMENTED_IN_FILE",
    from: "entity-store-project-usage",
    to: repositoryStructureFileId("packages/db/src/usage-store.ts"),
    location: "packages/db/src/usage-store.ts"
  }),
  edge({
    id: "state-usage-versioning",
    type: "USES_OPTIMISTIC_VERSIONING_FOR",
    from: "entity-store-project-usage",
    to: "entity-project-usage",
    location: "packages/db/src/usage-store.ts:updateLimit:expected_version"
  }),
  edge({
    id: "state-usage-unknown-cost",
    type: "PRESERVES_UNKNOWN_COST_FOR",
    from: "entity-store-project-usage",
    to: "entity-project-usage",
    location: "packages/db/src/usage-store.ts:getProjectSummary:unknown_committed_cost_attempts"
  }),
  edge({
    id: "state-usage-test",
    type: "VERIFIED_BY_TEST",
    from: "entity-store-project-usage",
    to: repositoryStructureFileId("packages/db/test/usage-store.test.ts"),
    location: "packages/db/test/usage-store.test.ts"
  }),
  edge({
    id: "state-usage-limit-test",
    type: "VERIFIED_BY_TEST",
    from: "entity-store-project-usage",
    to: repositoryStructureFileId("packages/db/test/usage-limits.test.ts"),
    location: "packages/db/test/usage-limits.test.ts"
  }),

  edge({
    id: "state-identity-persists",
    type: "PERSISTS",
    from: "entity-store-identity",
    to: "entity-identity-session",
    location: "packages/db/src/identity-store.ts:IdentityStore"
  }),
  edge({
    id: "state-identity-file",
    type: "IMPLEMENTED_IN_FILE",
    from: "entity-store-identity",
    to: repositoryStructureFileId("packages/db/src/identity-store.ts"),
    location: "packages/db/src/identity-store.ts"
  }),
  edge({
    id: "state-identity-hashes-token",
    type: "HASHES_SESSION_TOKEN_FOR",
    from: "entity-store-identity",
    to: "entity-identity-session",
    location: "packages/db/src/identity-store.ts:hashIdentitySessionToken"
  }),
  edge({
    id: "state-identity-owner-scoped",
    type: "OWNER_SCOPES",
    from: "entity-store-identity",
    to: "entity-identity-session",
    location: "packages/db/src/identity-store.ts:getActor/getSession owner_id filters"
  }),
  edge({
    id: "state-identity-test",
    type: "VERIFIED_BY_TEST",
    from: "entity-store-identity",
    to: repositoryStructureFileId("packages/db/test/identity-store.test.ts"),
    location: "packages/db/test/identity-store.test.ts"
  }),

  edge({
    id: "state-policy-persists",
    type: "PERSISTS_DECISION_TRACE_FOR",
    from: "entity-store-policy",
    to: "entity-policy-engine",
    location: "packages/db/src/policy-store.ts:listDecisionTrace"
  }),
  edge({
    id: "state-policy-file",
    type: "IMPLEMENTED_IN_FILE",
    from: "entity-store-policy",
    to: repositoryStructureFileId("packages/db/src/policy-store.ts"),
    location: "packages/db/src/policy-store.ts"
  }),
  edge({
    id: "state-policy-idempotency",
    type: "ENFORCES_IDEMPOTENCY_FOR",
    from: "entity-store-policy",
    to: "entity-policy-engine",
    location: "packages/db/src/policy-store.ts:getOperation:idempotency_key"
  }),
  edge({
    id: "state-policy-recovery",
    type: "EXPOSES_RECOVERY_REQUIRED_FOR",
    from: "entity-store-policy",
    to: "entity-policy-engine",
    location: "packages/db/src/policy-store.ts:listRecoveryRequired"
  }),
  edge({
    id: "state-policy-test",
    type: "VERIFIED_BY_TEST",
    from: "entity-store-policy",
    to: repositoryStructureFileId("packages/db/test/policy-store.test.ts"),
    location: "packages/db/test/policy-store.test.ts"
  }),

  edge({
    id: "state-blueprint-persists",
    type: "PERSISTS",
    from: "entity-store-agent-blueprint",
    to: "entity-agent-instance",
    location: "packages/db/src/agent-blueprint-store.ts:agent_blueprints"
  }),
  edge({
    id: "state-blueprint-file",
    type: "IMPLEMENTED_IN_FILE",
    from: "entity-store-agent-blueprint",
    to: repositoryStructureFileId("packages/db/src/agent-blueprint-store.ts"),
    location: "packages/db/src/agent-blueprint-store.ts"
  }),
  edge({
    id: "state-blueprint-versioning",
    type: "USES_OPTIMISTIC_VERSIONING_FOR",
    from: "entity-store-agent-blueprint",
    to: "entity-agent-instance",
    location: "packages/db/src/agent-blueprint-store.ts:createBlueprintVersion:expectedVersion"
  }),
  edge({
    id: "state-blueprint-project-bound",
    type: "PROJECT_SCOPES",
    from: "entity-store-agent-blueprint",
    to: "entity-agent-instance",
    location: "packages/db/src/agent-blueprint-store.ts:_ownsProject"
  }),
  edge({
    id: "state-blueprint-test",
    type: "VERIFIED_BY_TEST",
    from: "entity-store-agent-blueprint",
    to: repositoryStructureFileId("packages/db/test/agent-blueprint-store.test.ts"),
    location: "packages/db/test/agent-blueprint-store.test.ts"
  }),

  edge({
    id: "state-chat-persists",
    type: "PERSISTS",
    from: "entity-store-general-chat-runtime",
    to: "entity-general-chat-runtime",
    location: "apps/api/src/general-chat-runtime-store.ts:GeneralChatRuntimeStore"
  }),
  edge({
    id: "state-chat-file",
    type: "IMPLEMENTED_IN_FILE",
    from: "entity-store-general-chat-runtime",
    to: repositoryStructureFileId("apps/api/src/general-chat-runtime-store.ts"),
    location: "apps/api/src/general-chat-runtime-store.ts"
  }),
  edge({
    id: "state-chat-atomic-claim",
    type: "ATOMICALLY_CLAIMS",
    from: "entity-store-general-chat-runtime",
    to: "entity-general-chat-runtime",
    location: "apps/api/src/general-chat-runtime-store.ts:claimQueuedGeneralChatRun"
  }),
  edge({
    id: "state-chat-prevents-double-execution",
    type: "PREVENTS_DUPLICATE_EXECUTION_FOR",
    from: "entity-store-general-chat-runtime",
    to: "entity-general-chat-runtime",
    location: "apps/api/src/general-chat-runtime-store.ts:startAssistantMessage"
  }),
  edge({
    id: "state-chat-test",
    type: "VERIFIED_BY_TEST",
    from: "entity-store-general-chat-runtime",
    to: repositoryStructureFileId("packages/db/test/general-chat-store.test.ts"),
    location: "packages/db/test/general-chat-store.test.ts"
  })
];

const records: IntelligenceGraphSearchRecord[] = [
  {
    node: { id: "entity-store-manager-work", version: 1 },
    text: "Manager Work persistent store idempotency optimistic version recovery no replay",
    excerpt: "Manager work state uses client request idempotency, optimistic versioning and fail-closed recovery.",
    estimated_tokens: 20
  },
  {
    node: { id: "entity-store-project-usage", version: 1 },
    text: "project usage ledger limits reserved committed failed cancelled unknown cost optimistic version",
    excerpt: "Usage store preserves attempt states, unknown costs and versioned project limits.",
    estimated_tokens: 20
  },
  {
    node: { id: "entity-store-identity", version: 1 },
    text: "identity session store owner scoped token hash revocation assurance expiry",
    excerpt: "Identity store persists owner-scoped sessions and stores hashed session-token evidence.",
    estimated_tokens: 18
  },
  {
    node: { id: "entity-store-policy", version: 1 },
    text: "policy store operation idempotency decision trace recovery required",
    excerpt: "Policy store persists exact-intent operations, decision traces and recovery-required operations.",
    estimated_tokens: 18
  },
  {
    node: { id: "entity-store-agent-blueprint", version: 1 },
    text: "agent blueprint store project scoped versioned composition grant memory scope",
    excerpt: "Agent blueprints are versioned, owner/project scoped and validated before persistence.",
    estimated_tokens: 18
  },
  {
    node: { id: "entity-store-general-chat-runtime", version: 1 },
    text: "general chat runtime store atomic queued run claim duplicate execution guard",
    excerpt: "Runtime store atomically claims queued chat runs and guards against duplicate execution.",
    estimated_tokens: 18
  }
];

export const cosmoraStatePersistenceGraph = () => ({ nodes: [...nodes], edges, records });

export const COSMORA_STATE_PERSISTENCE_NODE_COUNT = nodes.length;
export const COSMORA_STATE_PERSISTENCE_EDGE_COUNT = edges.length;
