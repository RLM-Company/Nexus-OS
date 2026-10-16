import { registerChatSkillRoutes } from "./chat-skill-routes.js";
import { registerChatWorkspaceRoutes } from "./chat-workspace-routes.js";
import { ContextTooLargeError } from "@cosmora/core";
import { TypeBoxValidatorCompiler, type TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import {
  ApiErrorSchema,
  ChatMemorySchema,
  UpdateChatMemorySchema,
  CreateChatBranchSchema,
  ChatBranchListSchema,
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
  ChatMemoryConflictError,
  ChatBranchValidationError,
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
import type { AccountStore } from "./account-settings/account-store.js";
import {
  QuotaExceededError,
  RelayExecution,
  RelayProtectionError,
  RelayUnavailableError
} from "./account-settings/relay-execution.js";

export type ActiveModelRun = {
  projectId: string | null;
  ownerId: string;
  controller: AbortController;
};

export interface GeneralChatRouteOptions {
  app: FastifyInstance;
  accountStore?: AccountStore;
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
  registerChatSkillRoutes(options.app, options.store.skills, (request) =>
    options.identityFor(request)
  );
  registerChatWorkspaceRoutes(options.app, options.store.workspace, (request) =>
    options.identityFor(request)
  );
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

  app.get(
    "/api/v1/chats/:chatId/branches",
    {
      schema: { params, response: { 200: ChatBranchListSchema, 404: ApiErrorSchema } }
    },
    (request, reply) => {
      reply.header("Cache-Control", "private, no-store");
      const family = options.store.listChatBranches(
        request.params.chatId,
        options.identityFor(request).owner_id
      );
      if (!family) {
        reply.code(404).send(error(request.id, "CHAT_NOT_FOUND", "Chat not found"));
        return;
      }
      return family;
    }
  );
  app.post(
    "/api/v1/chats/:chatId/branches",
    {
      validatorCompiler: TypeBoxValidatorCompiler,
      schema: {
        params,
        body: CreateChatBranchSchema,
        response: {
          200: GeneralChatMessageAcceptedResponseSchema,
          201: GeneralChatMessageAcceptedResponseSchema,
          400: ApiErrorSchema,
          404: ApiErrorSchema,
          409: ApiErrorSchema
        }
      }
    },
    (request, reply) => {
      reply.header("Cache-Control", "private, no-store");
      try {
        const accepted = options.store.createChatBranch(
          request.params.chatId,
          options.identityFor(request).owner_id,
          request.body
        );
        if (!accepted) {
          reply
            .code(404)
            .send(error(request.id, "CHAT_NOT_FOUND", "Чат или сообщение не найдено."));
          return;
        }
        reply.code(accepted.duplicate ? 200 : 201).send(acceptedResponse(accepted));
      } catch (cause) {
        if (cause instanceof GeneralChatBusyError) {
          reply
            .code(409)
            .send(
              error(request.id, "CONFLICT", "Остановите текущий ответ перед созданием варианта.")
            );
          return;
        }
        if (cause instanceof ChatBranchValidationError) {
          reply.code(400).send(error(request.id, "VALIDATION_ERROR", cause.message));
          return;
        }
        throw cause;
      }
    }
  );

  app.get(
    "/api/v1/chats/:chatId/memory",
    {
      schema: {
        params,
        response: { 200: Type.Object({ memory: ChatMemorySchema }), 404: ApiErrorSchema }
      }
    },
    (request, reply) => {
      reply.header("Cache-Control", "private, no-store");
      const memory = options.store.getChatMemory(
        request.params.chatId,
        options.identityFor(request).owner_id
      );
      if (!memory) {
        reply.code(404).send(error(request.id, "CHAT_NOT_FOUND", "Chat not found"));
        return;
      }
      return { memory };
    }
  );
  app.put(
    "/api/v1/chats/:chatId/memory",
    {
      validatorCompiler: TypeBoxValidatorCompiler,
      schema: {
        params,
        body: UpdateChatMemorySchema,
        response: {
          200: Type.Object({ memory: ChatMemorySchema }),
          404: ApiErrorSchema,
          409: ApiErrorSchema
        }
      }
    },
    (request, reply) => {
      reply.header("Cache-Control", "private, no-store");
      try {
        const memory = options.store.updateChatMemory(
          request.params.chatId,
          options.identityFor(request).owner_id,
          request.body.memory_notes,
          request.body.expected_version
        );
        if (!memory) {
          reply.code(404).send(error(request.id, "CHAT_NOT_FOUND", "Chat not found"));
          return;
        }
        return { memory };
      } catch (cause) {
        if (cause instanceof GeneralChatBusyError || cause instanceof ChatMemoryConflictError) {
          reply
            .code(409)
            .send(
              error(
                request.id,
                "CONFLICT",
                cause instanceof GeneralChatBusyError
                  ? "Остановите ответ перед изменением памяти чата."
                  : "Память чата изменена в другой вкладке. Загрузите сохранённую версию."
              )
            );
          return;
        }
        throw cause;
      }
    }
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
      const mainHolds = new Map<number, string>();
      try {
        let modelRequest = options.chat.buildRequest({
          chatId: run.chat_id,
          runId: run.id,
          messages: conversation,
          memoryNotes:
            options.store.getChatMemory(run.chat_id, identity.owner_id)?.memory_notes ?? "",
          skills: options.store.skills.forRun(run.id, identity.owner_id)?.items ?? []
        });
        const relay = options.accountStore
          ? new RelayExecution(options.accountStore, options.modelGateway)
          : null;
        if (
          options.accountStore?.getRelay(identity.owner_id, run.chat_id) &&
          conversation.some((message) => message.attachments?.length)
        )
          throw new RelayProtectionError(
            "Attachments are not translated without explicit format permission"
          );
        const prepared = relay
          ? await relay.prepare(
              identity.owner_id,
              run.chat_id,
              run.id,
              modelRequest,
              controller.signal
            )
          : { request: modelRequest, relay: false };
        modelRequest = prepared.request;
        let pendingEnglish = "";
        for await (const event of options.modelGateway.stream(modelRequest, controller.signal)) {
          if (event.type === "route.selected") {
            options.runtimeMetrics.routeSelected();
            if (options.accountStore) {
              const hold = options.accountStore.reserve(
                identity.owner_id,
                run.id,
                event.route.attempt,
                event.route.estimated_input_tokens + event.route.max_output_tokens,
                "main",
                run.chat_id,
                event.route.provider_id,
                event.route.model_id
              );
              mainHolds.set(event.route.attempt, hold);
            }
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
            const hold = mainHolds.get(event.route.attempt);
            if (hold) options.accountStore?.uncertainReservation(hold, "main");
          } else if (event.type === "text.delta") {
            if (prepared.relay) {
              pendingEnglish += event.delta;
              continue;
            }
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
          } else if (event.type === "response.completed") {
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
        if (prepared.relay) {
          if (!pendingEnglish.trim()) throw new RelayUnavailableError("Empty provider text");
          const translated = await relay!.finish(
            identity.owner_id,
            run.chat_id,
            run.id,
            modelRequest,
            pendingEnglish,
            controller.signal
          );
          options.store.appendAssistantDelta(assistant.id, translated);
          size += translated.length;
          sendEvent(reply, {
            type: "message.delta",
            data: { run_id: run.id, message_id: assistant.id, seq: sequence++, delta: translated }
          });
        }
        options.store.completeRun(run.id, completed.provider, completed.model, completed.usage, {
          attempt: completed.route.attempt,
          calculatedCost: completed.calculatedCost
        });
        const finalHold = mainHolds.get(completed.route.attempt);
        if (finalHold)
          options.accountStore?.completeReservation(
            finalHold,
            "main",
            completed.usage.inputTokens,
            completed.usage.outputTokens
          );
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
          if (
            cause instanceof RelayUnavailableError ||
            cause instanceof RelayProtectionError ||
            cause instanceof QuotaExceededError
          ) {
            const code =
              cause instanceof QuotaExceededError ? "USAGE_LIMIT_EXCEEDED" : "RELAY_UNAVAILABLE";
            options.store.failRun(run.id, code);
            options.runtimeMetrics.runFailed("PROVIDER_ERROR");
            sendEvent(reply, {
              type: "run.failed",
              data: { run_id: run.id, error_code: code, retryable: false }
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
        }
      } finally {
        for (const hold of mainHolds.values())
          options.accountStore?.uncertainReservation(hold, "main");
        options.activeRuns.delete(run.id);
      }
      end(reply);
      return reply;
    }
  );
};
