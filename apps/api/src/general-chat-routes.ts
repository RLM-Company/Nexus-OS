import { ContextTooLargeError } from "@cosmora/core";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import {
  ApiErrorSchema,
  CreateGeneralChatRequestSchema,
  CreateGeneralChatMessageRequestSchema,
  isValidChatAttachments,
  GeneralChatDetailResponseSchema,
  GeneralChatListResponseSchema,
  GeneralChatMessageAcceptedResponseSchema,
  RunCancelResponseSchema,
  type GeneralChatMessageAcceptedResponse,
  type IdentityContext,
  type ApiError,
  type StreamEvent
} from "@cosmora/contracts";
import type { ChatService } from "@cosmora/core";
import {
  GeneralChatBusyError,
  type EmergencyStopStore,
  type GeneralChatStore,
  type StoredGeneralChatMessage,
  type StoredGeneralChatRun
} from "@cosmora/db";
import {
  GatewayRunError,
  type ModelGateway,
  type ModelGatewayStreamEvent
} from "@cosmora/model-gateway";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { Type } from "typebox";
import { EmergencyStopActivatedError, type RuntimeMetrics } from "./operations.js";

export type ActiveModelRun = {
  projectId: string | null;
  ownerId: string;
  controller: AbortController;
};

export interface GeneralChatRouteOptions {
  app: FastifyInstance;
  store: GeneralChatStore;
  modelGateway: ModelGateway;
  chat: ChatService;
  runtimeMetrics: RuntimeMetrics;
  activeRuns: Map<string, ActiveModelRun>;
  runObservers: Set<AbortController>;
  runExecutionMode?: "stream" | "background";
  identityFor(request: FastifyRequest): IdentityContext;
  emergencyStopStore?: EmergencyStopStore;
}

const error = (
  requestId: string,
  code: ApiError["error"]["code"],
  message: string,
  retryable = false
): ApiError => ({
  error: { code, message, request_id: requestId, retryable }
});

const acceptedResponse = (
  accepted: NonNullable<ReturnType<GeneralChatStore["createMessage"]>>
): GeneralChatMessageAcceptedResponse => ({
  chat: accepted.chat,
  user_message: accepted.userMessage,
  run_id: accepted.run.id,
  stream_url: `/api/v1/chat-runs/${accepted.run.id}/events`
});

const sendEvent = (reply: FastifyReply, event: StreamEvent): void => {
  if (reply.raw.destroyed || reply.raw.writableEnded) return;
  reply.raw.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
};

const end = (reply: FastifyReply): void => {
  if (!reply.raw.destroyed && !reply.raw.writableEnded) reply.raw.end();
};

const replay = (
  reply: FastifyReply,
  runId: string,
  message: StoredGeneralChatMessage,
  provider: string,
  model: string
): void => {
  sendEvent(reply, {
    type: "run.started",
    data: { run_id: runId, timestamp: new Date().toISOString() }
  });
  sendEvent(reply, {
    type: "message.started",
    data: { run_id: runId, message_id: message.id }
  });
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
  store: GeneralChatStore,
  initialRun: StoredGeneralChatRun,
  ownerId: string,
  signal: AbortSignal
): Promise<void> => {
  let observedMessageId: string | null = null;
  let sentLength = 0;
  let sequence = 0;

  const observeMessage = (run: StoredGeneralChatRun, message: StoredGeneralChatMessage): void => {
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
        replay(reply, run.id, message, run.provider ?? "unknown", run.model_resolved ?? "unknown");
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

export const registerGeneralChatRoutes = (options: GeneralChatRouteOptions): void => {
  const app = options.app.withTypeProvider<TypeBoxTypeProvider>();
  const runsExecuteInBackground = options.runExecutionMode === "background";
  const params = Type.Object(
    { chatId: Type.String({ minLength: 1 }) },
    { additionalProperties: false }
  );
  const runParams = Type.Object(
    { runId: Type.String({ minLength: 1 }) },
    { additionalProperties: false }
  );

  app.patch(
    "/api/v1/chats/:chatId",
    {
      schema: {
        params,
        body: Type.Object(
          {
            title: Type.Optional(Type.String({ minLength: 1, maxLength: 160, pattern: "\\S" })),
            archived: Type.Optional(Type.Boolean())
          },
          { additionalProperties: false, minProperties: 1 }
        )
      }
    },
    async (request, reply) => {
      try {
        const chat = options.store.updateChat(
          request.params.chatId,
          options.identityFor(request).owner_id,
          request.body
        );
        return chat
          ? { chat }
          : reply.code(404).send(error(request.id, "CHAT_NOT_FOUND", "Chat not found"));
      } catch (cause) {
        if (cause instanceof GeneralChatBusyError)
          return reply
            .code(409)
            .send(
              error(
                request.id,
                "VALIDATION_ERROR",
                "Остановите ответ перед переносом чата в архив."
              )
            );
        throw cause;
      }
    }
  );

  app.get(
    "/api/v1/chats",
    {
      schema: {
        querystring: Type.Object(
          { archived: Type.Optional(Type.Boolean({ default: false })) },
          { additionalProperties: false }
        ),
        response: { 200: GeneralChatListResponseSchema }
      }
    },
    (request) => ({
      items: options.store.listChats(options.identityFor(request).owner_id, request.query.archived)
    })
  );

  app.post(
    "/api/v1/chats",
    {
      schema: {
        body: CreateGeneralChatRequestSchema,
        response: {
          200: GeneralChatMessageAcceptedResponseSchema,
          201: GeneralChatMessageAcceptedResponseSchema,
          400: ApiErrorSchema,
          409: ApiErrorSchema
        }
      }
    },
    async (request, reply) => {
      if (!isValidChatAttachments(request.body.attachments ?? [])) {
        return reply
          .status(400)
          .send(error(request.id, "VALIDATION_ERROR", "Invalid text attachments"));
      }
      const accepted = options.store.createChat(
        request.body.initial_message,
        request.body.client_message_id,
        options.identityFor(request).owner_id,
        request.body.attachments
      );
      return reply.status(accepted.duplicate ? 200 : 201).send(acceptedResponse(accepted));
    }
  );

  app.get(
    "/api/v1/chats/:chatId",
    {
      schema: {
        params,
        response: { 200: GeneralChatDetailResponseSchema, 404: ApiErrorSchema }
      }
    },
    async (request, reply) => {
      const ownerId = options.identityFor(request).owner_id;
      const chat = options.store.getChat(request.params.chatId, ownerId);
      if (!chat) {
        return reply.status(404).send(error(request.id, "CHAT_NOT_FOUND", "Chat not found"));
      }
      return { chat, messages: options.store.listMessages(chat.id, ownerId) };
    }
  );

  app.post(
    "/api/v1/chats/:chatId/messages",
    {
      schema: {
        params,
        body: CreateGeneralChatMessageRequestSchema,
        response: {
          200: GeneralChatMessageAcceptedResponseSchema,
          202: GeneralChatMessageAcceptedResponseSchema,
          400: ApiErrorSchema,
          404: ApiErrorSchema,
          409: ApiErrorSchema
        }
      }
    },
    async (request, reply) => {
      if (!isValidChatAttachments(request.body.attachments ?? [])) {
        return reply
          .status(400)
          .send(error(request.id, "VALIDATION_ERROR", "Invalid text attachments"));
      }
      try {
        const accepted = options.store.createMessage(
          request.params.chatId,
          request.body.content,
          request.body.client_message_id,
          options.identityFor(request).owner_id,
          request.body.attachments
        );
        if (!accepted) {
          return reply.status(404).send(error(request.id, "CHAT_NOT_FOUND", "Chat not found"));
        }
        return reply.status(accepted.duplicate ? 200 : 202).send(acceptedResponse(accepted));
      } catch (cause) {
        if (cause instanceof GeneralChatBusyError) {
          return reply
            .status(409)
            .send(error(request.id, "CONFLICT", "Wait for the current chat response to finish"));
        }
        throw cause;
      }
    }
  );

  app.post(
    "/api/v1/chat-runs/:runId/cancel",
    {
      schema: {
        params: runParams,
        response: { 200: RunCancelResponseSchema, 404: ApiErrorSchema, 409: ApiErrorSchema }
      }
    },
    async (request, reply) => {
      const cancelled = options.store.cancelRun(
        request.params.runId,
        options.identityFor(request).owner_id
      );
      if (cancelled === null) {
        return reply.status(404).send(error(request.id, "RUN_NOT_FOUND", "Run not found"));
      }
      if (cancelled === "finished") {
        return reply
          .status(409)
          .send(error(request.id, "RUN_ALREADY_FINISHED", "Run is already finished"));
      }
      options.activeRuns
        .get(request.params.runId)
        ?.controller.abort(new Error("Run was cancelled by the owner"));
      return { run_id: request.params.runId, status: "cancelled" as const };
    }
  );

  app.get(
    "/api/v1/chat-runs/:runId/events",
    { schema: { params: runParams } },
    async (request, reply) => {
      const identity = options.identityFor(request);
      const run = options.store.getRun(request.params.runId, identity.owner_id);
      const conversation = options.store.getConversationForRun(
        request.params.runId,
        identity.owner_id
      );
      if (!run || conversation.length === 0) {
        return reply.status(404).send(error(request.id, "RUN_NOT_FOUND", "Run not found"));
      }
      if (!runsExecuteInBackground && options.activeRuns.has(run.id)) {
        return reply.status(409).send(error(request.id, "CONFLICT", "Run is already streaming"));
      }

      reply.hijack();
      reply.raw.writeHead(200, {
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "content-type": "text/event-stream; charset=utf-8",
        "x-accel-buffering": "no"
      });
      reply.raw.write(": connected\n\n");

      const existing = options.store.getAssistantMessage(run.id, identity.owner_id);
      if (run.status === "cancelled") {
        sendEvent(reply, { type: "run.cancelled", data: { run_id: run.id } });
        end(reply);
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
        end(reply);
        return reply;
      }
      if (run.status === "succeeded" && existing) {
        replay(reply, run.id, existing, run.provider ?? "unknown", run.model_resolved ?? "unknown");
        end(reply);
        return reply;
      }

      if (runsExecuteInBackground) {
        const observer = new AbortController();
        const stopObserving = (): void => observer.abort();
        options.runObservers.add(observer);
        reply.raw.once("close", stopObserving);
        try {
          await observePersistedRun(reply, options.store, run, identity.owner_id, observer.signal);
        } finally {
          reply.raw.off("close", stopObserving);
          options.runObservers.delete(observer);
        }
        end(reply);
        return reply;
      }

      if (options.emergencyStopStore?.getProcessStop()) {
        options.store.startAssistantMessage(run.id, identity.owner_id);
        options.store.failRun(run.id, "EMERGENCY_STOP");
        options.runtimeMetrics.runFailed("EMERGENCY_STOP");
        sendEvent(reply, {
          type: "run.failed",
          data: { run_id: run.id, error_code: "EMERGENCY_STOP", retryable: false }
        });
        end(reply);
        return reply;
      }

      const assistant = options.store.startAssistantMessage(run.id, identity.owner_id);
      if (!assistant) {
        end(reply);
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
      let size = 0;
      let completed: Extract<ModelGatewayStreamEvent, { type: "response.completed" }> | undefined;
      const controller = new AbortController();
      options.activeRuns.set(run.id, {
        projectId: null,
        ownerId: identity.owner_id,
        controller
      });
      options.runtimeMetrics.runStarted();
      try {
        const modelRequest = options.chat.buildRequest({
          chatId: run.chat_id,
          runId: run.id,
          messages: conversation
        });
        for await (const event of options.modelGateway.stream(modelRequest, controller.signal)) {
          if (event.type === "route.selected") {
            options.runtimeMetrics.routeSelected();
            const reserved = options.store.reserveModelUsage(
              run.id,
              event.route,
              identity.owner_id
            );
            if (!reserved) {
              throw new GatewayRunError(
                "ROUTE_UNAVAILABLE",
                event.route.provider_id,
                "Chat run cannot reserve the selected model route",
                false
              );
            }
          } else if (event.type === "route.failed") {
            options.runtimeMetrics.routeFailed(event.errorCode);
            options.store.failModelUsage(run.id, event.route.attempt, event.errorCode);
          } else if (event.type === "text.delta") {
            options.store.appendAssistantDelta(assistant.id, event.delta);
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
        options.store.completeRun(run.id, completed.provider, completed.model, completed.usage, {
          attempt: completed.route.attempt,
          calculatedCost: completed.calculatedCost
        });
        options.runtimeMetrics.runCompleted();
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
      } catch (cause) {
        if (controller.signal.reason instanceof EmergencyStopActivatedError) {
          options.store.failRun(run.id, "EMERGENCY_STOP");
          options.runtimeMetrics.runFailed("EMERGENCY_STOP");
          sendEvent(reply, {
            type: "run.failed",
            data: { run_id: run.id, error_code: "EMERGENCY_STOP", retryable: false }
          });
        } else if (options.store.getRun(run.id, identity.owner_id)?.status === "cancelled") {
          options.runtimeMetrics.runCancelled();
          sendEvent(reply, { type: "run.cancelled", data: { run_id: run.id } });
        } else if (controller.signal.aborted) {
          options.store.failRun(run.id, "INTERRUPTED");
          options.runtimeMetrics.runFailed("INTERRUPTED");
          sendEvent(reply, {
            type: "run.failed",
            data: { run_id: run.id, error_code: "INTERRUPTED", retryable: true }
          });
        } else {
          const gatewayError =
            cause instanceof ContextTooLargeError
              ? new GatewayRunError("CONTEXT_TOO_LARGE", "gateway", cause.message, false)
              : cause instanceof GatewayRunError
                ? cause
                : new GatewayRunError("PROVIDER_ERROR", "gateway", "Model gateway failed", true, {
                    cause
                  });
          options.store.failRun(run.id, gatewayError.code);
          options.runtimeMetrics.runFailed(gatewayError.code);
          sendEvent(reply, {
            type: "run.failed",
            data: {
              run_id: run.id,
              error_code: gatewayError.code,
              retryable: gatewayError.retryable
            }
          });
        }
      } finally {
        options.activeRuns.delete(run.id);
      }
      end(reply);
      return reply;
    }
  );
};
