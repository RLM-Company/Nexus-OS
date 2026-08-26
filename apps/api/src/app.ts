import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import type { ServerConfig } from "@cosmora/config";
import type { ManagerService } from "@cosmora/core";
import {
  ApiErrorSchema,
  AUTONOMY_MATRIX,
  CapabilityProfileResponseSchema,
  ConfirmationDecisionRequestSchema,
  ConfirmationListResponseSchema,
  ConfirmationRequestSchema,
  CreateMessageRequestSchema,
  CreateProjectRequestSchema,
  HealthResponseSchema,
  MessageAcceptedResponseSchema,
  ModelRuntimeStatusSchema,
  ProjectDetailResponseSchema,
  ProjectListResponseSchema,
  PERMISSION_MODE_RANK,
  RunCancelResponseSchema,
  UpdateCapabilityProfileRequestSchema,
  requiresStepUp,
  type ApiError,
  type CapabilityId,
  type CapabilityProfileResponse,
  type ConfirmationListResponse,
  type HealthResponse,
  type MessageAcceptedResponse,
  type ModelRuntimeStatus,
  type ProjectDetailResponse,
  type ProjectListResponse,
  type RunCancelResponse,
  type StreamEvent
} from "@cosmora/contracts";
import {
  IdempotencyConflictError,
  type DatabaseHealth,
  type PolicyStore,
  type ProjectStore,
  type StoredMessage
} from "@cosmora/db";
import {
  GatewayRunError,
  type ModelGateway,
  type ModelGatewayStreamEvent
} from "@cosmora/model-gateway";
import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";

export interface AppDependencies {
  config: ServerConfig;
  database: DatabaseHealth;
  projectStore?: ProjectStore;
  policyStore?: PolicyStore;
  modelGateway?: ModelGateway;
  manager?: ManagerService;
  modelRegistryVersion?: string;
  stepUpVerifier?: (token: string, purpose: string) => Promise<boolean>;
  closeDatabase?: () => void;
}

const stepUpToken = (value: string | string[] | undefined): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

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

const errorBody = (
  requestId: string,
  code: ApiError["error"]["code"],
  message: string,
  retryable = false
): ApiError => ({ error: { code, message, request_id: requestId, retryable } });

const acceptedResponse = (
  accepted: NonNullable<ReturnType<ProjectStore["createMessage"]>>
): MessageAcceptedResponse => ({
  project: accepted.project,
  chat_id: accepted.chatId,
  user_message: accepted.userMessage,
  run_id: accepted.run.id,
  stream_url: `/api/v1/runs/${accepted.run.id}/events`
});

const sendEvent = (reply: FastifyReply, event: StreamEvent): void => {
  reply.raw.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
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

export const buildApp = (dependencies: AppDependencies): FastifyInstance => {
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

  const activeRuns = new Map<string, AbortController>();

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
          dependencies.config.modelProvider !== "mock" && Boolean(dependencies.config.modelApiKey),
        fallback_to_mock: dependencies.config.modelFallbackToMock
      };
      return response;
    }
  );

  if (dependencies.projectStore && dependencies.modelGateway && dependencies.manager) {
    const store = dependencies.projectStore;
    const modelGateway = dependencies.modelGateway;
    const manager = dependencies.manager;

    app.get(
      "/api/v1/projects",
      { schema: { response: { 200: ProjectListResponseSchema } } },
      () => {
        const response: ProjectListResponse = { items: store.listProjects() };
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
          request.body.client_message_id
        );
        dependencies.policyStore?.ensureProfile(accepted.project.id);
        return reply.status(accepted.duplicate ? 200 : 201).send(acceptedResponse(accepted));
      }
    );

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

      app.put(
        "/api/v1/projects/:projectId/autonomy-profile",
        {
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
              404: ApiErrorSchema,
              409: ApiErrorSchema,
              403: ApiErrorSchema
            }
          }
        },
        async (request, reply) => {
          if (!store.getProject(request.params.projectId)) {
            return reply
              .status(404)
              .send(errorBody(request.id, "PROJECT_NOT_FOUND", "Project not found"));
          }
          policyStore.ensureProfile(request.params.projectId);
          if (profileUpdateRequiresStepUp(request.body.base_level, request.body.overrides)) {
            const token = stepUpToken(request.headers["x-step-up-token"]);
            const verified =
              token !== null &&
              dependencies.stepUpVerifier !== undefined &&
              (await dependencies.stepUpVerifier(token, "autonomy_profile_escalation"));
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
          if (!store.getProject(request.params.projectId)) {
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
          const pending = policyStore.getConfirmation(request.params.confirmationId);
          if (!pending) {
            return reply
              .status(404)
              .send(errorBody(request.id, "CONFIRMATION_NOT_FOUND", "Confirmation not found"));
          }
          let approvalMethod: "session" | "step_up" = "session";
          if (pending.requires_step_up) {
            const token = stepUpToken(request.headers["x-step-up-token"]);
            const verified =
              token !== null &&
              dependencies.stepUpVerifier !== undefined &&
              (await dependencies.stepUpVerifier(token, "critical_tool_confirmation"));
            if (!verified) {
              return reply
                .status(403)
                .send(errorBody(request.id, "STEP_UP_REQUIRED", "Step-up verification required"));
            }
            approvalMethod = "step_up";
          }
          const decision = policyStore.decideConfirmation({
            confirmationId: request.params.confirmationId,
            challengeNonce: request.body.challenge_nonce,
            decision: "approve",
            decidedBy: "local-owner",
            approvalMethod,
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
          const decision = policyStore.decideConfirmation({
            confirmationId: request.params.confirmationId,
            challengeNonce: request.body.challenge_nonce,
            decision: "reject",
            decidedBy: "local-owner",
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
        const project = store.getProject(request.params.projectId);
        const chatId = store.getMainChatId(request.params.projectId);
        if (!project || !chatId) {
          return reply
            .status(404)
            .send(errorBody(request.id, "PROJECT_NOT_FOUND", "Project not found"));
        }
        const response: ProjectDetailResponse = {
          project,
          chat_id: chatId,
          messages: store.listMessages(project.id)
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
          request.body.client_message_id
        );
        if (!accepted) {
          return reply
            .status(404)
            .send(errorBody(request.id, "PROJECT_NOT_FOUND", "Project not found"));
        }
        return reply.status(accepted.duplicate ? 200 : 202).send(acceptedResponse(accepted));
      }
    );

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
        const cancelled = store.cancelRun(request.params.runId);
        if (cancelled === null) {
          return reply.status(404).send(errorBody(request.id, "RUN_NOT_FOUND", "Run not found"));
        }
        if (cancelled === "finished") {
          return reply
            .status(409)
            .send(errorBody(request.id, "RUN_ALREADY_FINISHED", "Run is already finished"));
        }
        activeRuns.get(request.params.runId)?.abort(new Error("Run was cancelled by the owner"));
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
        const run = store.getRun(request.params.runId);
        const conversation = store.getConversationForRun(request.params.runId);
        if (!run || conversation.length === 0) {
          return reply.status(404).send(errorBody(request.id, "RUN_NOT_FOUND", "Run not found"));
        }
        if (activeRuns.has(run.id)) {
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

        const existing = store.getAssistantMessage(run.id);
        if (run.status === "cancelled") {
          sendEvent(reply, { type: "run.cancelled", data: { run_id: run.id } });
          reply.raw.end();
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
          reply.raw.end();
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
          reply.raw.end();
          return reply;
        }

        const assistant = store.startAssistantMessage(run.id);
        if (!assistant) {
          reply.raw.end();
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
        activeRuns.set(run.id, controller);
        const onAborted = (): void => controller.abort(new Error("Client disconnected"));
        const onClosed = (): void => {
          if (!reply.raw.writableEnded) onAborted();
        };
        request.raw.once("aborted", onAborted);
        reply.raw.once("close", onClosed);
        try {
          const modelRequest = manager.buildRequest({
            projectId: run.project_id,
            runId: run.id,
            messages: conversation
          });
          for await (const event of modelGateway.stream(modelRequest, controller.signal)) {
            if (event.type === "route.selected") {
              const reserved = store.reserveModelUsage(run.id, event.route);
              if (!reserved) {
                throw new GatewayRunError(
                  "ROUTE_UNAVAILABLE",
                  event.route.provider_id,
                  "Run cannot reserve the selected model route",
                  false
                );
              }
            } else if (event.type === "route.failed") {
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
          if (controller.signal.aborted || store.getRun(run.id)?.status === "cancelled") {
            store.cancelRun(run.id);
            if (!reply.raw.destroyed && !reply.raw.writableEnded) {
              sendEvent(reply, { type: "run.cancelled", data: { run_id: run.id } });
              reply.raw.end();
            }
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
          request.raw.off("aborted", onAborted);
          reply.raw.off("close", onClosed);
        }
        reply.raw.end();
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

  if (dependencies.closeDatabase) {
    app.addHook("onClose", () => dependencies.closeDatabase?.());
  }
  return app;
};
