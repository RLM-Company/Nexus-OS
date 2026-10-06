import type { IntelligenceGraphEdge, IntelligenceGraphNode } from "@cosmora/contracts";
import type { IntelligenceGraphSearchRecord } from "../../src/index.js";
import { repositoryStructureFileId } from "./cosmora-repository-structure-graph.js";

const ownerId = "owner-cosmora";
const projectId = "project-nexus-os";
const sourceId = "source-nexus-os-main-62bc523";
const recordedAt = "2026-10-06T08:10:00.000Z";
const validFrom = "2026-09-26T11:00:05.000Z";

const routes = [
  {
    method: "GET",
    path: "/api/v1/health",
    file: "apps/api/src/app.ts",
    family: "health",
    owner: false,
    project: false,
    stepUp: false,
    idempotency: false
  },
  {
    method: "GET",
    path: "/api/v1/identity/sessions",
    file: "apps/api/src/app.ts",
    family: "identity",
    owner: true,
    project: false,
    stepUp: false,
    idempotency: false
  },
  {
    method: "GET",
    path: "/api/v1/identity/audit-events",
    file: "apps/api/src/app.ts",
    family: "identity",
    owner: true,
    project: false,
    stepUp: false,
    idempotency: false
  },
  {
    method: "POST",
    path: "/api/v1/identity/sessions/:sessionId/revoke",
    file: "apps/api/src/app.ts",
    family: "identity",
    owner: true,
    project: false,
    stepUp: false,
    idempotency: false
  },
  {
    method: "GET",
    path: "/api/v1/operations/status",
    file: "apps/api/src/app.ts",
    family: "operations",
    owner: true,
    project: false,
    stepUp: false,
    idempotency: false
  },
  {
    method: "GET",
    path: "/api/v1/operations/emergency-stop",
    file: "apps/api/src/app.ts",
    family: "operations",
    owner: true,
    project: false,
    stepUp: false,
    idempotency: false
  },
  {
    method: "POST",
    path: "/api/v1/operations/emergency-stop",
    file: "apps/api/src/app.ts",
    family: "operations",
    owner: true,
    project: false,
    stepUp: false,
    idempotency: false
  },
  {
    method: "GET",
    path: "/api/v1/operations/emergency-stop/clearance-events",
    file: "apps/api/src/app.ts",
    family: "operations",
    owner: true,
    project: false,
    stepUp: false,
    idempotency: false
  },
  {
    method: "POST",
    path: "/api/v1/operations/emergency-stop/clearance",
    file: "apps/api/src/app.ts",
    family: "operations",
    owner: true,
    project: false,
    stepUp: true,
    idempotency: false
  },
  {
    method: "GET",
    path: "/api/v1/model-runtime",
    file: "apps/api/src/app.ts",
    family: "model_runtime",
    owner: true,
    project: false,
    stepUp: false,
    idempotency: false
  },
  {
    method: "GET",
    path: "/api/v1/projects/:projectId/agent-studio/functions",
    file: "apps/api/src/app.ts",
    family: "agent_studio",
    owner: true,
    project: true,
    stepUp: false,
    idempotency: false
  },
  {
    method: "GET",
    path: "/api/v1/projects/:projectId/agent-studio/patterns",
    file: "apps/api/src/app.ts",
    family: "agent_studio",
    owner: true,
    project: true,
    stepUp: false,
    idempotency: false
  },
  {
    method: "GET",
    path: "/api/v1/projects/:projectId/agent-studio/blueprints",
    file: "apps/api/src/app.ts",
    family: "agent_studio",
    owner: true,
    project: true,
    stepUp: false,
    idempotency: false
  },
  {
    method: "GET",
    path: "/api/v1/projects/:projectId/agent-studio/proposals",
    file: "apps/api/src/app.ts",
    family: "agent_studio",
    owner: true,
    project: true,
    stepUp: false,
    idempotency: false
  },
  {
    method: "GET",
    path: "/api/v1/projects/:projectId/agent-studio/decision-events",
    file: "apps/api/src/app.ts",
    family: "agent_studio",
    owner: true,
    project: true,
    stepUp: false,
    idempotency: false
  },
  {
    method: "POST",
    path: "/api/v1/projects/:projectId/agent-studio/proposals",
    file: "apps/api/src/app.ts",
    family: "agent_studio",
    owner: true,
    project: true,
    stepUp: false,
    idempotency: true
  },
  {
    method: "POST",
    path: "/api/v1/projects/:projectId/agent-studio/proposals/delegated",
    file: "apps/api/src/app.ts",
    family: "agent_studio",
    owner: true,
    project: true,
    stepUp: false,
    idempotency: true
  },
  {
    method: "POST",
    path: "/api/v1/projects/:projectId/agent-studio/functions",
    file: "apps/api/src/app.ts",
    family: "agent_studio",
    owner: true,
    project: true,
    stepUp: false,
    idempotency: true
  },
  {
    method: "POST",
    path: "/api/v1/projects/:projectId/agent-studio/functions/:functionId/versions",
    file: "apps/api/src/app.ts",
    family: "agent_studio",
    owner: true,
    project: true,
    stepUp: false,
    idempotency: false
  },
  {
    method: "POST",
    path: "/api/v1/projects/:projectId/agent-studio/patterns",
    file: "apps/api/src/app.ts",
    family: "agent_studio",
    owner: true,
    project: true,
    stepUp: false,
    idempotency: true
  },
  {
    method: "POST",
    path: "/api/v1/projects/:projectId/agent-studio/patterns/:patternId/versions",
    file: "apps/api/src/app.ts",
    family: "agent_studio",
    owner: true,
    project: true,
    stepUp: false,
    idempotency: false
  },
  {
    method: "POST",
    path: "/api/v1/projects/:projectId/agent-studio/patterns/:patternId/archive",
    file: "apps/api/src/app.ts",
    family: "agent_studio",
    owner: true,
    project: true,
    stepUp: false,
    idempotency: false
  },
  {
    method: "POST",
    path: "/api/v1/projects/:projectId/agent-studio/blueprints",
    file: "apps/api/src/app.ts",
    family: "agent_studio",
    owner: true,
    project: true,
    stepUp: false,
    idempotency: true
  },
  {
    method: "POST",
    path: "/api/v1/projects/:projectId/agent-studio/blueprints/:blueprintId/versions",
    file: "apps/api/src/app.ts",
    family: "agent_studio",
    owner: true,
    project: true,
    stepUp: false,
    idempotency: false
  },
  {
    method: "GET",
    path: "/api/v1/projects",
    file: "apps/api/src/app.ts",
    family: "projects",
    owner: true,
    project: false,
    stepUp: false,
    idempotency: false
  },
  {
    method: "POST",
    path: "/api/v1/projects",
    file: "apps/api/src/app.ts",
    family: "projects",
    owner: true,
    project: false,
    stepUp: false,
    idempotency: false
  },
  {
    method: "GET",
    path: "/api/v1/projects/:projectId/usage-summary",
    file: "apps/api/src/app.ts",
    family: "usage",
    owner: true,
    project: true,
    stepUp: false,
    idempotency: false
  },
  {
    method: "GET",
    path: "/api/v1/projects/:projectId/usage-limit",
    file: "apps/api/src/app.ts",
    family: "usage",
    owner: true,
    project: true,
    stepUp: false,
    idempotency: false
  },
  {
    method: "POST",
    path: "/api/v1/projects/:projectId/usage-limit/preview",
    file: "apps/api/src/app.ts",
    family: "usage",
    owner: true,
    project: true,
    stepUp: false,
    idempotency: false
  },
  {
    method: "PUT",
    path: "/api/v1/projects/:projectId/usage-limit",
    file: "apps/api/src/app.ts",
    family: "usage",
    owner: true,
    project: true,
    stepUp: true,
    idempotency: false
  },
  {
    method: "GET",
    path: "/api/v1/projects/:projectId/autonomy-profile",
    file: "apps/api/src/app.ts",
    family: "autonomy_policy",
    owner: true,
    project: true,
    stepUp: false,
    idempotency: false
  },
  {
    method: "GET",
    path: "/api/v1/projects/:projectId/decision-trace",
    file: "apps/api/src/app.ts",
    family: "autonomy_policy",
    owner: true,
    project: true,
    stepUp: false,
    idempotency: false
  },
  {
    method: "GET",
    path: "/api/v1/projects/:projectId/recovery-required",
    file: "apps/api/src/app.ts",
    family: "autonomy_policy",
    owner: true,
    project: true,
    stepUp: false,
    idempotency: false
  },
  {
    method: "POST",
    path: "/api/v1/projects/:projectId/autonomy-profile/preview",
    file: "apps/api/src/app.ts",
    family: "autonomy_policy",
    owner: true,
    project: true,
    stepUp: false,
    idempotency: false
  },
  {
    method: "PUT",
    path: "/api/v1/projects/:projectId/autonomy-profile",
    file: "apps/api/src/app.ts",
    family: "autonomy_policy",
    owner: true,
    project: true,
    stepUp: true,
    idempotency: false
  },
  {
    method: "GET",
    path: "/api/v1/projects/:projectId/confirmations",
    file: "apps/api/src/app.ts",
    family: "autonomy_policy",
    owner: true,
    project: true,
    stepUp: false,
    idempotency: false
  },
  {
    method: "POST",
    path: "/api/v1/confirmations/:confirmationId/approve",
    file: "apps/api/src/app.ts",
    family: "autonomy_policy",
    owner: true,
    project: false,
    stepUp: true,
    idempotency: false
  },
  {
    method: "POST",
    path: "/api/v1/confirmations/:confirmationId/reject",
    file: "apps/api/src/app.ts",
    family: "autonomy_policy",
    owner: true,
    project: false,
    stepUp: false,
    idempotency: false
  },
  {
    method: "GET",
    path: "/api/v1/projects/:projectId",
    file: "apps/api/src/app.ts",
    family: "projects",
    owner: true,
    project: true,
    stepUp: false,
    idempotency: false
  },
  {
    method: "POST",
    path: "/api/v1/projects/:projectId/messages",
    file: "apps/api/src/app.ts",
    family: "project_model_runs",
    owner: true,
    project: true,
    stepUp: false,
    idempotency: false
  },
  {
    method: "GET",
    path: "/api/v1/projects/:projectId/manager-demo-runs",
    file: "apps/api/src/app.ts",
    family: "manager_demo",
    owner: true,
    project: true,
    stepUp: false,
    idempotency: false
  },
  {
    method: "POST",
    path: "/api/v1/projects/:projectId/manager-demo-runs",
    file: "apps/api/src/app.ts",
    family: "manager_demo",
    owner: true,
    project: true,
    stepUp: false,
    idempotency: false
  },
  {
    method: "GET",
    path: "/api/v1/projects/:projectId/manager-demo-runs/:demoRunId",
    file: "apps/api/src/app.ts",
    family: "manager_demo",
    owner: true,
    project: true,
    stepUp: false,
    idempotency: false
  },
  {
    method: "POST",
    path: "/api/v1/projects/:projectId/manager-demo-runs/:demoRunId/execute",
    file: "apps/api/src/app.ts",
    family: "manager_demo",
    owner: true,
    project: true,
    stepUp: false,
    idempotency: false
  },
  {
    method: "POST",
    path: "/api/v1/projects/:projectId/manager-demo-runs/:demoRunId/cancel",
    file: "apps/api/src/app.ts",
    family: "manager_demo",
    owner: true,
    project: true,
    stepUp: false,
    idempotency: false
  },
  {
    method: "POST",
    path: "/api/v1/runs/:runId/cancel",
    file: "apps/api/src/app.ts",
    family: "project_model_runs",
    owner: true,
    project: false,
    stepUp: false,
    idempotency: false
  },
  {
    method: "GET",
    path: "/api/v1/runs/:runId/events",
    file: "apps/api/src/app.ts",
    family: "project_model_runs",
    owner: true,
    project: false,
    stepUp: false,
    idempotency: false
  },
  {
    method: "GET",
    path: "/api/v1/chats",
    file: "apps/api/src/general-chat-routes.ts",
    family: "general_chat",
    owner: true,
    project: false,
    stepUp: false,
    idempotency: false
  },
  {
    method: "POST",
    path: "/api/v1/chats",
    file: "apps/api/src/general-chat-routes.ts",
    family: "general_chat",
    owner: true,
    project: false,
    stepUp: false,
    idempotency: false
  },
  {
    method: "GET",
    path: "/api/v1/chats/:chatId",
    file: "apps/api/src/general-chat-routes.ts",
    family: "general_chat",
    owner: true,
    project: false,
    stepUp: false,
    idempotency: false
  },
  {
    method: "POST",
    path: "/api/v1/chats/:chatId/messages",
    file: "apps/api/src/general-chat-routes.ts",
    family: "general_chat",
    owner: true,
    project: false,
    stepUp: false,
    idempotency: false
  },
  {
    method: "POST",
    path: "/api/v1/chat-runs/:runId/cancel",
    file: "apps/api/src/general-chat-routes.ts",
    family: "general_chat",
    owner: true,
    project: false,
    stepUp: false,
    idempotency: false
  },
  {
    method: "GET",
    path: "/api/v1/chat-runs/:runId/events",
    file: "apps/api/src/general-chat-routes.ts",
    family: "general_chat",
    owner: true,
    project: false,
    stepUp: false,
    idempotency: false
  },
  {
    method: "GET",
    path: "/api/v1/projects/:projectId/work",
    file: "apps/api/src/manager-work-routes.ts",
    family: "manager_work",
    owner: true,
    project: true,
    stepUp: false,
    idempotency: false
  },
  {
    method: "POST",
    path: "/api/v1/projects/:projectId/work",
    file: "apps/api/src/manager-work-routes.ts",
    family: "manager_work",
    owner: true,
    project: true,
    stepUp: false,
    idempotency: false
  },
  {
    method: "GET",
    path: "/api/v1/projects/:projectId/work/:id",
    file: "apps/api/src/manager-work-routes.ts",
    family: "manager_work",
    owner: true,
    project: true,
    stepUp: false,
    idempotency: false
  },
  {
    method: "POST",
    path: "/api/v1/projects/:projectId/work/:id/control",
    file: "apps/api/src/manager-work-routes.ts",
    family: "manager_work",
    owner: true,
    project: true,
    stepUp: false,
    idempotency: false
  },
  {
    method: "GET",
    path: "/api/v1/projects/:projectId/work/:id/files/:name",
    file: "apps/api/src/manager-work-routes.ts",
    family: "manager_work",
    owner: true,
    project: true,
    stepUp: false,
    idempotency: false
  }
] as const;

const familyIds = {
  health: "entity-api-health",
  identity: "entity-api-identity",
  operations: "entity-api-emergency-stop",
  model_runtime: "entity-api-model-runtime",
  agent_studio: "entity-api-agent-studio",
  projects: "entity-api-projects",
  usage: "entity-api-project-usage",
  autonomy_policy: "entity-api-autonomy-policy",
  project_model_runs: "entity-api-project-model-runs",
  manager_demo: "entity-api-manager-demo",
  general_chat: "entity-api-general-chat",
  manager_work: "entity-api-manager-work"
} as const;

const safeId = (value: string): string =>
  value
    .toLowerCase()
    .replaceAll(":", "")
    .replaceAll("/", "-")
    .replaceAll(".", "-")
    .replaceAll("_", "-")
    .replaceAll("{", "")
    .replaceAll("}", "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

const routeId = (method: string, path: string): string =>
  `api-route-${method.toLowerCase()}-${safeId(path)}`;

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
  extractor_version: "api-boundary-v1",
  supersedes: null,
  deleted_at: null
});

const routeNodes = routes.map((route) =>
  node({
    id: routeId(route.method, route.path),
    location: `${route.file}:${route.method} ${route.path}`
  })
);

const newFamilyNodes = [
  node({ id: "entity-api-health", location: "apps/api/src/app.ts:/api/v1/health" }),
  node({
    id: "entity-api-agent-studio",
    location: "apps/api/src/app.ts:/api/v1/projects/:projectId/agent-studio"
  }),
  node({ id: "entity-api-projects", location: "apps/api/src/app.ts:/api/v1/projects" }),
  node({
    id: "entity-api-manager-demo",
    location: "apps/api/src/app.ts:/api/v1/projects/:projectId/manager-demo-runs"
  }),
  node({
    id: "entity-api-project-model-runs",
    location: "apps/api/src/app.ts:/api/v1/projects/:projectId/messages"
  })
] as const;

const boundaryNodes = [
  node({
    id: "entity-api-owner-boundary",
    location: "apps/api/src/app.ts:onRequest owner identity boundary"
  }),
  node({
    id: "entity-api-project-boundary",
    location: "apps/api/src/app.ts:isOwnedProject and project-scoped stores"
  }),
  node({
    id: "entity-api-step-up-boundary",
    location: "apps/api/src/app.ts:x-step-up-token consumers"
  }),
  node({
    id: "entity-api-idempotency-boundary",
    location: "apps/api/src/app.ts:AgentStudioIdempotencyHeadersSchema"
  }),
  node({
    id: "entity-api-public-health-boundary",
    location: "apps/api/src/app.ts:onRequest health exception"
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
  extractor_version: "api-boundary-v1",
  supersedes: null,
  deleted_at: null
});

const appFile = repositoryStructureFileId("apps/api/src/app.ts");
const managerRoutesFile = repositoryStructureFileId("apps/api/src/manager-work-routes.ts");

const routeEdges: IntelligenceGraphEdge[] = routes.flatMap((route) => {
  const id = routeId(route.method, route.path);
  const sourceFile = repositoryStructureFileId(route.file);
  const edges = [
    edge({
      id: `${id}-family`,
      type: "ROUTE_OF",
      from: id,
      to: familyIds[route.family],
      location: `${route.file}:${route.method} ${route.path}`
    }),
    edge({
      id: `${id}-source`,
      type: "EXPOSED_BY_FILE",
      from: id,
      to: sourceFile,
      location: `${route.file}:${route.method} ${route.path}`
    })
  ];

  if (route.owner) {
    edges.push(
      edge({
        id: `${id}-owner-boundary`,
        type: "GATED_BY",
        from: id,
        to: "entity-api-owner-boundary",
        location: "apps/api/src/app.ts:onRequest"
      })
    );
  } else {
    edges.push(
      edge({
        id: `${id}-public-boundary`,
        type: "GATED_BY",
        from: id,
        to: "entity-api-public-health-boundary",
        location: "apps/api/src/app.ts:onRequest health exception"
      })
    );
  }

  if (route.project) {
    edges.push(
      edge({
        id: `${id}-project-boundary`,
        type: "GATED_BY",
        from: id,
        to: "entity-api-project-boundary",
        location: `${route.file}:${route.path}:projectId`
      })
    );
  }
  if (route.stepUp) {
    edges.push(
      edge({
        id: `${id}-step-up-boundary`,
        type: "GATED_BY",
        from: id,
        to: "entity-api-step-up-boundary",
        location: `${route.file}:${route.path}:step-up`
      })
    );
  }
  if (route.idempotency) {
    edges.push(
      edge({
        id: `${id}-idempotency-boundary`,
        type: "GATED_BY",
        from: id,
        to: "entity-api-idempotency-boundary",
        location: "apps/api/src/app.ts:AgentStudioIdempotencyHeadersSchema"
      })
    );
  }
  return edges;
});

const boundaryEdges: IntelligenceGraphEdge[] = [
  edge({
    id: "api-boundary-owner-file",
    type: "IMPLEMENTED_IN_FILE",
    from: "entity-api-owner-boundary",
    to: appFile,
    location: "apps/api/src/app.ts:onRequest"
  }),
  edge({
    id: "api-boundary-owner-enforces",
    type: "ENFORCES",
    from: "entity-api-owner-boundary",
    to: "claim-owner-api-requires-owner-session",
    location: "apps/api/src/app.ts:canAccessOwnerApi"
  }),
  edge({
    id: "api-boundary-owner-test",
    type: "VERIFIED_BY_TEST",
    from: "entity-api-owner-boundary",
    to: repositoryStructureFileId("apps/api/test/identity-boundary.test.ts"),
    location: "apps/api/test/identity-boundary.test.ts"
  }),

  edge({
    id: "api-boundary-project-app",
    type: "IMPLEMENTED_IN_FILE",
    from: "entity-api-project-boundary",
    to: appFile,
    location: "apps/api/src/app.ts:isOwnedProject"
  }),
  edge({
    id: "api-boundary-project-manager",
    type: "IMPLEMENTED_IN_FILE",
    from: "entity-api-project-boundary",
    to: managerRoutesFile,
    location: "apps/api/src/manager-work-routes.ts:owned"
  }),
  edge({
    id: "api-boundary-project-enforces",
    type: "ENFORCES",
    from: "entity-api-project-boundary",
    to: "claim-runtime-project-bound",
    location: "apps/api/src/app.ts:project owner filters"
  }),
  ...[
    "apps/api/test/identity-boundary.test.ts",
    "apps/api/test/agent-studio-read-api.test.ts",
    "apps/api/test/agent-studio-write-api.test.ts",
    "apps/api/test/projects.test.ts",
    "apps/api/test/usage.test.ts",
    "apps/api/test/policy.test.ts",
    "apps/api/test/manager-work.test.ts"
  ].map((testPath, index) =>
    edge({
      id: `api-boundary-project-test-${index + 1}`,
      type: "VERIFIED_BY_TEST",
      from: "entity-api-project-boundary",
      to: repositoryStructureFileId(testPath),
      location: testPath
    })
  ),

  edge({
    id: "api-boundary-step-up-requires",
    type: "REQUIRES",
    from: "entity-api-step-up-boundary",
    to: "entity-step-up-proof",
    location: "apps/api/src/app.ts:x-step-up-token"
  }),
  edge({
    id: "api-boundary-step-up-emergency-test",
    type: "VERIFIED_BY_TEST",
    from: "entity-api-step-up-boundary",
    to: repositoryStructureFileId("apps/api/test/emergency-stop-clearance.test.ts"),
    location: "apps/api/test/emergency-stop-clearance.test.ts"
  }),
  edge({
    id: "api-boundary-step-up-usage-test",
    type: "VERIFIED_BY_TEST",
    from: "entity-api-step-up-boundary",
    to: repositoryStructureFileId("apps/api/test/usage.test.ts"),
    location: "apps/api/test/usage.test.ts"
  }),
  edge({
    id: "api-boundary-step-up-policy-test",
    type: "VERIFIED_BY_TEST",
    from: "entity-api-step-up-boundary",
    to: repositoryStructureFileId("apps/api/test/policy.test.ts"),
    location: "apps/api/test/policy.test.ts"
  }),

  edge({
    id: "api-boundary-idempotency-file",
    type: "IMPLEMENTED_IN_FILE",
    from: "entity-api-idempotency-boundary",
    to: appFile,
    location: "apps/api/src/app.ts:AgentStudioIdempotencyHeadersSchema"
  }),
  edge({
    id: "api-boundary-idempotency-test",
    type: "VERIFIED_BY_TEST",
    from: "entity-api-idempotency-boundary",
    to: repositoryStructureFileId("apps/api/test/agent-studio-write-api.test.ts"),
    location: "apps/api/test/agent-studio-write-api.test.ts"
  }),

  edge({
    id: "api-boundary-health-file",
    type: "IMPLEMENTED_IN_FILE",
    from: "entity-api-public-health-boundary",
    to: appFile,
    location: "apps/api/src/app.ts:onRequest health exception"
  }),
  edge({
    id: "api-boundary-health-test",
    type: "VERIFIED_BY_TEST",
    from: "entity-api-public-health-boundary",
    to: repositoryStructureFileId("apps/api/test/health.test.ts"),
    location: "apps/api/test/health.test.ts"
  }),
  edge({
    id: "api-boundary-health-identity-test",
    type: "VERIFIED_BY_TEST",
    from: "entity-api-public-health-boundary",
    to: repositoryStructureFileId("apps/api/test/identity-boundary.test.ts"),
    location: "apps/api/test/identity-boundary.test.ts"
  })
];

const familyEdges: IntelligenceGraphEdge[] = [
  edge({
    id: "api-family-health-file",
    type: "EXPOSED_BY_FILE",
    from: "entity-api-health",
    to: appFile,
    location: "apps/api/src/app.ts:/api/v1/health"
  }),
  edge({
    id: "api-family-health-test",
    type: "VERIFIED_BY_TEST",
    from: "entity-api-health",
    to: repositoryStructureFileId("apps/api/test/health.test.ts"),
    location: "apps/api/test/health.test.ts"
  }),

  edge({
    id: "api-family-agent-studio-file",
    type: "EXPOSED_BY_FILE",
    from: "entity-api-agent-studio",
    to: appFile,
    location: "apps/api/src/app.ts:agent-studio"
  }),
  edge({
    id: "api-family-agent-studio-blueprint",
    type: "MANAGES",
    from: "entity-api-agent-studio",
    to: "entity-agent-blueprint",
    location: "apps/api/src/app.ts:blueprints"
  }),
  edge({
    id: "api-family-agent-studio-instance",
    type: "MANAGES",
    from: "entity-api-agent-studio",
    to: "entity-agent-instance",
    location: "apps/api/src/app.ts:proposals"
  }),
  edge({
    id: "api-family-agent-studio-read-test",
    type: "VERIFIED_BY_TEST",
    from: "entity-api-agent-studio",
    to: repositoryStructureFileId("apps/api/test/agent-studio-read-api.test.ts"),
    location: "apps/api/test/agent-studio-read-api.test.ts"
  }),
  edge({
    id: "api-family-agent-studio-write-test",
    type: "VERIFIED_BY_TEST",
    from: "entity-api-agent-studio",
    to: repositoryStructureFileId("apps/api/test/agent-studio-write-api.test.ts"),
    location: "apps/api/test/agent-studio-write-api.test.ts"
  }),

  edge({
    id: "api-family-projects-file",
    type: "EXPOSED_BY_FILE",
    from: "entity-api-projects",
    to: appFile,
    location: "apps/api/src/app.ts:/api/v1/projects"
  }),
  edge({
    id: "api-family-projects-test",
    type: "VERIFIED_BY_TEST",
    from: "entity-api-projects",
    to: repositoryStructureFileId("apps/api/test/projects.test.ts"),
    location: "apps/api/test/projects.test.ts"
  }),

  edge({
    id: "api-family-manager-demo-file",
    type: "EXPOSED_BY_FILE",
    from: "entity-api-manager-demo",
    to: appFile,
    location: "apps/api/src/app.ts:manager-demo-runs"
  }),
  edge({
    id: "api-family-manager-demo-test",
    type: "VERIFIED_BY_TEST",
    from: "entity-api-manager-demo",
    to: repositoryStructureFileId("apps/api/test/demo-manager-api.test.ts"),
    location: "apps/api/test/demo-manager-api.test.ts"
  }),
  edge({
    id: "api-family-manager-demo-checkpoint",
    type: "PRODUCES",
    from: "entity-api-manager-demo",
    to: "entity-runtime-checkpoint",
    location: "apps/api/test/demo-manager-api.test.ts:checkpoint"
  }),

  edge({
    id: "api-family-project-runs-file",
    type: "EXPOSED_BY_FILE",
    from: "entity-api-project-model-runs",
    to: appFile,
    location: "apps/api/src/app.ts:projects/:projectId/messages"
  }),
  edge({
    id: "api-family-project-runs-gateway",
    type: "DISPATCHES_TO",
    from: "entity-api-project-model-runs",
    to: "entity-model-gateway",
    location: "apps/api/src/app.ts:modelGateway.stream"
  }),
  edge({
    id: "api-family-project-runs-test",
    type: "VERIFIED_BY_TEST",
    from: "entity-api-project-model-runs",
    to: repositoryStructureFileId("apps/api/test/projects.test.ts"),
    location: "apps/api/test/projects.test.ts"
  })
];

const nodes = [...routeNodes, ...newFamilyNodes, ...boundaryNodes];
const edges = [...routeEdges, ...boundaryEdges, ...familyEdges];

const records: IntelligenceGraphSearchRecord[] = [
  ...routeNodes.map((routeNode, index) => ({
    node: { id: routeNode.node_id, version: 1 },
    text: `${routes[index]!.method} ${routes[index]!.path} ${routes[index]!.family} API route`,
    excerpt: routeNode.source_ref.location,
    estimated_tokens: 12
  })),
  ...newFamilyNodes.map((item) => ({
    node: { id: item.node_id, version: 1 },
    text: item.node_id.replaceAll("-", " "),
    excerpt: item.source_ref.location,
    estimated_tokens: 12
  })),
  ...boundaryNodes.map((item) => ({
    node: { id: item.node_id, version: 1 },
    text: item.node_id.replaceAll("-", " "),
    excerpt: item.source_ref.location,
    estimated_tokens: 14
  }))
];

export const cosmoraApiBoundaryGraph = () => ({ nodes, edges, records });

export const COSMORA_API_BOUNDARY_ROUTE_COUNT = routes.length;
export const COSMORA_API_BOUNDARY_NODE_COUNT = nodes.length;
export const COSMORA_API_BOUNDARY_EDGE_COUNT = edges.length;
