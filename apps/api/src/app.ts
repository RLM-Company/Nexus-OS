import { TypeBoxValidatorCompiler, type TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import type { ServerConfig } from "@cosmora/config";
import { composeDemoManagerPlan, type ChatService, type ManagerService } from "@cosmora/core";
import {
  AgentBlueprintListResponseSchema,
  AgentBlueprintSchema,
  AgentFunctionListResponseSchema,
  AgentFunctionDefinitionSchema,
  AgentInstanceListResponseSchema,
  AgentInstanceSchema,
  AgentStudioDecisionEventListResponseSchema,
  ApiErrorSchema,
  ActivateEmergencyStopRequestSchema,
  AUTONOMY_MATRIX,
  BehaviorPatternListResponseSchema,
  BehaviorPatternSchema,
  ClearEmergencyStopRequestSchema,
  CapabilityProfilePreviewResponseSchema,
  CapabilityProfileResponseSchema,
  ConfirmationDecisionRequestSchema,
  ConfirmationListResponseSchema,
  ConfirmationRequestSchema,
  CreateMessageRequestSchema,
  CreateDemoManagerRunRequestSchema,
  CreateAgentBlueprintRequestSchema,
  CreateAgentBlueprintVersionRequestSchema,
  CreateAgentFunctionRequestSchema,
  CreateAgentFunctionVersionRequestSchema,
  CreateBehaviorPatternRequestSchema,
  CreateBehaviorPatternVersionRequestSchema,
  CreateProjectRequestSchema,
  EmergencyStopClearanceEventSchema,
  EmergencyStopClearanceListResponseSchema,
  EmergencyStopStateSchema,
  HealthResponseSchema,
  IdentityAuditListResponseSchema,
  MessageAcceptedResponseSchema,
  ModelRuntimeStatusSchema,
  OwnerSessionListResponseSchema,
  OwnerSessionViewSchema,
  ProjectDetailResponseSchema,
  DemoManagerRunListResponseSchema,
  DemoManagerRunSchema,
  ProjectListResponseSchema,
  ProjectUsageLimitPreviewResponseSchema,
  ProjectUsageLimitResponseSchema,
  ProjectUsageSummarySchema,
  PolicyDecisionTraceListResponseSchema,
  PolicyRecoveryRequiredListResponseSchema,
  ProposeDelegatedAgentRequestSchema,
  ProposeRootAgentRequestSchema,
  PERMISSION_MODE_RANK,
  RevokeSessionRequestSchema,
  RunCancelResponseSchema,
  RuntimeOperationsStatusSchema,
  UpdateCapabilityProfileRequestSchema,
  UpdateProjectUsageLimitRequestSchema,
  createCapabilityProfile,
  hasUniqueCapabilityOverrideIds,
  requiresStepUp,
  type ApiError,
  type AgentBlueprintListResponse,
  type AgentFunctionListResponse,
  type AgentInstanceListResponse,
  type AgentStudioDecisionEventListResponse,
  type BehaviorPatternListResponse,
  type CapabilityId,
  type CapabilityProfilePreviewResponse,
  type CapabilityProfileResponse,
  type ConfirmationListResponse,
  type EmergencyStopClearanceEvent,
  type EmergencyStopClearanceListResponse,
  type EmergencyStopState,
  type HealthResponse,
  type IdentityAuditListResponse,
  type IdentityContext,
  type IdentitySession,
  type MessageAcceptedResponse,
  type DemoManagerArtifact,
  type DemoManagerRun,
  type DemoManagerRunListResponse,
  type ModelRuntimeStatus,
  type OwnerSessionListResponse,
  type OwnerSessionView,
  type ProjectDetailResponse,
  type ProjectListResponse,
  type ProjectUsageLimit,
  type ProjectUsageLimitPreviewResponse,
  type ProjectUsageLimitResponse,
  type ProjectUsageSummary,
  type PolicyDecisionTraceListResponse,
  type PolicyRecoveryRequiredListResponse,
  type RunCancelResponse,
  type RuntimeOperationsStatus,
  type StreamEvent
} from "@cosmora/contracts";
import {
  AgentBlueprintConflictError,
  AgentBlueprintNotFoundError,
  AgentBlueprintValidationError,
  type AgentBlueprintStore,
  AgentInstanceDelegationError,
  AgentInstanceNotFoundError,
  AgentInstanceValidationError,
  type AgentInstanceStore,
  AgentStudioIdempotencyConflictError,
  type AgentStudioMutationStore,
  AgentStudioMutationValidationError,
  DemoManagerStoreValidationError,
  IdempotencyConflictError,
  PatternLibraryConflictError,
  PatternLibraryNotFoundError,
  PatternLibraryValidationError,
  ProjectUsageLimitExceededError,
  UsageLimitConflictError,
  type DatabaseHealth,
  type DemoManagerStore,
  type EmergencyStopStore,
  type GeneralChatStore,
  type IdentityStore,
  type PolicyStore,
  type PatternLibraryStore,
  type ProjectStore,
  type StoredMessage,
  type StoredDemoManagerRun,
  type StoredRun,
  type UsageStore
} from "@cosmora/db";
import {
  GatewayRunError,
  type ModelGateway,
  type ModelGatewayStreamEvent
} from "@cosmora/model-gateway";
import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { Type } from "typebox";
import {
  canAccessOwnerApi,
  LOCAL_DEVELOPMENT_IDENTITY,
  StaticIdentityResolver,
  type RequestIdentityResolver,
  type StepUpProofConsumer
} from "./identity.js";
import { EmergencyStopActivatedError, RuntimeMetrics } from "./operations.js";
import type { DemoManagerCoordinator } from "./demo-manager-coordinator.js";
import type { ManagerWorkStore } from "@cosmora/db";
import type { ManagerWorkCoordinator } from "./manager-work-coordinator.js";
import { registerManagerWorkRoutes } from "./manager-work-routes.js";
import {
  autonomyProfileStepUpChallenge,
  projectUsageLimitStepUpChallenge
} from "./step-up-challenge.js";
import { registerGeneralChatRoutes, type ActiveModelRun } from "./general-chat-routes.js";
import type { GitHubReadonlyService } from "./github-readonly.js";
import { registerGitHubReadonlyRoutes } from "./github-readonly-routes.js";

export interface AppDependencies {
  config: ServerConfig;
  database: DatabaseHealth;
  identityStore?: IdentityStore;
  generalChatStore?: GeneralChatStore;
  projectStore?: ProjectStore;
  demoManagerStore?: DemoManagerStore;
  demoManagerCoordinator?: DemoManagerCoordinator;
  managerWorkStore?: ManagerWorkStore;
  managerWorkCoordinator?: ManagerWorkCoordinator;
  usageStore?: UsageStore;
  emergencyStopStore?: EmergencyStopStore;
  policyStore?: PolicyStore;
  patternLibraryStore?: PatternLibraryStore;
  agentBlueprintStore?: AgentBlueprintStore;
  agentInstanceStore?: AgentInstanceStore;
  agentStudioMutationStore?: AgentStudioMutationStore;
  modelGateway?: ModelGateway;
  chat?: ChatService;
  manager?: ManagerService;
  modelRegistryVersion?: string;
  identityResolver?: RequestIdentityResolver;
  stepUpProofConsumer?: StepUpProofConsumer;
  closeDatabase?: () => void;
  runtimeMetrics?: RuntimeMetrics;
  managerRunExecutionMode?: "stream" | "background";
  generalChatRunExecutionMode?: "stream" | "background";
  githubReadonly?: GitHubReadonlyService;
  now?: () => string;
}

const stepUpToken = (value: string | string[] | undefined): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

const emergencyStopClearanceChallenge = (
  scope: "process" | "project",
  projectId: string | null,
  activatedAt: string
): string =>
  `emergency-stop-clearance:${JSON.stringify({
    scope,
    project_id: projectId,
    activated_at: activatedAt
  })}`;

const profileUpdateRequiresStepUp = (
  baseLevel: keyof (typeof AUTONOMY_MATRIX)[CapabilityId],
  overrides: Array<{ capability_id: CapabilityId; mode: keyof typeof PERMISSION_MODE_RANK }>
): boolean =>
  baseLevel === "A6" ||
  overrides.some(
    (override) =>
      override.mode === "FULL" ||
      (requiresStepUp([override.capability_id]) &&
        PERMISSION_MODE_RANK[override.mode] >
          PERMISSION_MODE_RANK[AUTONOMY_MATRIX[override.capability_id][baseLevel]])
  );

const usageLimitUpdateRequiresStepUp = (
  current: ProjectUsageLimit,
  next: {
    max_total_tokens: number | null;
    max_cost: { amount: number; currency: "USD" | "RUB" } | null;
  }
): boolean => {
  const expandsTokens =
    current.max_total_tokens !== null &&
    (next.max_total_tokens === null || next.max_total_tokens > current.max_total_tokens);
  const expandsCost =
    current.max_cost !== null &&
    (next.max_cost === null ||
      next.max_cost.currency !== current.max_cost.currency ||
      next.max_cost.amount > current.max_cost.amount);
  return expandsTokens || expandsCost;
};

const errorBody = (
  requestId: string,
  code: ApiError["error"]["code"],
  message: string,
  retryable = false
): ApiError => ({ error: { code, message, request_id: requestId, retryable } });

const AgentStudioProjectParamsSchema = Type.Object(
  { projectId: Type.String({ minLength: 1 }) },
  { additionalProperties: false }
);

const AgentStudioPatternQuerySchema = Type.Object(
  { include_archived: Type.Optional(Type.Boolean({ default: false })) },
  { additionalProperties: false }
);

const AgentStudioDecisionEventQuerySchema = Type.Object(
  { limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 50 })) },
  { additionalProperties: false }
);

const PolicyDecisionTraceQuerySchema = Type.Object(
  { limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 50 })) },
  { additionalProperties: false }
);

const PolicyRecoveryRequiredQuerySchema = Type.Object(
  { limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 50 })) },
  { additionalProperties: false }
);

const AgentStudioCreateHeadersSchema = Type.Object(
  { "idempotency-key": Type.String({ minLength: 1, maxLength: 256 }) },
  { additionalProperties: true }
);

const AgentStudioFunctionParamsSchema = Type.Object(
  {
    projectId: Type.String({ minLength: 1 }),
    functionId: Type.String({ minLength: 1 })
  },
  { additionalProperties: false }
);

const AgentStudioPatternParamsSchema = Type.Object(
  {
    projectId: Type.String({ minLength: 1 }),
    patternId: Type.String({ minLength: 1 })
  },
  { additionalProperties: false }
);

const AgentStudioBlueprintParamsSchema = Type.Object(
  {
    projectId: Type.String({ minLength: 1 }),
    blueprintId: Type.String({ minLength: 1 })
  },
  { additionalProperties: false }
);

const sendAgentStudioMutationError = (
  error: unknown,
  request: FastifyRequest,
  reply: FastifyReply
): FastifyReply => {
  if (
    error instanceof PatternLibraryNotFoundError ||
    error instanceof AgentBlueprintNotFoundError ||
    error instanceof AgentInstanceNotFoundError
  ) {
    return reply
      .status(404)
      .send(
        errorBody(request.id, "AGENT_STUDIO_OBJECT_NOT_FOUND", "Agent Studio object not found")
      );
  }
  if (error instanceof AgentStudioIdempotencyConflictError) {
    return reply
      .status(409)
      .send(
        errorBody(
          request.id,
          "IDEMPOTENCY_CONFLICT",
          "Idempotency key was already used for another Agent Studio create request"
        )
      );
  }
  if (error instanceof AgentInstanceDelegationError) {
    return reply
      .status(403)
      .send(
        errorBody(
          request.id,
          "POLICY_DENIED",
          "Delegated agent proposal is outside the parent grant"
        )
      );
  }
  if (
    error instanceof PatternLibraryConflictError ||
    error instanceof AgentBlueprintConflictError
  ) {
    return reply
      .status(409)
      .send(errorBody(request.id, "CONFLICT", "Agent Studio object changed; refresh and retry"));
  }
  if (
    error instanceof PatternLibraryValidationError ||
    error instanceof AgentBlueprintValidationError ||
    error instanceof AgentInstanceValidationError ||
    error instanceof AgentStudioMutationValidationError
  ) {
    return reply
      .status(400)
      .send(errorBody(request.id, "VALIDATION_ERROR", "Agent Studio request is invalid"));
  }
  throw error;
};

const acceptedResponse = (
  accepted: NonNullable<ReturnType<ProjectStore["createMessage"]>>
): MessageAcceptedResponse => ({
  project: accepted.project,
  chat_id: accepted.chatId,
  user_message: accepted.userMessage,
  run_id: accepted.run.id,
  stream_url: `/api/v1/runs/${accepted.run.id}/events`
});

const demoManagerResponse = (
  run: StoredDemoManagerRun,
  store: DemoManagerStore
): DemoManagerRun => ({
  demo_run_id: run.demo_run_id,
  project_id: run.project_id,
  source_run_id: run.source_run_id,
  owner_goal: run.owner_goal,
  graph: run.graph,
  status: run.status,
  checkpoint: run.checkpoint,
  error_code: run.error_code,
  created_at: run.created_at,
  updated_at: run.updated_at,
  artifacts: store
    .listArtifacts(run.demo_run_id, run.owner_id)
    .map((artifact): DemoManagerArtifact => ({
      artifact_id: artifact.artifact_id,
      demo_run_id: artifact.demo_run_id,
      project_id: artifact.project_id,
      task_id: artifact.task_id,
      kind: artifact.kind,
      content: artifact.content,
      created_at: artifact.created_at
    }))
});

const sendEvent = (reply: FastifyReply, event: StreamEvent): void => {
  if (reply.raw.destroyed || reply.raw.writableEnded) return;
  reply.raw.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
};

const endEventStream = (reply: FastifyReply): void => {
  if (!reply.raw.destroyed && !reply.raw.writableEnded) reply.raw.end();
};

const completedReplay = (
  reply: FastifyReply,
  runId: string,
  message: StoredMessage,
  provider: string,
  model: string
): void => {
  const timestamp = new Date().toISOString();
  sendEvent(reply, { type: "run.started", data: { run_id: runId, timestamp } });
  sendEvent(reply, { type: "message.started", data: { run_id: runId, message_id: message.id } });
  if (message.content) {
    sendEvent(reply, {
      type: "message.delta",
      data: { run_id: runId, message_id: message.id, seq: 0, delta: message.content }
    });
  }
  sendEvent(reply, {
    type: "message.completed",
    data: {
      run_id: runId,
      message_id: message.id,
      size: message.content.length,
      finish_reason: "replayed"
    }
  });
  sendEvent(reply, {
    type: "run.completed",
    data: { run_id: runId, provider, model_resolved: model }
  });
};

const waitForObserverPoll = async (signal: AbortSignal): Promise<void> => {
  if (signal.aborted) return;
  await new Promise<void>((resolve) => {
    const done = (): void => {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, 50);
    timer.unref?.();
    signal.addEventListener("abort", done, { once: true });
  });
};

const observePersistedRun = async (
  reply: FastifyReply,
  store: ProjectStore,
  initialRun: StoredRun,
  ownerId: string,
  signal: AbortSignal
): Promise<void> => {
  let observedMessageId: string | null = null;
  let sentLength = 0;
  let sequence = 0;

  const observeMessage = (run: StoredRun, message: StoredMessage): void => {
    if (observedMessageId !== message.id) {
      observedMessageId = message.id;
      sentLength = 0;
      sequence = 0;
      sendEvent(reply, {
        type: "run.started",
        data: { run_id: run.id, timestamp: run.updated_at }
      });
      sendEvent(reply, {
        type: "message.started",
        data: { run_id: run.id, message_id: message.id }
      });
    }
    if (message.content.length > sentLength) {
      sendEvent(reply, {
        type: "message.delta",
        data: {
          run_id: run.id,
          message_id: message.id,
          seq: sequence++,
          delta: message.content.slice(sentLength)
        }
      });
      sentLength = message.content.length;
    }
  };

  while (!signal.aborted && !reply.raw.destroyed && !reply.raw.writableEnded) {
    const run = store.getRun(initialRun.id, ownerId);
    if (!run) break;
    const message = store.getAssistantMessage(run.id, ownerId);

    if (run.status === "cancelled") {
      sendEvent(reply, { type: "run.cancelled", data: { run_id: run.id } });
      break;
    }
    if (run.status === "failed") {
      sendEvent(reply, {
        type: "run.failed",
        data: {
          run_id: run.id,
          error_code: message?.error_code ?? "INTERRUPTED",
          retryable: false
        }
      });
      break;
    }
    if (run.status === "succeeded" && message) {
      if (observedMessageId === null) {
        completedReplay(
          reply,
          run.id,
          message,
          run.provider ?? "unknown",
          run.model_resolved ?? "unknown"
        );
      } else {
        observeMessage(run, message);
        sendEvent(reply, {
          type: "message.completed",
          data: {
            run_id: run.id,
            message_id: message.id,
            size: message.content.length,
            finish_reason: "observed"
          }
        });
        sendEvent(reply, {
          type: "run.completed",
          data: {
            run_id: run.id,
            provider: run.provider ?? "unknown",
            model_resolved: run.model_resolved ?? "unknown"
          }
        });
      }
      break;
    }
    if (run.status === "running" && message) observeMessage(run, message);

    await waitForObserverPoll(signal);
  }
};

export const buildApp = (dependencies: AppDependencies): FastifyInstance => {
  const now = dependencies.now ?? (() => new Date().toISOString());
  const identityResolver =
    dependencies.identityResolver ??
    (dependencies.config.nodeEnv === "production"
      ? null
      : new StaticIdentityResolver(LOCAL_DEVELOPMENT_IDENTITY));
  if (!identityResolver) {
    throw new Error("Production requires an explicit verified identity resolver");
  }

  const app = Fastify({
    logger:
      dependencies.config.nodeEnv === "test"
        ? false
        : {
            level: dependencies.config.logLevel,
            redact: [
              "req.headers.authorization",
              "req.headers.cookie",
              "req.headers.x-step-up-token"
            ]
          }
  }).withTypeProvider<TypeBoxTypeProvider>();

  const activeRuns = new Map<string, ActiveModelRun>();
  const runObservers = new Set<AbortController>();
  const managerRunsExecuteInBackground = dependencies.managerRunExecutionMode === "background";
  const runtimeMetrics = dependencies.runtimeMetrics ?? new RuntimeMetrics();
  const requestIdentities = new WeakMap<FastifyRequest, IdentityContext>();
  const identityFor = (request: FastifyRequest): IdentityContext => {
    const identity = requestIdentities.get(request);
    if (!identity) throw new Error("Authenticated request is missing its identity context");
    return identity;
  };

  app.addHook("onRequest", async (request, reply) => {
    if (request.url.split("?", 1)[0] === "/api/v1/health") return;
    let identity: IdentityContext | null = null;
    try {
      identity = await identityResolver.resolve(request);
    } catch {
      app.log.warn({ requestId: request.id }, "Identity resolution failed closed");
    }
    if (!identity) {
      return reply
        .status(401)
        .send(errorBody(request.id, "UNAUTHORIZED", "Verified identity is required"));
    }
    if (!canAccessOwnerApi(identity)) {
      app.log.warn(
        {
          requestId: request.id,
          actorId: identity.actor_id,
          actorKind: identity.actor_kind
        },
        "Non-owner actor denied at owner API boundary"
      );
      return reply
        .status(403)
        .send(errorBody(request.id, "FORBIDDEN", "Owner authority is required"));
    }
    requestIdentities.set(request, identity);
  });

  app.get(
    "/api/v1/health",
    { schema: { response: { 200: HealthResponseSchema, 503: HealthResponseSchema } } },
    async (_request, reply) => {
      let database: HealthResponse["database"] = "ok";
      try {
        dependencies.database.ping();
      } catch {
        database = "error";
      }
      const response: HealthResponse = {
        status: database === "ok" ? "ok" : "degraded",
        version: "0.1.0",
        database,
        timestamp: new Date().toISOString()
      };
      return reply.status(database === "ok" ? 200 : 503).send(response);
    }
  );

  if (dependencies.githubReadonly) {
    registerGitHubReadonlyRoutes(app, dependencies.githubReadonly);
  }

  if (dependencies.identityStore) {
    const identityStore = dependencies.identityStore;
    const sessionView = (session: IdentitySession, currentSessionId: string): OwnerSessionView => {
      const actor = identityStore.getActor(session.actor_id, session.owner_id);
      if (!actor) throw new Error("Identity session references a missing actor");
      return {
        ...session,
        actor_kind: actor.kind,
        current: session.session_id === currentSessionId
      };
    };

    app.get(
      "/api/v1/identity/sessions",
      { schema: { response: { 200: OwnerSessionListResponseSchema } } },
      (request) => {
        const identity = identityFor(request);
        const response: OwnerSessionListResponse = {
          items: identityStore
            .listSessions(identity.owner_id)
            .map((session) => sessionView(session, identity.session_id))
        };
        return response;
      }
    );

    app.get(
      "/api/v1/identity/audit-events",
      {
        schema: {
          querystring: {
            type: "object",
            properties: {
              limit: { type: "integer", minimum: 1, maximum: 100, default: 50 }
            },
            additionalProperties: false
          },
          response: { 200: IdentityAuditListResponseSchema, 400: ApiErrorSchema }
        }
      },
      (request) => {
        const limit = request.query.limit ?? 50;
        const response: IdentityAuditListResponse = {
          items: identityStore.listRecentAuditEvents(identityFor(request).owner_id, limit),
          limit
        };
        return response;
      }
    );

    app.post(
      "/api/v1/identity/sessions/:sessionId/revoke",
      {
        schema: {
          params: {
            type: "object",
            properties: { sessionId: { type: "string", minLength: 1 } },
            required: ["sessionId"],
            additionalProperties: false
          },
          body: RevokeSessionRequestSchema,
          response: { 200: OwnerSessionViewSchema, 404: ApiErrorSchema }
        }
      },
      async (request, reply) => {
        const identity = identityFor(request);
        const existing = identityStore
          .listSessions(identity.owner_id)
          .find((session) => session.session_id === request.params.sessionId);
        if (!existing) {
          return reply
            .status(404)
            .send(
              errorBody(request.id, "IDENTITY_SESSION_NOT_FOUND", "Identity session not found")
            );
        }
        if (existing.status === "active") {
          identityStore.revokeSession(
            existing.session_id,
            identity.owner_id,
            identity.actor_id,
            request.body.reason
          );
        }
        const updated = identityStore.getSession(existing.session_id, identity.owner_id);
        if (!updated) {
          return reply
            .status(404)
            .send(
              errorBody(request.id, "IDENTITY_SESSION_NOT_FOUND", "Identity session not found")
            );
        }
        return sessionView(updated, identity.session_id);
      }
    );
  }

  if (dependencies.emergencyStopStore) {
    const stopStore = dependencies.emergencyStopStore;

    app.get(
      "/api/v1/operations/status",
      { schema: { response: { 200: RuntimeOperationsStatusSchema } } },
      (request) => {
        const identity = identityFor(request);
        const response: RuntimeOperationsStatus = runtimeMetrics.snapshot(
          stopStore,
          [...activeRuns.values()].filter((active) => active.ownerId === identity.owner_id).length,
          identity.owner_id
        );
        return response;
      }
    );

    app.get(
      "/api/v1/operations/emergency-stop",
      {
        schema: {
          querystring: Type.Object(
            { project_id: Type.String({ minLength: 1 }) },
            { additionalProperties: false }
          ),
          response: { 200: Type.Union([EmergencyStopStateSchema, Type.Null()]) }
        }
      },
      (request) => stopStore.getProjectStop(request.query.project_id, identityFor(request).owner_id)
    );

    app.post(
      "/api/v1/operations/emergency-stop",
      {
        schema: {
          body: ActivateEmergencyStopRequestSchema,
          response: { 200: EmergencyStopStateSchema, 400: ApiErrorSchema, 404: ApiErrorSchema }
        }
      },
      async (request, reply) => {
        if (
          (request.body.scope === "project" && !request.body.project_id) ||
          (request.body.scope === "process" && request.body.project_id !== undefined)
        ) {
          return reply
            .status(400)
            .send(errorBody(request.id, "VALIDATION_ERROR", "Request validation failed"));
        }
        const identity = identityFor(request);
        const state =
          request.body.scope === "process"
            ? stopStore.activateProcess(request.body.reason, identity.actor_id)
            : stopStore.activateProject(
                request.body.project_id as string,
                request.body.reason,
                identity.actor_id,
                identity.owner_id
              );
        if (!state) {
          return reply
            .status(404)
            .send(errorBody(request.id, "PROJECT_NOT_FOUND", "Project not found"));
        }

        let interruptedRuns = 0;
        for (const active of activeRuns.values()) {
          if (state.scope === "process" || active.projectId === state.project_id) {
            active.controller.abort(new EmergencyStopActivatedError());
            interruptedRuns += 1;
          }
        }
        app.log.error(
          {
            scope: state.scope,
            projectId: state.project_id,
            interruptedRuns,
            activatedBy: state.activated_by
          },
          "Emergency stop activated"
        );
        const response: EmergencyStopState = state;
        return response;
      }
    );

    app.get(
      "/api/v1/operations/emergency-stop/clearance-events",
      {
        schema: {
          querystring: Type.Object(
            {
              limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 50 }))
            },
            { additionalProperties: false }
          ),
          response: { 200: EmergencyStopClearanceListResponseSchema }
        }
      },
      (request) => {
        const identity = identityFor(request);
        const limit = request.query.limit ?? 50;
        const response: EmergencyStopClearanceListResponse = {
          items: stopStore.listRecentClearances(identity.owner_id, limit),
          limit
        };
        return response;
      }
    );

    app.post(
      "/api/v1/operations/emergency-stop/clearance",
      {
        validatorCompiler: TypeBoxValidatorCompiler,
        schema: {
          body: ClearEmergencyStopRequestSchema,
          response: {
            200: EmergencyStopClearanceEventSchema,
            400: ApiErrorSchema,
            403: ApiErrorSchema,
            404: ApiErrorSchema,
            409: ApiErrorSchema
          }
        }
      },
      async (request, reply) => {
        if (
          (request.body.scope === "project" && !request.body.project_id) ||
          (request.body.scope === "process" && request.body.project_id !== undefined) ||
          request.body.reason.trim().length === 0
        ) {
          return reply
            .status(400)
            .send(errorBody(request.id, "VALIDATION_ERROR", "Request validation failed"));
        }

        const identity = identityFor(request);
        const projectId: string | null =
          request.body.scope === "project" ? (request.body.project_id as string) : null;
        if (
          projectId !== null &&
          !dependencies.projectStore?.getProject(projectId, identity.owner_id)
        ) {
          return reply
            .status(404)
            .send(errorBody(request.id, "PROJECT_NOT_FOUND", "Project not found"));
        }

        const active =
          request.body.scope === "process"
            ? stopStore.getProcessStop()
            : stopStore.getProjectStop(projectId as string, identity.owner_id);
        if (!active || active.activated_at !== request.body.expected_activated_at) {
          return reply
            .status(409)
            .send(
              errorBody(
                request.id,
                "EMERGENCY_STOP_CONFLICT",
                "Emergency-stop activation changed or is no longer active"
              )
            );
        }
        if (
          active.scope === "process" &&
          (dependencies.config.runtimeEmergencyStop || active.activated_by === "system:environment")
        ) {
          return reply
            .status(409)
            .send(
              errorBody(
                request.id,
                "ENVIRONMENT_EMERGENCY_STOP_LOCKED",
                "Environment-triggered process stop requires offline operator recovery"
              )
            );
        }

        const token = stepUpToken(request.headers["x-step-up-token"]);
        const verified =
          token !== null &&
          dependencies.stepUpProofConsumer !== undefined &&
          (await dependencies.stepUpProofConsumer.consume({
            token,
            identity,
            purpose: "emergency_stop_clearance",
            challenge: emergencyStopClearanceChallenge(
              active.scope,
              active.project_id,
              active.activated_at
            )
          }));
        if (!verified) {
          return reply
            .status(403)
            .send(errorBody(request.id, "STEP_UP_REQUIRED", "Step-up verification required"));
        }

        const clearance =
          active.scope === "process"
            ? stopStore.clearProcess({
                expectedActivatedAt: active.activated_at,
                actorId: identity.actor_id,
                ownerId: identity.owner_id,
                reason: request.body.reason
              })
            : stopStore.clearProject(active.project_id as string, {
                expectedActivatedAt: active.activated_at,
                actorId: identity.actor_id,
                ownerId: identity.owner_id,
                reason: request.body.reason
              });
        if (!clearance) {
          return reply
            .status(409)
            .send(
              errorBody(
                request.id,
                "EMERGENCY_STOP_CONFLICT",
                "Emergency-stop activation changed or is no longer active"
              )
            );
        }
        app.log.warn(
          {
            eventId: clearance.event_id,
            scope: clearance.scope,
            projectId: clearance.project_id,
            activatedAt: clearance.activated_at,
            clearedBy: clearance.cleared_by
          },
          "Emergency stop cleared"
        );
        const response: EmergencyStopClearanceEvent = clearance;
        return response;
      }
    );
  }

  app.get(
    "/api/v1/model-runtime",
    { schema: { response: { 200: ModelRuntimeStatusSchema } } },
    () => {
      const response: ModelRuntimeStatus = {
        mode: dependencies.config.modelProvider,
        provider: dependencies.config.modelProviderId,
        model: dependencies.config.modelName,
        registry_version: dependencies.modelRegistryVersion ?? null,
        credential_configured:
          dependencies.config.modelProvider !== "mock" && dependencies.config.modelApiKeyConfigured,
        fallback_to_mock: dependencies.config.modelFallbackToMock,
        max_attempts_per_route: dependencies.config.modelMaxAttemptsPerRoute,
        max_output_tokens: dependencies.config.managerMaxOutputTokens
      };
      return response;
    }
  );

  if (
    dependencies.managerWorkStore &&
    dependencies.managerWorkCoordinator &&
    dependencies.projectStore
  ) {
    registerManagerWorkRoutes({
      app,
      store: dependencies.managerWorkStore,
      coordinator: dependencies.managerWorkCoordinator,
      projects: dependencies.projectStore,
      identityFor
    });
  }

  if (dependencies.generalChatStore && dependencies.modelGateway && dependencies.chat) {
    registerGeneralChatRoutes({
      app,
      store: dependencies.generalChatStore,
      modelGateway: dependencies.modelGateway,
      chat: dependencies.chat,
      runtimeMetrics,
      activeRuns,
      runObservers,
      ...(dependencies.generalChatRunExecutionMode
        ? { runExecutionMode: dependencies.generalChatRunExecutionMode }
        : {}),
      identityFor,
      ...(dependencies.emergencyStopStore
        ? { emergencyStopStore: dependencies.emergencyStopStore }
        : {})
    });
  }

  if (
    dependencies.projectStore &&
    dependencies.patternLibraryStore &&
    dependencies.agentBlueprintStore &&
    dependencies.agentInstanceStore &&
    dependencies.agentStudioMutationStore
  ) {
    const projectStore = dependencies.projectStore;
    const patterns = dependencies.patternLibraryStore;
    const blueprints = dependencies.agentBlueprintStore;
    const instances = dependencies.agentInstanceStore;
    const mutations = dependencies.agentStudioMutationStore;
    const isOwnedProject = (projectId: string, ownerId: string): boolean =>
      projectStore.getProject(projectId, ownerId) !== null;

    app.get(
      "/api/v1/projects/:projectId/agent-studio/functions",
      {
        schema: {
          params: AgentStudioProjectParamsSchema,
          response: { 200: AgentFunctionListResponseSchema, 404: ApiErrorSchema }
        }
      },
      async (request, reply) => {
        const identity = identityFor(request);
        if (!isOwnedProject(request.params.projectId, identity.owner_id)) {
          return reply
            .status(404)
            .send(errorBody(request.id, "PROJECT_NOT_FOUND", "Project not found"));
        }
        const response: AgentFunctionListResponse = {
          items: patterns.listFunctions(identity, request.params.projectId)
        };
        return response;
      }
    );

    app.get(
      "/api/v1/projects/:projectId/agent-studio/patterns",
      {
        schema: {
          params: AgentStudioProjectParamsSchema,
          querystring: AgentStudioPatternQuerySchema,
          response: { 200: BehaviorPatternListResponseSchema, 404: ApiErrorSchema }
        }
      },
      async (request, reply) => {
        const identity = identityFor(request);
        if (!isOwnedProject(request.params.projectId, identity.owner_id)) {
          return reply
            .status(404)
            .send(errorBody(request.id, "PROJECT_NOT_FOUND", "Project not found"));
        }
        const response: BehaviorPatternListResponse = {
          items: patterns.listPatterns(
            identity,
            request.params.projectId,
            request.query.include_archived ?? false
          )
        };
        return response;
      }
    );

    app.get(
      "/api/v1/projects/:projectId/agent-studio/blueprints",
      {
        schema: {
          params: AgentStudioProjectParamsSchema,
          response: { 200: AgentBlueprintListResponseSchema, 404: ApiErrorSchema }
        }
      },
      async (request, reply) => {
        const identity = identityFor(request);
        if (!isOwnedProject(request.params.projectId, identity.owner_id)) {
          return reply
            .status(404)
            .send(errorBody(request.id, "PROJECT_NOT_FOUND", "Project not found"));
        }
        const response: AgentBlueprintListResponse = {
          items: blueprints.listBlueprints(identity, request.params.projectId)
        };
        return response;
      }
    );

    app.get(
      "/api/v1/projects/:projectId/agent-studio/proposals",
      {
        schema: {
          params: AgentStudioProjectParamsSchema,
          response: { 200: AgentInstanceListResponseSchema, 404: ApiErrorSchema }
        }
      },
      async (request, reply) => {
        const identity = identityFor(request);
        if (!isOwnedProject(request.params.projectId, identity.owner_id)) {
          return reply
            .status(404)
            .send(errorBody(request.id, "PROJECT_NOT_FOUND", "Project not found"));
        }
        const response: AgentInstanceListResponse = {
          items: instances.listInstances(identity, request.params.projectId)
        };
        return response;
      }
    );

    app.get(
      "/api/v1/projects/:projectId/agent-studio/decision-events",
      {
        schema: {
          params: AgentStudioProjectParamsSchema,
          querystring: AgentStudioDecisionEventQuerySchema,
          response: { 200: AgentStudioDecisionEventListResponseSchema, 404: ApiErrorSchema }
        }
      },
      async (request, reply) => {
        const identity = identityFor(request);
        if (!isOwnedProject(request.params.projectId, identity.owner_id)) {
          return reply
            .status(404)
            .send(errorBody(request.id, "PROJECT_NOT_FOUND", "Project not found"));
        }
        const response: AgentStudioDecisionEventListResponse = {
          items: mutations.listDecisionEvents(
            identity,
            request.params.projectId,
            request.query.limit ?? 50
          )
        };
        return response;
      }
    );

    app.post(
      "/api/v1/projects/:projectId/agent-studio/proposals",
      {
        schema: {
          params: AgentStudioProjectParamsSchema,
          headers: AgentStudioCreateHeadersSchema,
          body: ProposeRootAgentRequestSchema,
          response: {
            200: AgentInstanceSchema,
            201: AgentInstanceSchema,
            400: ApiErrorSchema,
            404: ApiErrorSchema,
            409: ApiErrorSchema
          }
        }
      },
      async (request, reply) => {
        const identity = identityFor(request);
        if (!isOwnedProject(request.params.projectId, identity.owner_id)) {
          return reply
            .status(404)
            .send(errorBody(request.id, "PROJECT_NOT_FOUND", "Project not found"));
        }
        try {
          const result = mutations.create(identity, {
            project_id: request.params.projectId,
            idempotency_key: request.headers["idempotency-key"],
            operation: "proposal.root",
            request: request.body,
            execute: () =>
              instances.proposeRoot(identity, {
                project_id: request.params.projectId,
                blueprint_ref: request.body.blueprint_ref
              }),
            reference_of: (value) => ({ id: value.instance_id, version: 1 }),
            resolve: (reference) =>
              instances.getInstance(identity, request.params.projectId, reference.id)
          });
          return reply
            .header("idempotency-replayed", String(result.replayed))
            .status(result.replayed ? 200 : 201)
            .send(result.value);
        } catch (error) {
          return sendAgentStudioMutationError(error, request, reply);
        }
      }
    );

    app.post(
      "/api/v1/projects/:projectId/agent-studio/proposals/delegated",
      {
        schema: {
          params: AgentStudioProjectParamsSchema,
          headers: AgentStudioCreateHeadersSchema,
          body: ProposeDelegatedAgentRequestSchema,
          response: {
            200: AgentInstanceSchema,
            201: AgentInstanceSchema,
            400: ApiErrorSchema,
            403: ApiErrorSchema,
            404: ApiErrorSchema,
            409: ApiErrorSchema
          }
        }
      },
      async (request, reply) => {
        const identity = identityFor(request);
        if (!isOwnedProject(request.params.projectId, identity.owner_id)) {
          return reply
            .status(404)
            .send(errorBody(request.id, "PROJECT_NOT_FOUND", "Project not found"));
        }
        try {
          const result = mutations.create(identity, {
            project_id: request.params.projectId,
            idempotency_key: request.headers["idempotency-key"],
            operation: "proposal.delegated",
            request: request.body,
            execute: () =>
              instances.proposeDelegated(identity, {
                project_id: request.params.projectId,
                parent_instance_id: request.body.parent_instance_id,
                blueprint_ref: request.body.blueprint_ref
              }),
            reference_of: (value) => ({ id: value.instance_id, version: 1 }),
            resolve: (reference) =>
              instances.getInstance(identity, request.params.projectId, reference.id)
          });
          return reply
            .header("idempotency-replayed", String(result.replayed))
            .status(result.replayed ? 200 : 201)
            .send(result.value);
        } catch (error) {
          return sendAgentStudioMutationError(error, request, reply);
        }
      }
    );

    app.post(
      "/api/v1/projects/:projectId/agent-studio/functions",
      {
        schema: {
          params: AgentStudioProjectParamsSchema,
          headers: AgentStudioCreateHeadersSchema,
          body: CreateAgentFunctionRequestSchema,
          response: {
            200: AgentFunctionDefinitionSchema,
            201: AgentFunctionDefinitionSchema,
            400: ApiErrorSchema,
            404: ApiErrorSchema,
            409: ApiErrorSchema
          }
        }
      },
      async (request, reply) => {
        const identity = identityFor(request);
        if (!isOwnedProject(request.params.projectId, identity.owner_id)) {
          return reply
            .status(404)
            .send(errorBody(request.id, "PROJECT_NOT_FOUND", "Project not found"));
        }
        try {
          const result = mutations.create(identity, {
            project_id: request.params.projectId,
            idempotency_key: request.headers["idempotency-key"],
            operation: "function.create",
            request: request.body,
            execute: () =>
              patterns.createFunction(identity, {
                project_id: request.params.projectId,
                ...request.body
              }),
            reference_of: (value) => ({ id: value.function_id, version: value.version }),
            resolve: (reference) =>
              patterns.getFunction(
                identity,
                reference.id,
                reference.version,
                request.params.projectId
              )
          });
          return reply
            .header("idempotency-replayed", String(result.replayed))
            .status(result.replayed ? 200 : 201)
            .send(result.value);
        } catch (error) {
          return sendAgentStudioMutationError(error, request, reply);
        }
      }
    );

    app.post(
      "/api/v1/projects/:projectId/agent-studio/functions/:functionId/versions",
      {
        schema: {
          params: AgentStudioFunctionParamsSchema,
          body: CreateAgentFunctionVersionRequestSchema,
          response: {
            201: AgentFunctionDefinitionSchema,
            400: ApiErrorSchema,
            404: ApiErrorSchema,
            409: ApiErrorSchema
          }
        }
      },
      async (request, reply) => {
        const identity = identityFor(request);
        if (!isOwnedProject(request.params.projectId, identity.owner_id)) {
          return reply
            .status(404)
            .send(errorBody(request.id, "PROJECT_NOT_FOUND", "Project not found"));
        }
        const current = patterns
          .listFunctions(identity, request.params.projectId)
          .find(
            (item) =>
              item.function_id === request.params.functionId &&
              item.project_id === request.params.projectId
          );
        if (!current) {
          return reply
            .status(404)
            .send(
              errorBody(
                request.id,
                "AGENT_STUDIO_OBJECT_NOT_FOUND",
                "Agent Studio object not found"
              )
            );
        }
        const { expected_version: expectedVersion, ...input } = request.body;
        try {
          return reply.status(201).send(
            mutations.change(identity, {
              project_id: request.params.projectId,
              operation: "function.version",
              execute: () =>
                patterns.createFunctionVersion(
                  identity,
                  request.params.functionId,
                  input,
                  expectedVersion
                ),
              reference_of: (value) => ({ id: value.function_id, version: value.version })
            })
          );
        } catch (error) {
          return sendAgentStudioMutationError(error, request, reply);
        }
      }
    );

    app.post(
      "/api/v1/projects/:projectId/agent-studio/patterns",
      {
        schema: {
          params: AgentStudioProjectParamsSchema,
          headers: AgentStudioCreateHeadersSchema,
          body: CreateBehaviorPatternRequestSchema,
          response: {
            200: BehaviorPatternSchema,
            201: BehaviorPatternSchema,
            400: ApiErrorSchema,
            404: ApiErrorSchema,
            409: ApiErrorSchema
          }
        }
      },
      async (request, reply) => {
        const identity = identityFor(request);
        if (!isOwnedProject(request.params.projectId, identity.owner_id)) {
          return reply
            .status(404)
            .send(errorBody(request.id, "PROJECT_NOT_FOUND", "Project not found"));
        }
        try {
          const result = mutations.create(identity, {
            project_id: request.params.projectId,
            idempotency_key: request.headers["idempotency-key"],
            operation: "pattern.create",
            request: request.body,
            execute: () =>
              patterns.createPattern(identity, {
                project_id: request.params.projectId,
                ...request.body
              }),
            reference_of: (value) => ({ id: value.pattern_id, version: value.version }),
            resolve: (reference) =>
              patterns.getPattern(
                identity,
                reference.id,
                reference.version,
                request.params.projectId
              )
          });
          return reply
            .header("idempotency-replayed", String(result.replayed))
            .status(result.replayed ? 200 : 201)
            .send(result.value);
        } catch (error) {
          return sendAgentStudioMutationError(error, request, reply);
        }
      }
    );

    app.post(
      "/api/v1/projects/:projectId/agent-studio/patterns/:patternId/versions",
      {
        schema: {
          params: AgentStudioPatternParamsSchema,
          body: CreateBehaviorPatternVersionRequestSchema,
          response: {
            201: BehaviorPatternSchema,
            400: ApiErrorSchema,
            404: ApiErrorSchema,
            409: ApiErrorSchema
          }
        }
      },
      async (request, reply) => {
        const identity = identityFor(request);
        if (!isOwnedProject(request.params.projectId, identity.owner_id)) {
          return reply
            .status(404)
            .send(errorBody(request.id, "PROJECT_NOT_FOUND", "Project not found"));
        }
        const current = patterns
          .listPatterns(identity, request.params.projectId, true)
          .find(
            (item) =>
              item.pattern_id === request.params.patternId &&
              item.project_id === request.params.projectId
          );
        if (!current) {
          return reply
            .status(404)
            .send(
              errorBody(
                request.id,
                "AGENT_STUDIO_OBJECT_NOT_FOUND",
                "Agent Studio object not found"
              )
            );
        }
        const { expected_version: expectedVersion, ...input } = request.body;
        try {
          return reply.status(201).send(
            mutations.change(identity, {
              project_id: request.params.projectId,
              operation: "pattern.version",
              execute: () =>
                patterns.createPatternVersion(
                  identity,
                  request.params.patternId,
                  input,
                  expectedVersion
                ),
              reference_of: (value) => ({ id: value.pattern_id, version: value.version })
            })
          );
        } catch (error) {
          return sendAgentStudioMutationError(error, request, reply);
        }
      }
    );

    app.post(
      "/api/v1/projects/:projectId/agent-studio/patterns/:patternId/archive",
      {
        schema: {
          params: AgentStudioPatternParamsSchema,
          response: {
            200: BehaviorPatternSchema,
            400: ApiErrorSchema,
            404: ApiErrorSchema,
            409: ApiErrorSchema
          }
        }
      },
      async (request, reply) => {
        const identity = identityFor(request);
        if (!isOwnedProject(request.params.projectId, identity.owner_id)) {
          return reply
            .status(404)
            .send(errorBody(request.id, "PROJECT_NOT_FOUND", "Project not found"));
        }
        const current = patterns
          .listPatterns(identity, request.params.projectId, true)
          .find(
            (item) =>
              item.pattern_id === request.params.patternId &&
              item.project_id === request.params.projectId
          );
        if (!current) {
          return reply
            .status(404)
            .send(
              errorBody(
                request.id,
                "AGENT_STUDIO_OBJECT_NOT_FOUND",
                "Agent Studio object not found"
              )
            );
        }
        try {
          return mutations.change(identity, {
            project_id: request.params.projectId,
            operation: "pattern.archive",
            execute: () => patterns.archivePattern(identity, request.params.patternId),
            reference_of: (value) => ({ id: value.pattern_id, version: value.version }),
            changed: () => current.archived_at === null
          });
        } catch (error) {
          return sendAgentStudioMutationError(error, request, reply);
        }
      }
    );

    app.post(
      "/api/v1/projects/:projectId/agent-studio/blueprints",
      {
        schema: {
          params: AgentStudioProjectParamsSchema,
          headers: AgentStudioCreateHeadersSchema,
          body: CreateAgentBlueprintRequestSchema,
          response: {
            200: AgentBlueprintSchema,
            201: AgentBlueprintSchema,
            400: ApiErrorSchema,
            404: ApiErrorSchema,
            409: ApiErrorSchema
          }
        }
      },
      async (request, reply) => {
        const identity = identityFor(request);
        if (!isOwnedProject(request.params.projectId, identity.owner_id)) {
          return reply
            .status(404)
            .send(errorBody(request.id, "PROJECT_NOT_FOUND", "Project not found"));
        }
        try {
          const result = mutations.create(identity, {
            project_id: request.params.projectId,
            idempotency_key: request.headers["idempotency-key"],
            operation: "blueprint.create",
            request: request.body,
            execute: () =>
              blueprints.createBlueprint(identity, {
                ...request.body,
                project_id: request.params.projectId,
                grant: { ...request.body.grant, project_id: request.params.projectId }
              }),
            reference_of: (value) => ({ id: value.blueprint_id, version: value.version }),
            resolve: (reference) =>
              blueprints.getBlueprint(
                identity,
                reference.id,
                reference.version,
                request.params.projectId
              )
          });
          return reply
            .header("idempotency-replayed", String(result.replayed))
            .status(result.replayed ? 200 : 201)
            .send(result.value);
        } catch (error) {
          return sendAgentStudioMutationError(error, request, reply);
        }
      }
    );

    app.post(
      "/api/v1/projects/:projectId/agent-studio/blueprints/:blueprintId/versions",
      {
        schema: {
          params: AgentStudioBlueprintParamsSchema,
          body: CreateAgentBlueprintVersionRequestSchema,
          response: {
            201: AgentBlueprintSchema,
            400: ApiErrorSchema,
            404: ApiErrorSchema,
            409: ApiErrorSchema
          }
        }
      },
      async (request, reply) => {
        const identity = identityFor(request);
        if (!isOwnedProject(request.params.projectId, identity.owner_id)) {
          return reply
            .status(404)
            .send(errorBody(request.id, "PROJECT_NOT_FOUND", "Project not found"));
        }
        const current = blueprints
          .listBlueprints(identity, request.params.projectId)
          .find((item) => item.blueprint_id === request.params.blueprintId);
        if (!current) {
          return reply
            .status(404)
            .send(
              errorBody(
                request.id,
                "AGENT_STUDIO_OBJECT_NOT_FOUND",
                "Agent Studio object not found"
              )
            );
        }
        const { expected_version: expectedVersion, ...input } = request.body;
        try {
          return reply.status(201).send(
            mutations.change(identity, {
              project_id: request.params.projectId,
              operation: "blueprint.version",
              execute: () =>
                blueprints.createBlueprintVersion(
                  identity,
                  request.params.blueprintId,
                  {
                    ...input,
                    grant: { ...input.grant, project_id: request.params.projectId }
                  },
                  expectedVersion
                ),
              reference_of: (value) => ({ id: value.blueprint_id, version: value.version })
            })
          );
        } catch (error) {
          return sendAgentStudioMutationError(error, request, reply);
        }
      }
    );
  }

  if (dependencies.projectStore && dependencies.modelGateway && dependencies.manager) {
    const store = dependencies.projectStore;
    const modelGateway = dependencies.modelGateway;
    const manager = dependencies.manager;
    const demoManagerStore = dependencies.demoManagerStore;
    const demoManagerCoordinator = dependencies.demoManagerCoordinator;

    app.get(
      "/api/v1/projects",
      { schema: { response: { 200: ProjectListResponseSchema } } },
      (request) => {
        const response: ProjectListResponse = {
          items: store.listProjects(identityFor(request).owner_id)
        };
        return response;
      }
    );

    app.post(
      "/api/v1/projects",
      {
        schema: {
          body: CreateProjectRequestSchema,
          response: {
            201: MessageAcceptedResponseSchema,
            200: MessageAcceptedResponseSchema,
            409: ApiErrorSchema
          }
        }
      },
      async (request, reply) => {
        const accepted = store.createProject(
          request.body.initial_message,
          request.body.client_message_id,
          identityFor(request).owner_id
        );
        dependencies.policyStore?.ensureProfile(accepted.project.id);
        dependencies.usageStore?.ensureLimit(accepted.project.id, identityFor(request).owner_id);
        return reply.status(accepted.duplicate ? 200 : 201).send(acceptedResponse(accepted));
      }
    );

    if (dependencies.usageStore) {
      const usageStore = dependencies.usageStore;

      app.get(
        "/api/v1/projects/:projectId/usage-summary",
        {
          schema: {
            params: {
              type: "object",
              properties: { projectId: { type: "string", minLength: 1 } },
              required: ["projectId"],
              additionalProperties: false
            },
            response: { 200: ProjectUsageSummarySchema, 404: ApiErrorSchema }
          }
        },
        async (request, reply) => {
          const ownerId = identityFor(request).owner_id;
          if (!store.getProject(request.params.projectId, ownerId)) {
            return reply
              .status(404)
              .send(errorBody(request.id, "PROJECT_NOT_FOUND", "Project not found"));
          }
          const summary = usageStore.getProjectSummary(request.params.projectId, ownerId);
          if (!summary) {
            return reply
              .status(404)
              .send(errorBody(request.id, "PROJECT_NOT_FOUND", "Project not found"));
          }
          const response: ProjectUsageSummary = summary;
          return response;
        }
      );

      app.get(
        "/api/v1/projects/:projectId/usage-limit",
        {
          schema: {
            params: AgentStudioProjectParamsSchema,
            response: { 200: ProjectUsageLimitResponseSchema, 404: ApiErrorSchema }
          }
        },
        async (request, reply) => {
          const ownerId = identityFor(request).owner_id;
          const limit = usageStore.ensureLimit(request.params.projectId, ownerId);
          if (!limit) {
            return reply
              .status(404)
              .send(errorBody(request.id, "PROJECT_NOT_FOUND", "Project not found"));
          }
          const response: ProjectUsageLimitResponse = { limit };
          return response;
        }
      );

      app.post(
        "/api/v1/projects/:projectId/usage-limit/preview",
        {
          validatorCompiler: TypeBoxValidatorCompiler,
          schema: {
            params: AgentStudioProjectParamsSchema,
            body: UpdateProjectUsageLimitRequestSchema,
            response: {
              200: ProjectUsageLimitPreviewResponseSchema,
              404: ApiErrorSchema,
              409: ApiErrorSchema
            }
          }
        },
        async (request, reply) => {
          const ownerId = identityFor(request).owner_id;
          const current = usageStore.ensureLimit(request.params.projectId, ownerId);
          if (!current) {
            return reply
              .status(404)
              .send(errorBody(request.id, "PROJECT_NOT_FOUND", "Project not found"));
          }
          if (current.version !== request.body.expected_version) {
            return reply
              .status(409)
              .send(
                errorBody(request.id, "USAGE_LIMIT_CONFLICT", "Project usage limit version changed")
              );
          }
          const proposedLimit: ProjectUsageLimit = {
            project_id: current.project_id,
            version: current.version + 1,
            max_total_tokens: request.body.max_total_tokens,
            max_cost: request.body.max_cost,
            created_at: current.created_at,
            updated_at: new Date().toISOString()
          };
          const response: ProjectUsageLimitPreviewResponse = {
            current_version: current.version,
            proposed_limit: proposedLimit,
            requires_step_up: usageLimitUpdateRequiresStepUp(current, request.body)
          };
          return response;
        }
      );

      app.put(
        "/api/v1/projects/:projectId/usage-limit",
        {
          validatorCompiler: TypeBoxValidatorCompiler,
          schema: {
            params: AgentStudioProjectParamsSchema,
            body: UpdateProjectUsageLimitRequestSchema,
            response: {
              200: ProjectUsageLimitResponseSchema,
              403: ApiErrorSchema,
              404: ApiErrorSchema,
              409: ApiErrorSchema
            }
          }
        },
        async (request, reply) => {
          const identity = identityFor(request);
          const current = usageStore.ensureLimit(request.params.projectId, identity.owner_id);
          if (!current) {
            return reply
              .status(404)
              .send(errorBody(request.id, "PROJECT_NOT_FOUND", "Project not found"));
          }
          if (current.version !== request.body.expected_version) {
            return reply
              .status(409)
              .send(
                errorBody(request.id, "USAGE_LIMIT_CONFLICT", "Project usage limit version changed")
              );
          }
          if (usageLimitUpdateRequiresStepUp(current, request.body)) {
            const token = stepUpToken(request.headers["x-step-up-token"]);
            const verified =
              token !== null &&
              dependencies.stepUpProofConsumer !== undefined &&
              (await dependencies.stepUpProofConsumer.consume({
                token,
                identity,
                purpose: "project_usage_limit_expansion",
                challenge: projectUsageLimitStepUpChallenge(request.params.projectId, request.body)
              }));
            if (!verified) {
              return reply
                .status(403)
                .send(errorBody(request.id, "STEP_UP_REQUIRED", "Step-up verification required"));
            }
          }
          try {
            const response: ProjectUsageLimitResponse = {
              limit: usageStore.updateLimit(
                request.params.projectId,
                request.body,
                identity.owner_id
              )
            };
            return response;
          } catch (error) {
            if (error instanceof UsageLimitConflictError) {
              return reply
                .status(409)
                .send(
                  errorBody(
                    request.id,
                    "USAGE_LIMIT_CONFLICT",
                    "Project usage limit version changed"
                  )
                );
            }
            throw error;
          }
        }
      );
    }

    if (dependencies.policyStore) {
      const policyStore = dependencies.policyStore;

      app.get(
        "/api/v1/projects/:projectId/autonomy-profile",
        {
          schema: {
            params: {
              type: "object",
              properties: { projectId: { type: "string", minLength: 1 } },
              required: ["projectId"],
              additionalProperties: false
            },
            response: { 200: CapabilityProfileResponseSchema, 404: ApiErrorSchema }
          }
        },
        async (request, reply) => {
          if (!store.getProject(request.params.projectId, identityFor(request).owner_id)) {
            return reply
              .status(404)
              .send(errorBody(request.id, "PROJECT_NOT_FOUND", "Project not found"));
          }
          const profile = policyStore.ensureProfile(request.params.projectId);
          if (!profile) {
            return reply
              .status(404)
              .send(errorBody(request.id, "PROJECT_NOT_FOUND", "Project not found"));
          }
          const response: CapabilityProfileResponse = { profile };
          return response;
        }
      );

      app.get(
        "/api/v1/projects/:projectId/decision-trace",
        {
          schema: {
            params: AgentStudioProjectParamsSchema,
            querystring: PolicyDecisionTraceQuerySchema,
            response: { 200: PolicyDecisionTraceListResponseSchema, 404: ApiErrorSchema }
          }
        },
        async (request, reply) => {
          if (!store.getProject(request.params.projectId, identityFor(request).owner_id)) {
            return reply
              .status(404)
              .send(errorBody(request.id, "PROJECT_NOT_FOUND", "Project not found"));
          }
          const limit = request.query.limit ?? 50;
          const response: PolicyDecisionTraceListResponse = {
            items: policyStore.listDecisionTrace(request.params.projectId, limit),
            limit
          };
          return response;
        }
      );

      app.get(
        "/api/v1/projects/:projectId/recovery-required",
        {
          schema: {
            params: AgentStudioProjectParamsSchema,
            querystring: PolicyRecoveryRequiredQuerySchema,
            response: { 200: PolicyRecoveryRequiredListResponseSchema, 404: ApiErrorSchema }
          }
        },
        async (request, reply) => {
          if (!store.getProject(request.params.projectId, identityFor(request).owner_id)) {
            return reply
              .status(404)
              .send(errorBody(request.id, "PROJECT_NOT_FOUND", "Project not found"));
          }
          const limit = request.query.limit ?? 50;
          const response: PolicyRecoveryRequiredListResponse = {
            items: policyStore.listRecoveryRequired(request.params.projectId, limit),
            limit
          };
          return response;
        }
      );

      app.post(
        "/api/v1/projects/:projectId/autonomy-profile/preview",
        {
          validatorCompiler: TypeBoxValidatorCompiler,
          schema: {
            params: {
              type: "object",
              properties: { projectId: { type: "string", minLength: 1 } },
              required: ["projectId"],
              additionalProperties: false
            },
            body: UpdateCapabilityProfileRequestSchema,
            response: {
              200: CapabilityProfilePreviewResponseSchema,
              400: ApiErrorSchema,
              404: ApiErrorSchema,
              409: ApiErrorSchema
            }
          }
        },
        async (request, reply) => {
          const identity = identityFor(request);
          if (!store.getProject(request.params.projectId, identity.owner_id)) {
            return reply
              .status(404)
              .send(errorBody(request.id, "PROJECT_NOT_FOUND", "Project not found"));
          }
          const current = policyStore.getProfile(request.params.projectId);
          if (!current) {
            return reply
              .status(404)
              .send(errorBody(request.id, "PROJECT_NOT_FOUND", "Project not found"));
          }
          if (current.version !== request.body.expected_version) {
            return reply
              .status(409)
              .send(
                errorBody(
                  request.id,
                  "AUTONOMY_PROFILE_CONFLICT",
                  "Autonomy profile version changed"
                )
              );
          }
          if (!hasUniqueCapabilityOverrideIds(request.body.overrides)) {
            return reply
              .status(400)
              .send(errorBody(request.id, "VALIDATION_ERROR", "Point override IDs must be unique"));
          }
          const response: CapabilityProfilePreviewResponse = {
            current_version: current.version,
            proposed_profile: createCapabilityProfile({
              profileId: current.profile_id,
              projectId: current.project_id,
              baseLevel: request.body.base_level,
              overrides: request.body.overrides,
              version: current.version + 1,
              issuedAt: new Date().toISOString()
            }),
            requires_step_up: profileUpdateRequiresStepUp(
              request.body.base_level,
              request.body.overrides
            )
          };
          return response;
        }
      );

      app.put(
        "/api/v1/projects/:projectId/autonomy-profile",
        {
          validatorCompiler: TypeBoxValidatorCompiler,
          schema: {
            params: {
              type: "object",
              properties: { projectId: { type: "string", minLength: 1 } },
              required: ["projectId"],
              additionalProperties: false
            },
            body: UpdateCapabilityProfileRequestSchema,
            response: {
              200: CapabilityProfileResponseSchema,
              400: ApiErrorSchema,
              404: ApiErrorSchema,
              409: ApiErrorSchema,
              403: ApiErrorSchema
            }
          }
        },
        async (request, reply) => {
          const identity = identityFor(request);
          if (!store.getProject(request.params.projectId, identity.owner_id)) {
            return reply
              .status(404)
              .send(errorBody(request.id, "PROJECT_NOT_FOUND", "Project not found"));
          }
          const current = policyStore.ensureProfile(request.params.projectId);
          if (!current) {
            return reply
              .status(404)
              .send(errorBody(request.id, "PROJECT_NOT_FOUND", "Project not found"));
          }
          if (current.version !== request.body.expected_version) {
            return reply
              .status(409)
              .send(
                errorBody(
                  request.id,
                  "AUTONOMY_PROFILE_CONFLICT",
                  "Autonomy profile version changed"
                )
              );
          }
          if (!hasUniqueCapabilityOverrideIds(request.body.overrides)) {
            return reply
              .status(400)
              .send(errorBody(request.id, "VALIDATION_ERROR", "Point override IDs must be unique"));
          }
          if (profileUpdateRequiresStepUp(request.body.base_level, request.body.overrides)) {
            const token = stepUpToken(request.headers["x-step-up-token"]);
            const verified =
              token !== null &&
              dependencies.stepUpProofConsumer !== undefined &&
              (await dependencies.stepUpProofConsumer.consume({
                token,
                identity,
                purpose: "autonomy_profile_escalation",
                challenge: autonomyProfileStepUpChallenge(request.params.projectId, request.body)
              }));
            if (!verified) {
              return reply
                .status(403)
                .send(errorBody(request.id, "STEP_UP_REQUIRED", "Step-up verification required"));
            }
          }
          const profile = policyStore.updateProfile({
            projectId: request.params.projectId,
            baseLevel: request.body.base_level,
            overrides: request.body.overrides,
            expectedVersion: request.body.expected_version
          });
          if (!profile) {
            return reply
              .status(409)
              .send(
                errorBody(
                  request.id,
                  "AUTONOMY_PROFILE_CONFLICT",
                  "Autonomy profile version changed"
                )
              );
          }
          const response: CapabilityProfileResponse = { profile };
          return response;
        }
      );

      app.get(
        "/api/v1/projects/:projectId/confirmations",
        {
          schema: {
            params: {
              type: "object",
              properties: { projectId: { type: "string", minLength: 1 } },
              required: ["projectId"],
              additionalProperties: false
            },
            querystring: {
              type: "object",
              properties: {
                status: {
                  type: "string",
                  enum: ["PENDING", "APPROVED", "REJECTED", "EXPIRED", "CONSUMED"]
                }
              },
              additionalProperties: false
            },
            response: { 200: ConfirmationListResponseSchema, 404: ApiErrorSchema }
          }
        },
        async (request, reply) => {
          if (!store.getProject(request.params.projectId, identityFor(request).owner_id)) {
            return reply
              .status(404)
              .send(errorBody(request.id, "PROJECT_NOT_FOUND", "Project not found"));
          }
          const response: ConfirmationListResponse = {
            items: policyStore.listConfirmations(request.params.projectId, request.query.status)
          };
          return response;
        }
      );

      app.post(
        "/api/v1/confirmations/:confirmationId/approve",
        {
          schema: {
            params: {
              type: "object",
              properties: { confirmationId: { type: "string", minLength: 1 } },
              required: ["confirmationId"],
              additionalProperties: false
            },
            body: ConfirmationDecisionRequestSchema,
            response: {
              200: ConfirmationRequestSchema,
              403: ApiErrorSchema,
              404: ApiErrorSchema,
              409: ApiErrorSchema
            }
          }
        },
        async (request, reply) => {
          const identity = identityFor(request);
          const pending = policyStore.getConfirmation(request.params.confirmationId);
          if (!pending || !store.getProject(pending.project_id, identity.owner_id)) {
            return reply
              .status(404)
              .send(errorBody(request.id, "CONFIRMATION_NOT_FOUND", "Confirmation not found"));
          }
          if (
            pending.status !== "PENDING" ||
            pending.challenge_nonce !== request.body.challenge_nonce
          ) {
            return reply
              .status(409)
              .send(
                errorBody(
                  request.id,
                  "CONFIRMATION_ALREADY_DECIDED",
                  "Confirmation cannot be approved"
                )
              );
          }
          const preconditionAt = now();
          if (Date.parse(pending.expires_at) < Date.parse(preconditionAt)) {
            policyStore.decideConfirmation({
              confirmationId: request.params.confirmationId,
              challengeNonce: request.body.challenge_nonce,
              decision: "approve",
              decidedBy: identity.actor_id,
              approvalMethod: "session",
              decidedAt: preconditionAt
            });
            return reply
              .status(409)
              .send(errorBody(request.id, "CONFIRMATION_EXPIRED", "Confirmation expired"));
          }
          let approvalMethod: "session" | "step_up" = "session";
          if (pending.requires_step_up) {
            const token = stepUpToken(request.headers["x-step-up-token"]);
            const verified =
              token !== null &&
              dependencies.stepUpProofConsumer !== undefined &&
              (await dependencies.stepUpProofConsumer.consume({
                token,
                identity,
                purpose: "critical_tool_confirmation",
                challenge: request.body.challenge_nonce
              }));
            if (!verified) {
              return reply
                .status(403)
                .send(errorBody(request.id, "STEP_UP_REQUIRED", "Step-up verification required"));
            }
            approvalMethod = "step_up";
          }
          const decidedAt = now();
          const decision = policyStore.decideConfirmation({
            confirmationId: request.params.confirmationId,
            challengeNonce: request.body.challenge_nonce,
            decision: "approve",
            decidedBy: identity.actor_id,
            approvalMethod,
            decidedAt,
            ...(request.body.reason === undefined ? {} : { reason: request.body.reason })
          });
          if (decision.status === "APPROVED") return decision.confirmation;
          if (decision.status === "NOT_FOUND") {
            return reply
              .status(404)
              .send(errorBody(request.id, "CONFIRMATION_NOT_FOUND", "Confirmation not found"));
          }
          if (decision.status === "EXPIRED") {
            return reply
              .status(409)
              .send(errorBody(request.id, "CONFIRMATION_EXPIRED", "Confirmation expired"));
          }
          if (decision.status === "STEP_UP_REQUIRED") {
            return reply
              .status(403)
              .send(errorBody(request.id, "STEP_UP_REQUIRED", "Step-up verification required"));
          }
          return reply
            .status(409)
            .send(
              errorBody(
                request.id,
                "CONFIRMATION_ALREADY_DECIDED",
                "Confirmation cannot be approved"
              )
            );
        }
      );

      app.post(
        "/api/v1/confirmations/:confirmationId/reject",
        {
          schema: {
            params: {
              type: "object",
              properties: { confirmationId: { type: "string", minLength: 1 } },
              required: ["confirmationId"],
              additionalProperties: false
            },
            body: ConfirmationDecisionRequestSchema,
            response: { 200: ConfirmationRequestSchema, 404: ApiErrorSchema, 409: ApiErrorSchema }
          }
        },
        async (request, reply) => {
          const pending = policyStore.getConfirmation(request.params.confirmationId);
          if (!pending || !store.getProject(pending.project_id, identityFor(request).owner_id)) {
            return reply
              .status(404)
              .send(errorBody(request.id, "CONFIRMATION_NOT_FOUND", "Confirmation not found"));
          }
          const decision = policyStore.decideConfirmation({
            confirmationId: request.params.confirmationId,
            challengeNonce: request.body.challenge_nonce,
            decision: "reject",
            decidedBy: identityFor(request).actor_id,
            approvalMethod: "session",
            ...(request.body.reason === undefined ? {} : { reason: request.body.reason })
          });
          if (decision.status === "REJECTED") return decision.confirmation;
          if (decision.status === "NOT_FOUND") {
            return reply
              .status(404)
              .send(errorBody(request.id, "CONFIRMATION_NOT_FOUND", "Confirmation not found"));
          }
          if (decision.status === "EXPIRED") {
            return reply
              .status(409)
              .send(errorBody(request.id, "CONFIRMATION_EXPIRED", "Confirmation expired"));
          }
          return reply
            .status(409)
            .send(
              errorBody(
                request.id,
                "CONFIRMATION_ALREADY_DECIDED",
                "Confirmation cannot be rejected"
              )
            );
        }
      );
    }

    app.get(
      "/api/v1/projects/:projectId",
      {
        schema: {
          params: {
            type: "object",
            properties: { projectId: { type: "string", minLength: 1 } },
            required: ["projectId"],
            additionalProperties: false
          },
          response: { 200: ProjectDetailResponseSchema, 404: ApiErrorSchema }
        }
      },
      async (request, reply) => {
        const ownerId = identityFor(request).owner_id;
        const project = store.getProject(request.params.projectId, ownerId);
        const chatId = store.getMainChatId(request.params.projectId, ownerId);
        if (!project || !chatId) {
          return reply
            .status(404)
            .send(errorBody(request.id, "PROJECT_NOT_FOUND", "Project not found"));
        }
        const response: ProjectDetailResponse = {
          project,
          chat_id: chatId,
          messages: store.listMessages(project.id, ownerId)
        };
        return response;
      }
    );

    app.post(
      "/api/v1/projects/:projectId/messages",
      {
        schema: {
          params: {
            type: "object",
            properties: { projectId: { type: "string", minLength: 1 } },
            required: ["projectId"],
            additionalProperties: false
          },
          body: CreateMessageRequestSchema,
          response: {
            202: MessageAcceptedResponseSchema,
            200: MessageAcceptedResponseSchema,
            404: ApiErrorSchema,
            409: ApiErrorSchema
          }
        }
      },
      async (request, reply) => {
        const accepted = store.createMessage(
          request.params.projectId,
          request.body.content,
          request.body.client_message_id,
          identityFor(request).owner_id
        );
        if (!accepted) {
          return reply
            .status(404)
            .send(errorBody(request.id, "PROJECT_NOT_FOUND", "Project not found"));
        }
        return reply.status(accepted.duplicate ? 200 : 202).send(acceptedResponse(accepted));
      }
    );

    if (demoManagerStore && demoManagerCoordinator) {
      const projectParamsSchema = Type.Object(
        { projectId: Type.String({ minLength: 1 }) },
        { additionalProperties: false }
      );
      const demoRunParamsSchema = Type.Object(
        {
          projectId: Type.String({ minLength: 1 }),
          demoRunId: Type.String({ minLength: 1 })
        },
        { additionalProperties: false }
      );
      const demoRunForProject = (
        projectId: string,
        demoRunId: string,
        ownerId: string
      ): StoredDemoManagerRun | null => {
        const run = demoManagerStore.get(demoRunId, ownerId);
        return run?.project_id === projectId ? run : null;
      };

      app.get(
        "/api/v1/projects/:projectId/manager-demo-runs",
        {
          schema: {
            params: projectParamsSchema,
            response: { 200: DemoManagerRunListResponseSchema, 404: ApiErrorSchema }
          }
        },
        async (request, reply) => {
          const ownerId = identityFor(request).owner_id;
          if (!store.getProject(request.params.projectId, ownerId)) {
            return reply
              .status(404)
              .send(errorBody(request.id, "PROJECT_NOT_FOUND", "Project not found"));
          }
          const response: DemoManagerRunListResponse = {
            items: demoManagerStore
              .listForProject(request.params.projectId, ownerId)
              .map((run) => demoManagerResponse(run, demoManagerStore))
          };
          return response;
        }
      );

      app.post(
        "/api/v1/projects/:projectId/manager-demo-runs",
        {
          schema: {
            params: projectParamsSchema,
            body: CreateDemoManagerRunRequestSchema,
            response: {
              200: DemoManagerRunSchema,
              201: DemoManagerRunSchema,
              400: ApiErrorSchema,
              404: ApiErrorSchema,
              409: ApiErrorSchema
            }
          }
        },
        async (request, reply) => {
          const ownerId = identityFor(request).owner_id;
          if (!store.getProject(request.params.projectId, ownerId)) {
            return reply
              .status(404)
              .send(errorBody(request.id, "PROJECT_NOT_FOUND", "Project not found"));
          }
          const source = store.getRun(request.body.source_run_id, ownerId);
          if (!source || source.project_id !== request.params.projectId) {
            return reply
              .status(404)
              .send(errorBody(request.id, "RUN_NOT_FOUND", "Source run not found"));
          }
          const existing = demoManagerStore.getBySourceRun(request.body.source_run_id, ownerId);
          try {
            const plan = composeDemoManagerPlan({
              projectId: request.params.projectId,
              ownerGoal: request.body.owner_goal,
              createdAt: new Date().toISOString(),
              createId: randomUUID
            });
            const run = demoManagerStore.create({
              projectId: request.params.projectId,
              sourceRunId: request.body.source_run_id,
              ownerGoal: request.body.owner_goal,
              graph: plan.graph,
              ownerId
            });
            if (!run) {
              return reply
                .status(404)
                .send(errorBody(request.id, "RUN_NOT_FOUND", "Source run not found"));
            }
            return reply
              .status(existing ? 200 : 201)
              .send(demoManagerResponse(run, demoManagerStore));
          } catch (error) {
            if (error instanceof DemoManagerStoreValidationError) {
              return reply.status(409).send(errorBody(request.id, "CONFLICT", error.message));
            }
            throw error;
          }
        }
      );

      app.get(
        "/api/v1/projects/:projectId/manager-demo-runs/:demoRunId",
        {
          schema: {
            params: demoRunParamsSchema,
            response: { 200: DemoManagerRunSchema, 404: ApiErrorSchema }
          }
        },
        async (request, reply) => {
          const run = demoRunForProject(
            request.params.projectId,
            request.params.demoRunId,
            identityFor(request).owner_id
          );
          if (!run) {
            return reply
              .status(404)
              .send(errorBody(request.id, "RUN_NOT_FOUND", "Manager demo run not found"));
          }
          return demoManagerResponse(run, demoManagerStore);
        }
      );

      app.post(
        "/api/v1/projects/:projectId/manager-demo-runs/:demoRunId/execute",
        {
          schema: {
            params: demoRunParamsSchema,
            response: { 200: DemoManagerRunSchema, 404: ApiErrorSchema, 409: ApiErrorSchema }
          }
        },
        async (request, reply) => {
          const ownerId = identityFor(request).owner_id;
          const before = demoRunForProject(
            request.params.projectId,
            request.params.demoRunId,
            ownerId
          );
          if (!before) {
            return reply
              .status(404)
              .send(errorBody(request.id, "RUN_NOT_FOUND", "Manager demo run not found"));
          }
          if (before.status !== "queued") {
            return reply
              .status(409)
              .send(errorBody(request.id, "CONFLICT", "Manager demo run cannot start"));
          }
          const executed = demoManagerCoordinator.execute(before.demo_run_id, ownerId);
          if (!executed) {
            return reply
              .status(404)
              .send(errorBody(request.id, "RUN_NOT_FOUND", "Manager demo run not found"));
          }
          return demoManagerResponse(executed, demoManagerStore);
        }
      );

      app.post(
        "/api/v1/projects/:projectId/manager-demo-runs/:demoRunId/cancel",
        {
          schema: {
            params: demoRunParamsSchema,
            response: { 200: DemoManagerRunSchema, 404: ApiErrorSchema, 409: ApiErrorSchema }
          }
        },
        async (request, reply) => {
          const ownerId = identityFor(request).owner_id;
          const before = demoRunForProject(
            request.params.projectId,
            request.params.demoRunId,
            ownerId
          );
          if (!before) {
            return reply
              .status(404)
              .send(errorBody(request.id, "RUN_NOT_FOUND", "Manager demo run not found"));
          }
          if (before.status !== "queued" && before.status !== "running") {
            return reply
              .status(409)
              .send(errorBody(request.id, "RUN_ALREADY_FINISHED", "Manager demo run is finished"));
          }
          const cancelled = demoManagerStore.cancel(before.demo_run_id, ownerId);
          if (!cancelled) throw new Error("Demo Manager run disappeared during cancellation");
          return demoManagerResponse(cancelled, demoManagerStore);
        }
      );
    }

    app.post(
      "/api/v1/runs/:runId/cancel",
      {
        schema: {
          params: {
            type: "object",
            properties: { runId: { type: "string", minLength: 1 } },
            required: ["runId"],
            additionalProperties: false
          },
          response: { 200: RunCancelResponseSchema, 404: ApiErrorSchema, 409: ApiErrorSchema }
        }
      },
      async (request, reply) => {
        const cancelled = store.cancelRun(request.params.runId, identityFor(request).owner_id);
        if (cancelled === null) {
          return reply.status(404).send(errorBody(request.id, "RUN_NOT_FOUND", "Run not found"));
        }
        if (cancelled === "finished") {
          return reply
            .status(409)
            .send(errorBody(request.id, "RUN_ALREADY_FINISHED", "Run is already finished"));
        }
        activeRuns
          .get(request.params.runId)
          ?.controller.abort(new Error("Run was cancelled by the owner"));
        const response: RunCancelResponse = {
          run_id: request.params.runId,
          status: "cancelled"
        };
        return response;
      }
    );

    app.get(
      "/api/v1/runs/:runId/events",
      {
        schema: {
          params: {
            type: "object",
            properties: { runId: { type: "string", minLength: 1 } },
            required: ["runId"],
            additionalProperties: false
          }
        }
      },
      async (request, reply) => {
        const ownerId = identityFor(request).owner_id;
        const run = store.getRun(request.params.runId, ownerId);
        const conversation = store.getConversationForRun(request.params.runId, ownerId);
        if (!run || conversation.length === 0) {
          return reply.status(404).send(errorBody(request.id, "RUN_NOT_FOUND", "Run not found"));
        }
        if (!managerRunsExecuteInBackground && activeRuns.has(run.id)) {
          return reply
            .status(409)
            .send(errorBody(request.id, "CONFLICT", "Run is already streaming"));
        }

        reply.hijack();
        reply.raw.writeHead(200, {
          "cache-control": "no-cache, no-transform",
          connection: "keep-alive",
          "content-type": "text/event-stream; charset=utf-8",
          "x-accel-buffering": "no"
        });
        reply.raw.write(": connected\n\n");

        const existing = store.getAssistantMessage(run.id, ownerId);
        if (run.status === "cancelled") {
          sendEvent(reply, { type: "run.cancelled", data: { run_id: run.id } });
          endEventStream(reply);
          return reply;
        }
        if (run.status === "failed") {
          sendEvent(reply, {
            type: "run.failed",
            data: {
              run_id: run.id,
              error_code: existing?.error_code ?? "INTERRUPTED",
              retryable: false
            }
          });
          endEventStream(reply);
          return reply;
        }
        if (run.status === "succeeded" && existing) {
          completedReplay(
            reply,
            run.id,
            existing,
            run.provider ?? "unknown",
            run.model_resolved ?? "unknown"
          );
          endEventStream(reply);
          return reply;
        }

        if (managerRunsExecuteInBackground) {
          const observer = new AbortController();
          const stopObserving = (): void => observer.abort();
          runObservers.add(observer);
          reply.raw.once("close", stopObserving);
          try {
            await observePersistedRun(reply, store, run, ownerId, observer.signal);
          } finally {
            reply.raw.off("close", stopObserving);
            runObservers.delete(observer);
          }
          endEventStream(reply);
          return reply;
        }

        const blockingStop = dependencies.emergencyStopStore?.getBlockingStop(
          run.project_id,
          ownerId
        );
        if (blockingStop) {
          store.startAssistantMessage(run.id, ownerId);
          store.failRun(run.id, "EMERGENCY_STOP");
          runtimeMetrics.runFailed("EMERGENCY_STOP");
          sendEvent(reply, {
            type: "run.failed",
            data: { run_id: run.id, error_code: "EMERGENCY_STOP", retryable: false }
          });
          app.log.warn(
            { runId: run.id, projectId: run.project_id, stopScope: blockingStop.scope },
            "Model run blocked by emergency stop"
          );
          endEventStream(reply);
          return reply;
        }

        const assistant = store.startAssistantMessage(run.id, ownerId);
        if (!assistant) {
          endEventStream(reply);
          return reply;
        }

        sendEvent(reply, {
          type: "run.started",
          data: { run_id: run.id, timestamp: new Date().toISOString() }
        });
        sendEvent(reply, {
          type: "message.started",
          data: { run_id: run.id, message_id: assistant.id }
        });

        let sequence = 0;
        let size = assistant.content.length;
        let completed: Extract<ModelGatewayStreamEvent, { type: "response.completed" }> | undefined;
        const controller = new AbortController();
        activeRuns.set(run.id, { projectId: run.project_id, ownerId, controller });
        runtimeMetrics.runStarted();
        try {
          const modelRequest = manager.buildRequest({
            projectId: run.project_id,
            runId: run.id,
            messages: conversation
          });
          for await (const event of modelGateway.stream(modelRequest, controller.signal)) {
            if (event.type === "route.selected") {
              runtimeMetrics.routeSelected();
              app.log.info(
                {
                  runId: run.id,
                  projectId: run.project_id,
                  attempt: event.route.attempt,
                  provider: event.route.provider_id,
                  model: event.route.model_id,
                  registryVersion: event.route.registry_version
                },
                "Model route attempt selected"
              );
              const reserved = store.reserveModelUsage(run.id, event.route, ownerId);
              if (!reserved) {
                throw new GatewayRunError(
                  "ROUTE_UNAVAILABLE",
                  event.route.provider_id,
                  "Run cannot reserve the selected model route",
                  false
                );
              }
            } else if (event.type === "route.failed") {
              runtimeMetrics.routeFailed(event.errorCode);
              app.log.warn(
                {
                  runId: run.id,
                  projectId: run.project_id,
                  attempt: event.route.attempt,
                  provider: event.route.provider_id,
                  model: event.route.model_id,
                  errorCode: event.errorCode,
                  retryable: event.retryable
                },
                "Model route attempt failed"
              );
              store.failModelUsage(run.id, event.route.attempt, event.errorCode);
            } else if (event.type === "text.delta") {
              store.appendAssistantDelta(assistant.id, event.delta);
              size += event.delta.length;
              sendEvent(reply, {
                type: "message.delta",
                data: {
                  run_id: run.id,
                  message_id: assistant.id,
                  seq: sequence++,
                  delta: event.delta
                }
              });
            } else {
              completed = event;
            }
          }
          if (!completed) {
            throw new GatewayRunError(
              "PROVIDER_ERROR",
              "gateway",
              "Provider stream ended without completion",
              true
            );
          }
          store.completeRun(run.id, completed.provider, completed.model, completed.usage, {
            attempt: completed.route.attempt,
            calculatedCost: completed.calculatedCost
          });
          runtimeMetrics.runCompleted();
          app.log.info(
            {
              runId: run.id,
              projectId: run.project_id,
              attempt: completed.route.attempt,
              provider: completed.provider,
              model: completed.model,
              inputTokens: completed.usage.inputTokens,
              outputTokens: completed.usage.outputTokens,
              calculatedCost: completed.calculatedCost
            },
            "Model run completed"
          );
          sendEvent(reply, {
            type: "message.completed",
            data: {
              run_id: run.id,
              message_id: assistant.id,
              size,
              finish_reason: completed.finishReason
            }
          });
          sendEvent(reply, {
            type: "run.completed",
            data: {
              run_id: run.id,
              provider: completed.provider,
              model_resolved: completed.model
            }
          });
        } catch (error) {
          if (controller.signal.reason instanceof EmergencyStopActivatedError) {
            store.failRun(run.id, "EMERGENCY_STOP");
            runtimeMetrics.runFailed("EMERGENCY_STOP");
            sendEvent(reply, {
              type: "run.failed",
              data: { run_id: run.id, error_code: "EMERGENCY_STOP", retryable: false }
            });
            endEventStream(reply);
            app.log.error(
              { runId: run.id, projectId: run.project_id },
              "Active model run interrupted by emergency stop"
            );
            return reply;
          }

          const currentRun = store.getRun(run.id, ownerId);
          if (currentRun?.status === "cancelled") {
            runtimeMetrics.runCancelled();
            sendEvent(reply, { type: "run.cancelled", data: { run_id: run.id } });
            endEventStream(reply);
            return reply;
          }
          if (controller.signal.aborted) {
            store.failRun(run.id, "INTERRUPTED");
            runtimeMetrics.runFailed("INTERRUPTED");
            sendEvent(reply, {
              type: "run.failed",
              data: { run_id: run.id, error_code: "INTERRUPTED", retryable: true }
            });
            endEventStream(reply);
            app.log.warn(
              { runId: run.id, projectId: run.project_id },
              "Active model run interrupted by API lifecycle"
            );
            return reply;
          }
          if (error instanceof ProjectUsageLimitExceededError) {
            store.failRun(run.id, error.code);
            runtimeMetrics.runFailed("USAGE_LIMIT_EXCEEDED");
            sendEvent(reply, {
              type: "run.failed",
              data: { run_id: run.id, error_code: error.code, retryable: false }
            });
            app.log.warn(
              { runId: run.id, projectId: run.project_id, limitCode: error.code },
              "Model route blocked by project usage limit"
            );
            endEventStream(reply);
            return reply;
          }
          const gatewayError =
            error instanceof GatewayRunError
              ? error
              : new GatewayRunError("PROVIDER_ERROR", "gateway", "Model gateway failed", true, {
                  cause: error
                });
          const code = gatewayError.code;
          store.failRun(run.id, code);
          runtimeMetrics.runFailed(code);
          sendEvent(reply, {
            type: "run.failed",
            data: { run_id: run.id, error_code: code, retryable: gatewayError.retryable }
          });
          app.log.warn(
            { error: gatewayError, runId: run.id, provider: gatewayError.provider },
            "Model provider run failed"
          );
        } finally {
          activeRuns.delete(run.id);
        }
        endEventStream(reply);
        return reply;
      }
    );
  }

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof IdempotencyConflictError) {
      return reply
        .status(409)
        .send(
          errorBody(
            request.id,
            "IDEMPOTENCY_CONFLICT",
            "Idempotency key was already used for another request"
          )
        );
    }
    if (
      typeof error === "object" &&
      error !== null &&
      ("validation" in error || ("statusCode" in error && error.statusCode === 400))
    ) {
      return reply
        .status(400)
        .send(errorBody(request.id, "VALIDATION_ERROR", "Request validation failed"));
    }
    request.log.error(error);
    return reply
      .status(500)
      .send(errorBody(request.id, "INTERNAL_ERROR", "Internal server error", true));
  });

  app.setNotFoundHandler((request, reply) =>
    reply.status(404).send(errorBody(request.id, "ROUTE_NOT_FOUND", "Route not found"))
  );

  app.addHook("preClose", () => {
    for (const observer of runObservers) observer.abort();
    for (const active of activeRuns.values()) {
      active.controller.abort(new Error("API process is shutting down"));
    }
  });

  if (dependencies.closeDatabase) {
    app.addHook("onClose", () => dependencies.closeDatabase?.());
  }
  return app;
};
