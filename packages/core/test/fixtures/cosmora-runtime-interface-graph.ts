import type { IntelligenceGraphEdge, IntelligenceGraphNode } from "@cosmora/contracts";
import type { IntelligenceGraphSearchRecord } from "../../src/index.js";
import { repositoryStructureFileId } from "./cosmora-repository-structure-graph.js";

const ownerId = "owner-cosmora";
const projectId = "project-nexus-os";
const sourceId = "source-nexus-os-main-62bc523";
const recordedAt = "2026-10-03T06:35:29.000Z";
const validFrom = "2026-09-26T11:00:05.000Z";

interface InterfaceInput {
  id: string;
  location: string;
}

const interfaceNode = (input: InterfaceInput): IntelligenceGraphNode => ({
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
  extractor_version: "runtime-interface-v1",
  supersedes: null,
  deleted_at: null
});

const nodes = [
  interfaceNode({
    id: "entity-api-manager-work",
    location: "apps/api/src/manager-work-routes.ts:/api/v1/projects/:projectId/work"
  }),
  interfaceNode({
    id: "entity-api-general-chat",
    location: "apps/api/src/general-chat-routes.ts:/api/v1/chats"
  }),
  interfaceNode({
    id: "entity-api-identity",
    location: "apps/api/src/app.ts:/api/v1/identity"
  }),
  interfaceNode({
    id: "entity-api-emergency-stop",
    location: "apps/api/src/app.ts:/api/v1/operations/emergency-stop"
  }),
  interfaceNode({
    id: "entity-api-model-runtime",
    location: "apps/api/src/app.ts:/api/v1/model-runtime"
  }),
  interfaceNode({
    id: "entity-api-project-usage",
    location: "apps/api/src/app.ts:/api/v1/projects/:projectId/usage"
  }),
  interfaceNode({
    id: "entity-api-autonomy-policy",
    location: "apps/api/src/app.ts:/api/v1/projects/:projectId/autonomy-profile"
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
  extractor_version: "runtime-interface-v1",
  supersedes: null,
  deleted_at: null
});

const appFile = repositoryStructureFileId("apps/api/src/app.ts");
const managerRoutesFile = repositoryStructureFileId("apps/api/src/manager-work-routes.ts");
const generalChatRoutesFile = repositoryStructureFileId("apps/api/src/general-chat-routes.ts");

const edges: IntelligenceGraphEdge[] = [
  edge({
    id: "api-manager-exposed",
    type: "EXPOSED_BY_FILE",
    from: "entity-api-manager-work",
    to: managerRoutesFile,
    location: "apps/api/src/manager-work-routes.ts:registerManagerWorkRoutes"
  }),
  edge({
    id: "api-manager-identity",
    type: "REQUIRES_IDENTITY",
    from: "entity-api-manager-work",
    to: "entity-identity-session",
    location: "apps/api/src/app.ts:onRequest"
  }),
  edge({
    id: "api-manager-manages-work",
    type: "MANAGES",
    from: "entity-api-manager-work",
    to: "entity-manager-work",
    location: "apps/api/src/manager-work-routes.ts:ManagerWorkStore"
  }),
  edge({
    id: "api-manager-controls-runtime",
    type: "CONTROLS_RUNTIME",
    from: "entity-api-manager-work",
    to: "artifact-manager-work-runtime",
    location: "apps/api/src/manager-work-routes.ts:coordinator.control"
  }),
  edge({
    id: "api-manager-tested",
    type: "VERIFIED_BY_TEST",
    from: "entity-api-manager-work",
    to: repositoryStructureFileId("apps/api/test/manager-work.test.ts"),
    location: "apps/api/test/manager-work.test.ts"
  }),

  edge({
    id: "api-chat-exposed",
    type: "EXPOSED_BY_FILE",
    from: "entity-api-general-chat",
    to: generalChatRoutesFile,
    location: "apps/api/src/general-chat-routes.ts:registerGeneralChatRoutes"
  }),
  edge({
    id: "api-chat-identity",
    type: "REQUIRES_IDENTITY",
    from: "entity-api-general-chat",
    to: "entity-identity-session",
    location: "apps/api/src/app.ts:onRequest"
  }),
  edge({
    id: "api-chat-manages-runtime",
    type: "MANAGES",
    from: "entity-api-general-chat",
    to: "entity-general-chat-runtime",
    location: "apps/api/src/general-chat-routes.ts:GeneralChatStore"
  }),
  edge({
    id: "api-chat-dispatches-model",
    type: "DISPATCHES_TO",
    from: "entity-api-general-chat",
    to: "entity-model-gateway",
    location: "apps/api/src/general-chat-routes.ts:modelGateway.stream"
  }),
  edge({
    id: "api-chat-tested",
    type: "VERIFIED_BY_TEST",
    from: "entity-api-general-chat",
    to: repositoryStructureFileId("apps/api/test/general-chat-api.test.ts"),
    location: "apps/api/test/general-chat-api.test.ts"
  }),

  edge({
    id: "api-identity-exposed",
    type: "EXPOSED_BY_FILE",
    from: "entity-api-identity",
    to: appFile,
    location: "apps/api/src/app.ts:/api/v1/identity"
  }),
  edge({
    id: "api-identity-owner-gate",
    type: "REQUIRES_IDENTITY",
    from: "entity-api-identity",
    to: "entity-identity-session",
    location: "apps/api/src/app.ts:onRequest"
  }),
  edge({
    id: "api-identity-manages-sessions",
    type: "MANAGES",
    from: "entity-api-identity",
    to: "entity-identity-session",
    location: "apps/api/src/app.ts:identityStore"
  }),
  edge({
    id: "api-identity-tested",
    type: "VERIFIED_BY_TEST",
    from: "entity-api-identity",
    to: repositoryStructureFileId("apps/api/test/identity-boundary.test.ts"),
    location: "apps/api/test/identity-boundary.test.ts"
  }),

  edge({
    id: "api-stop-exposed",
    type: "EXPOSED_BY_FILE",
    from: "entity-api-emergency-stop",
    to: appFile,
    location: "apps/api/src/app.ts:/api/v1/operations/emergency-stop"
  }),
  edge({
    id: "api-stop-identity",
    type: "REQUIRES_IDENTITY",
    from: "entity-api-emergency-stop",
    to: "entity-identity-session",
    location: "apps/api/src/app.ts:onRequest"
  }),
  edge({
    id: "api-stop-control",
    type: "EXPOSES_CONTROL_FOR",
    from: "entity-api-emergency-stop",
    to: "claim-manager-emergency-stop",
    location: "apps/api/src/app.ts:emergencyStopStore"
  }),
  edge({
    id: "api-stop-clearance-step-up",
    type: "REQUIRES_STEP_UP_FOR_CLEARANCE",
    from: "entity-api-emergency-stop",
    to: "entity-step-up-proof",
    location: "apps/api/src/app.ts:emergency_stop_clearance"
  }),
  edge({
    id: "api-stop-clearance-tested",
    type: "VERIFIED_BY_TEST",
    from: "entity-api-emergency-stop",
    to: repositoryStructureFileId("apps/api/test/emergency-stop-clearance.test.ts"),
    location: "apps/api/test/emergency-stop-clearance.test.ts"
  }),
  edge({
    id: "api-stop-operations-tested",
    type: "VERIFIED_BY_TEST",
    from: "entity-api-emergency-stop",
    to: repositoryStructureFileId("apps/api/test/operations.test.ts"),
    location: "apps/api/test/operations.test.ts"
  }),

  edge({
    id: "api-model-runtime-exposed",
    type: "EXPOSED_BY_FILE",
    from: "entity-api-model-runtime",
    to: appFile,
    location: "apps/api/src/app.ts:/api/v1/model-runtime"
  }),
  edge({
    id: "api-model-runtime-identity",
    type: "REQUIRES_IDENTITY",
    from: "entity-api-model-runtime",
    to: "entity-identity-session",
    location: "apps/api/src/app.ts:onRequest"
  }),
  edge({
    id: "api-model-runtime-gateway",
    type: "REPORTS_STATUS_FOR",
    from: "entity-api-model-runtime",
    to: "entity-model-gateway",
    location: "apps/api/src/app.ts:ModelRuntimeStatus"
  }),
  edge({
    id: "api-model-runtime-registry",
    type: "REPORTS_STATUS_FOR",
    from: "entity-api-model-runtime",
    to: "entity-model-registry",
    location: "apps/api/src/app.ts:registry_version"
  }),
  edge({
    id: "api-model-runtime-tested",
    type: "VERIFIED_BY_TEST",
    from: "entity-api-model-runtime",
    to: repositoryStructureFileId("apps/api/test/model-runtime.test.ts"),
    location: "apps/api/test/model-runtime.test.ts"
  }),

  edge({
    id: "api-usage-exposed",
    type: "EXPOSED_BY_FILE",
    from: "entity-api-project-usage",
    to: appFile,
    location: "apps/api/src/app.ts:/api/v1/projects/:projectId/usage"
  }),
  edge({
    id: "api-usage-identity",
    type: "REQUIRES_IDENTITY",
    from: "entity-api-project-usage",
    to: "entity-identity-session",
    location: "apps/api/src/app.ts:onRequest"
  }),
  edge({
    id: "api-usage-manages",
    type: "MANAGES",
    from: "entity-api-project-usage",
    to: "entity-project-usage",
    location: "apps/api/src/app.ts:usageStore"
  }),
  edge({
    id: "api-usage-step-up",
    type: "REQUIRES_STEP_UP_FOR_EXPANSION",
    from: "entity-api-project-usage",
    to: "entity-step-up-proof",
    location: "apps/api/src/app.ts:project_usage_limit_expansion"
  }),
  edge({
    id: "api-usage-tested",
    type: "VERIFIED_BY_TEST",
    from: "entity-api-project-usage",
    to: repositoryStructureFileId("apps/api/test/usage.test.ts"),
    location: "apps/api/test/usage.test.ts"
  }),

  edge({
    id: "api-autonomy-exposed",
    type: "EXPOSED_BY_FILE",
    from: "entity-api-autonomy-policy",
    to: appFile,
    location: "apps/api/src/app.ts:/api/v1/projects/:projectId/autonomy-profile"
  }),
  edge({
    id: "api-autonomy-identity",
    type: "REQUIRES_IDENTITY",
    from: "entity-api-autonomy-policy",
    to: "entity-identity-session",
    location: "apps/api/src/app.ts:onRequest"
  }),
  edge({
    id: "api-autonomy-profile",
    type: "EXPOSES_CONTROL_FOR",
    from: "entity-api-autonomy-policy",
    to: "claim-policy-capability-profile-project",
    location: "apps/api/src/app.ts:policyStore"
  }),
  edge({
    id: "api-autonomy-policy",
    type: "ENFORCED_BY",
    from: "entity-api-autonomy-policy",
    to: "entity-policy-engine",
    location: "apps/api/src/app.ts:CapabilityProfile"
  }),
  edge({
    id: "api-autonomy-step-up",
    type: "REQUIRES_STEP_UP_FOR_ESCALATION",
    from: "entity-api-autonomy-policy",
    to: "entity-step-up-proof",
    location: "apps/api/src/app.ts:autonomy_profile_escalation"
  }),
  edge({
    id: "api-autonomy-policy-tested",
    type: "VERIFIED_BY_TEST",
    from: "entity-api-autonomy-policy",
    to: repositoryStructureFileId("apps/api/test/policy.test.ts"),
    location: "apps/api/test/policy.test.ts"
  }),
  edge({
    id: "api-autonomy-step-up-tested",
    type: "VERIFIED_BY_TEST",
    from: "entity-api-autonomy-policy",
    to: repositoryStructureFileId("apps/api/test/step-up-challenge.test.ts"),
    location: "apps/api/test/step-up-challenge.test.ts"
  })
];

const records: IntelligenceGraphSearchRecord[] = [
  {
    node: { id: "entity-api-manager-work", version: 1 },
    text: "Manager Work API project work list create detail control download",
    excerpt:
      "GET/POST /api/v1/projects/:projectId/work; GET /:id; POST /:id/control; GET /:id/files/:name.",
    estimated_tokens: 24
  },
  {
    node: { id: "entity-api-general-chat", version: 1 },
    text: "General Chat API chats messages runs cancel events SSE",
    excerpt:
      "GET/POST /api/v1/chats; GET /api/v1/chats/:chatId; POST messages; POST run cancel; GET run events.",
    estimated_tokens: 24
  },
  {
    node: { id: "entity-api-identity", version: 1 },
    text: "Identity API owner sessions audit events revoke session",
    excerpt:
      "GET identity sessions; GET audit-events; POST session revoke. All non-health routes use the fail-closed owner identity hook.",
    estimated_tokens: 22
  },
  {
    node: { id: "entity-api-emergency-stop", version: 1 },
    text: "Emergency Stop API operations status stop clearance step-up",
    excerpt:
      "GET operations status/stop/clearance-events; POST emergency-stop and clearance. Clearance consumes step-up proof.",
    estimated_tokens: 24
  },
  {
    node: { id: "entity-api-model-runtime", version: 1 },
    text: "Model Runtime API provider model registry version status",
    excerpt:
      "GET /api/v1/model-runtime reports provider, model, registry version, credentials, fallback and route attempt limits.",
    estimated_tokens: 22
  },
  {
    node: { id: "entity-api-project-usage", version: 1 },
    text: "Project Usage API usage summary limits preview update step-up",
    excerpt:
      "GET usage summary/limit; POST usage-limit preview; PUT usage-limit. Limit expansion may consume step-up proof.",
    estimated_tokens: 24
  },
  {
    node: { id: "entity-api-autonomy-policy", version: 1 },
    text: "Autonomy Policy API capability profile decision trace recovery preview update step-up",
    excerpt:
      "GET autonomy profile/decision trace/recovery-required; POST preview; PUT autonomy profile. Escalation may require step-up.",
    estimated_tokens: 26
  }
];

export const cosmoraRuntimeInterfaceGraph = () => ({ nodes: [...nodes], edges, records });

export const COSMORA_RUNTIME_INTERFACE_NODE_COUNT = nodes.length;
export const COSMORA_RUNTIME_INTERFACE_EDGE_COUNT = edges.length;
