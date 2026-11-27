import type { FastifyInstance, FastifyRequest } from "fastify";
import { Type } from "typebox";
import { TypeBoxValidatorCompiler } from "@fastify/type-provider-typebox";
import { createHash, createHmac } from "node:crypto";
import {
  DeveloperChatRequestSchema,
  DeveloperTaskRequestSchema,
  type DeveloperChatRequest,
  type DeveloperScope,
  type IdentityContext
} from "@cosmora/contracts";
import { DeveloperApiStore, DeveloperApiError } from "@cosmora/db";
import { runParallelRoute } from "./parallel-route.js";
import type { ModelGateway } from "@cosmora/model-gateway";
import type { ChatService } from "@cosmora/core";

export interface DeveloperApiDependencies {
  app: FastifyInstance;
  store: DeveloperApiStore;
  identityFor: (request: FastifyRequest) => IdentityContext;
  gateway: ModelGateway;
  chat: ChatService;
}

/** External v1 surface. Owners administer keys with session auth; client keys only use scopes. */
export function registerDeveloperApiRoutes(deps: DeveloperApiDependencies) {
  const { app, store, identityFor, gateway, chat } = deps;
  const activeStreams = new Map<string, AbortController>();
  const base = "/api/v1/developer/v1";
  app.register((routes) => {
    routes.setValidatorCompiler(TypeBoxValidatorCompiler);
    routes.setErrorHandler((error, request, reply) => {
      if (typeof error === "object" && error !== null && "validation" in error)
        return reply.code(400).send({ error: { code: "INVALID_REQUEST" } });
      if (error instanceof DeveloperApiError) {
        const status =
          error.code === "SCOPE_DENIED"
            ? 403
            : error.code === "TASK_CONFLICT"
              ? 409
              : error.code.startsWith("KEY_")
                ? 401
                : 400;
        return reply.code(status).send({
          error: { type: "developer_api_error", code: error.code, message: error.message }
        });
      }
      return reply
        .code(500)
        .send({ error: { type: "server_error", code: "INTERNAL", message: "Internal error" } });
    });
    routes.addHook("onSend", async (request, reply, payload) => {
      if (request.routeOptions.url?.startsWith(base))
        reply
          .header("Cache-Control", "private, no-store")
          .header("X-Content-Type-Options", "nosniff");
      return payload;
    });

    const scopes = (request: FastifyRequest, required: DeveloperScope) => {
      const identity = identityFor(request);
      const keyId = identity.actor_id;
      store.requireScope(keyId, required);
      return identity;
    };
    const ownerOnly = (request: FastifyRequest) => {
      const identity = identityFor(request);
      if (identity.actor_kind !== "owner" || identity.session_id.startsWith("developer:"))
        throw new DeveloperApiError("SCOPE_DENIED");
      return identity.owner_id;
    };

    routes.post(
      `${base}/keys`,
      {
        schema: {
          body: Type.Object({
            scopes: Type.Array(Type.String({ minLength: 1, maxLength: 64 }), {
              minItems: 1,
              maxItems: 7
            }),
            ttl_ms: Type.Optional(Type.Integer({ minimum: 1000, maximum: 7776000000 }))
          })
        }
      },
      (request) => {
        const owner = ownerOnly(request);
        const body = request.body as { scopes: string[]; ttl_ms?: number };
        return store.issue(owner, body.scopes as DeveloperScope[], body.ttl_ms ?? 3_600_000);
      }
    );
    routes.get(`${base}/keys`, (request) => ({ keys: store.list(ownerOnly(request)) }));
    routes.delete(
      `${base}/keys/:keyId`,
      { schema: { params: Type.Object({ keyId: Type.String() }) } },
      (request) => {
        const owner = ownerOnly(request);
        return store.revoke(owner, (request.params as { keyId: string }).keyId);
      }
    );

    routes.post(
      `${base}/chat/completions`,
      { schema: { body: DeveloperChatRequestSchema } },
      async (request, reply) => {
        scopes(request, "chat.write");
        const body = request.body as DeveloperChatRequest;
        const requestId =
          body.client_request_id ??
          "dchat_" + createHash("sha256").update(JSON.stringify(body)).digest("hex").slice(0, 24);
        const identity = identityFor(request);
        // Client request IDs are only unique within one key, never globally.
        const executionId =
          "developer_" +
          createHash("sha256")
            .update(JSON.stringify([identity.owner_id, identity.actor_id, requestId]))
            .digest("hex");
        const recordUsage = (usage: {
          request_id: string;
          model: string;
          input_tokens: number;
          output_tokens: number;
          first_token_ms?: number;
          total_ms?: number;
        }) => store.recordUsage(identity.owner_id, identity.actor_id, usage);
        const modelRequest = chat.buildRequest({
          chatId: "developer:" + identity.owner_id,
          runId: executionId,
          messages: []
        });
        modelRequest.messages = body.messages.map((m) => ({ role: m.role, content: m.content }));
        if (body.mode === "fast") modelRequest.routing.optimize_for = "latency";
        modelRequest.request_id = executionId;
        modelRequest.idempotency_key = executionId;

        if (body.stream) {
          if (activeStreams.has(executionId))
            return reply.code(409).send({ error: { code: "STREAM_CONFLICT" } });
          const controller = new AbortController();
          activeStreams.set(executionId, controller);
          const onClose = () => controller.abort();
          reply.raw.once("close", onClose);
          reply.hijack();
          reply.raw.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
            Connection: "keep-alive"
          });
          try {
            for await (const event of gateway.stream(modelRequest, controller.signal)) {
              if (controller.signal.aborted) break;
              if (event.type === "text.delta")
                reply.raw.write(
                  `event: message.delta\ndata: ${JSON.stringify({ delta: event.delta })}\n\n`
                );
              else if (event.type === "response.completed") {
                const usage = {
                  request_id: requestId,
                  model: event.model,
                  input_tokens: event.usage.inputTokens ?? 0,
                  output_tokens: event.usage.outputTokens ?? 0,
                  ...(event.timing ?? {})
                };
                if (!(await usageValid(usage))) continue;
                recordUsage(usage);
                reply.raw.write(`event: run.completed\ndata: ${JSON.stringify({ usage })}\n\n`);
              }
            }
          } catch {
            // The HTTP response is already streaming; never expose provider diagnostics.
            if (!controller.signal.aborted && !reply.raw.destroyed)
              reply.raw.write(
                'event: run.failed\ndata: {"error":{"code":"GENERATION_FAILED"}}\n\n'
              );
          } finally {
            if (controller.signal.aborted && !reply.raw.destroyed)
              reply.raw.write('event: run.cancelled\ndata: {"cancelled":true}\n\n');
            activeStreams.delete(executionId);
            reply.raw.off("close", onClose);
            reply.raw.end();
          }
          return reply;
        }
        if (body.mode === "parallel" && !body.stream) {
          const userText = body.messages.map((m) => m.content).join("\n");
          const parallel = await runParallelRoute({
            text: userText,
            signal: request.raw.aborted ? AbortSignal.abort() : new AbortController().signal,
            execute: async ({ prompt }) => {
              const partRequest = structuredClone(modelRequest);
              partRequest.messages = [{ role: "user", content: prompt }];
              let text = "";
              for await (const event of gateway.stream(partRequest)) {
                if (event.type === "text.delta") text += event.delta;
                else if (event.type === "response.completed") {
                  recordUsage({
                    request_id: requestId,
                    model: event.model,
                    input_tokens: event.usage.inputTokens ?? 0,
                    output_tokens: event.usage.outputTokens ?? 0,
                    ...(event.timing ?? {})
                  });
                }
              }
              const verdict = /RETRY/u.test(text) && /part-/u.test(text) ? "RETRY" : "PASS";
              return { text, verdict };
            }
          });
          if (parallel) {
            return {
              id: requestId,
              object: "chat.completion",
              model: body.model ?? "kosmora-parallel",
              choices: [
                {
                  index: 0,
                  message: { role: "assistant", content: parallel.answer },
                  finish_reason: "stop"
                }
              ],
              parallel: {
                parts: parallel.parts,
                review: parallel.review,
                total_ms: parallel.total_ms
              }
            };
          }
        }
        let answer = "";
        let usage: {
          request_id: string;
          model: string;
          input_tokens: number;
          output_tokens: number;
          first_token_ms?: number;
          total_ms?: number;
        } | null = null;
        for await (const event of gateway.stream(modelRequest)) {
          if (event.type === "text.delta") answer += event.delta;
          else if (event.type === "response.completed") {
            usage = {
              request_id: requestId,
              model: event.model,
              input_tokens: event.usage.inputTokens ?? 0,
              output_tokens: event.usage.outputTokens ?? 0,
              ...(event.timing ?? {})
            };
            recordUsage(usage);
          }
        }
        return {
          id: requestId,
          object: "chat.completion",
          model: body.model ?? "kosmora-default",
          choices: [
            { index: 0, message: { role: "assistant", content: answer }, finish_reason: "stop" }
          ],
          usage
        };
      }
    );

    routes.get(`${base}/usage`, (request) => {
      const identity = scopes(request, "chat.read");
      return { usage: store.listUsage(identity.owner_id) };
    });

    routes.post(
      `${base}/chat/completions/:requestId/cancel`,
      { schema: { params: Type.Object({ requestId: Type.String() }) } },
      (request, reply) => {
        const identity = scopes(request, "chat.write");
        const id = (request.params as { requestId: string }).requestId;
        const executionId =
          "developer_" +
          createHash("sha256")
            .update(JSON.stringify([identity.owner_id, identity.actor_id, id]))
            .digest("hex");
        const controller = activeStreams.get(executionId);
        if (!controller) return reply.code(404).send({ error: { code: "STREAM_NOT_FOUND" } });
        controller.abort();
        // The streaming handler releases the slot after the generator stops.
        return { request_id: id, cancelled: true };
      }
    );

    routes.post(
      `${base}/tasks`,
      { schema: { body: DeveloperTaskRequestSchema } },
      (request, reply) => {
        const identity = scopes(request, "tasks.write");
        const task = store.createTask(identity.owner_id, identity.actor_id, request.body);
        return reply.code(201).send(task);
      }
    );
    routes.get(`${base}/tasks`, (request) => {
      const identity = scopes(request, "tasks.read");
      return { tasks: store.listTasks(identity.owner_id) };
    });
    routes.get(
      `${base}/tasks/:taskId`,
      { schema: { params: Type.Object({ taskId: Type.String() }) } },
      (request) => {
        const identity = scopes(request, "tasks.read");
        return store.getTask(identity.owner_id, (request.params as { taskId: string }).taskId);
      }
    );
    routes.post(
      `${base}/tasks/:taskId/cancel`,
      { schema: { params: Type.Object({ taskId: Type.String() }) } },
      (request) => {
        const identity = scopes(request, "tasks.write");
        return store.setTaskStatus(
          identity.owner_id,
          (request.params as { taskId: string }).taskId,
          "cancelled"
        );
      }
    );

    routes.post(
      `${base}/webhooks`,
      {
        schema: {
          body: Type.Object({
            url: Type.String({ minLength: 8, maxLength: 2048 }),
            events: Type.Array(Type.String({ minLength: 1, maxLength: 64 }), {
              minItems: 1,
              maxItems: 20
            })
          })
        }
      },
      (request, reply) => {
        const identity = scopes(request, "webhooks.write");
        const body = request.body as { url: string; events: string[] };
        return reply.code(201).send(store.subscribe(identity.owner_id, body.url, body.events));
      }
    );
    routes.get(`${base}/webhooks`, (request) => {
      const identity = scopes(request, "webhooks.write");
      return { subscriptions: store.subscriptions(identity.owner_id) };
    });
    routes.delete(
      `${base}/webhooks/:webhookId`,
      { schema: { params: Type.Object({ webhookId: Type.String() }) } },
      (request) => {
        const identity = scopes(request, "webhooks.write");
        store.revokeWebhook(identity.owner_id, (request.params as { webhookId: string }).webhookId);
        return { ok: true };
      }
    );

    /** Verified inbound delivery receiver: HMAC over raw body, no owner identity required. */
    routes.post(
      `${base}/webhooks/receive/:webhookId`,
      { schema: { params: Type.Object({ webhookId: Type.String() }) } },
      (request, reply) => {
        const webhookId = (request.params as { webhookId: string }).webhookId;
        const key = store.signingKey(webhookId);
        const signature = request.headers["x-kosmora-signature"];
        if (!key || typeof signature !== "string")
          return reply.code(401).send({ error: { code: "INVALID_SIGNATURE" } });
        const raw = JSON.stringify(request.body ?? {});
        const expected = createHmac("sha256", key).update(raw).digest("hex");
        if (!DeveloperApiStore.safeEqual(signature, expected))
          return reply.code(401).send({ error: { code: "INVALID_SIGNATURE" } });
        const body = request.body as { event?: string; attempt?: number };
        if (!body?.event) return reply.code(400).send({ error: { code: "INVALID_REQUEST" } });
        const owner = store.ownerOfWebhook(webhookId);
        if (!owner) return reply.code(404).send({ error: { code: "WEBHOOK_NOT_FOUND" } });
        store.recordDelivery(owner, webhookId, body.event, body, body.attempt ?? 1);
        return { ok: true, event: body.event, attempt: body.attempt ?? 1 };
      }
    );
  });
}

async function usageValid(usage: unknown) {
  const { Value } = await import("typebox/value");
  const { DeveloperUsageSchema } = await import("@cosmora/contracts");
  return Value.Check(DeveloperUsageSchema, usage);
}
