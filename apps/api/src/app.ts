import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import type { ServerConfig } from "@nexus/config";
import type { ManagerService } from "@nexus/core";
import {
  ApiErrorSchema,
  CreateMessageRequestSchema,
  CreateProjectRequestSchema,
  HealthResponseSchema,
  MessageAcceptedResponseSchema,
  ModelRuntimeStatusSchema,
  ProjectDetailResponseSchema,
  ProjectListResponseSchema,
  type ApiError,
  type HealthResponse,
  type MessageAcceptedResponse,
  type ModelRuntimeStatus,
  type ProjectDetailResponse,
  type ProjectListResponse,
  type StreamEvent
} from "@nexus/contracts";
import type { DatabaseHealth, ProjectStore, StoredMessage } from "@nexus/db";
import { GatewayRunError, type ModelGateway } from "@nexus/model-gateway";
import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";

export interface AppDependencies {
  config: ServerConfig;
  database: DatabaseHealth;
  projectStore?: ProjectStore;
  modelGateway?: ModelGateway;
  manager?: ManagerService;
  closeDatabase?: () => void;
}

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
            redact: ["req.headers.authorization", "req.headers.cookie"]
          }
  }).withTypeProvider<TypeBoxTypeProvider>();

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
        provider: dependencies.config.modelProvider === "mock" ? "mock" : "primary",
        model: dependencies.config.modelName,
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
          response: { 201: MessageAcceptedResponseSchema, 200: MessageAcceptedResponseSchema }
        }
      },
      async (request, reply) => {
        const accepted = store.createProject(
          request.body.initial_message,
          request.body.client_message_id
        );
        return reply.status(accepted.duplicate ? 200 : 201).send(acceptedResponse(accepted));
      }
    );

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
            404: ApiErrorSchema
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

        reply.hijack();
        reply.raw.writeHead(200, {
          "cache-control": "no-cache, no-transform",
          connection: "keep-alive",
          "content-type": "text/event-stream; charset=utf-8",
          "x-accel-buffering": "no"
        });

        const existing = store.getAssistantMessage(run.id);
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
        let completed:
          | {
              provider: string;
              model: string;
              finishReason: string;
              usage?: { inputTokens: number; outputTokens: number };
            }
          | undefined;
        const controller = new AbortController();
        const onAborted = (): void => controller.abort(new Error("Client disconnected"));
        request.raw.once("aborted", onAborted);
        try {
          const modelRequest = manager.buildRequest({
            projectId: run.project_id,
            runId: run.id,
            messages: conversation
          });
          for await (const event of modelGateway.stream(modelRequest, controller.signal)) {
            if (event.type === "text.delta") {
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
          store.completeRun(run.id, completed.provider, completed.model, completed.usage);
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
          request.raw.off("aborted", onAborted);
        }
        reply.raw.end();
        return reply;
      }
    );
  }

  app.setErrorHandler((error, request, reply) => {
    if (typeof error === "object" && error !== null && "validation" in error) {
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
