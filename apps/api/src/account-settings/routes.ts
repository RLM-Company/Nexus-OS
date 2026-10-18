import type { FastifyInstance, FastifyRequest } from "fastify";
import { TypeBoxValidatorCompiler } from "@fastify/type-provider-typebox";
import { Type } from "typebox";
import type { IdentityContext } from "@cosmora/contracts";
import {
  PreferenceConflictError,
  type AccountStore,
  type PreferenceUpdate
} from "./account-store.js";

const prefs = Type.Object(
  {
    expected_version: Type.Integer({ minimum: 0 }),
    relay_enabled: Type.Boolean(),
    response_language: Type.Union([Type.Literal("ru"), Type.Literal("en")]),
    optimize_for: Type.Union([
      Type.Literal("balanced"),
      Type.Literal("cost"),
      Type.Literal("latency"),
      Type.Literal("quality")
    ]),
    preferred_provider: Type.Union([Type.String({ maxLength: 128 }), Type.Null()]),
    preferred_model: Type.Union([Type.String({ maxLength: 256 }), Type.Null()]),
    chat_style: Type.Union([
      Type.Literal("standard"),
      Type.Literal("concise"),
      Type.Literal("detailed")
    ]),
    max_total_tokens: Type.Union([Type.Integer({ minimum: 1, maximum: 2000000000 }), Type.Null()])
  },
  { additionalProperties: false }
);
const param = Type.Object({ chatId: Type.String({ minLength: 1, maxLength: 128 }) });
const replyError = (message: string) => ({ error: { code: "VALIDATION_ERROR", message } });
export function registerAccountRoutes(
  app: FastifyInstance,
  store: AccountStore,
  identityFor: (request: FastifyRequest) => IdentityContext,
  model: { provider: string; model: string; capabilities: Record<string, boolean> }
): void {
  const supportedEfforts = /^(gpt-[56]|o[1-9])/i.test(model.model) ? ["low", "medium", "high"] : [];
  app.put(
    "/api/v1/personal-settings/reasoning",
    {
      validatorCompiler: TypeBoxValidatorCompiler,
      schema: {
        body: Type.Object(
          {
            effort: Type.Union([
              Type.Null(),
              Type.Literal("low"),
              Type.Literal("medium"),
              Type.Literal("high")
            ])
          },
          { additionalProperties: false }
        )
      }
    },
    async (request, reply) => {
      const { effort } = request.body as { effort: "low" | "medium" | "high" | null };
      if (effort !== null && !supportedEfforts.includes(effort))
        return reply.code(400).send(replyError("Selected model does not support reasoning effort"));
      store.setReasoning(identityFor(request).owner_id, effort);
      return { effort, supported_efforts: supportedEfforts };
    }
  );
  app.get("/api/v1/personal-settings", (request) =>
    Promise.resolve({
      settings: store.get(identityFor(request).owner_id),
      available_models: [model],
      relay_default: false,
      reasoning: {
        effort: store.getReasoning(identityFor(request).owner_id),
        supported_efforts: supportedEfforts
      }
    })
  );
  app.put(
    "/api/v1/personal-settings",
    { schema: { body: prefs }, validatorCompiler: TypeBoxValidatorCompiler },
    async (request, reply) => {
      const owner = identityFor(request).owner_id;
      const body = request.body as PreferenceUpdate;
      if (
        (body.preferred_provider !== null && body.preferred_provider !== model.provider) ||
        (body.preferred_model !== null && body.preferred_model !== model.model) ||
        Boolean(body.preferred_model) !== Boolean(body.preferred_provider)
      )
        return reply
          .status(400)
          .send(replyError("Only verified, configured model routes are selectable"));
      try {
        return { settings: store.update(owner, body) };
      } catch (e) {
        if (e instanceof PreferenceConflictError)
          return reply.status(409).send(replyError("Settings were updated elsewhere"));
        throw e;
      }
    }
  );
  app.get(
    "/api/v1/personal-settings/chats/:chatId",
    { schema: { params: param } },
    async (request, reply) => {
      const { chatId } = request.params as { chatId: string };
      const owner = identityFor(request).owner_id;
      if (
        !store.sqlite
          .prepare("SELECT 1 FROM general_chats WHERE id=? AND owner_id=?")
          .get(chatId, owner)
      )
        return reply.status(404).send(replyError("Chat not found"));
      return {
        relay_enabled: store.getRelay(owner, chatId),
        override: store.chatRelayOverride(owner, chatId)
      };
    }
  );
  app.put(
    "/api/v1/personal-settings/chats/:chatId",
    {
      validatorCompiler: TypeBoxValidatorCompiler,
      schema: {
        params: param,
        body: Type.Object(
          { relay_enabled: Type.Union([Type.Boolean(), Type.Null()]) },
          { additionalProperties: false }
        )
      }
    },
    async (request, reply) => {
      const owner = identityFor(request).owner_id;
      const { chatId } = request.params as { chatId: string };
      if (
        !store.sqlite
          .prepare("SELECT 1 FROM general_chats WHERE id=? AND owner_id=?")
          .get(chatId, owner)
      )
        return reply.status(404).send(replyError("Chat not found"));
      store.setChatRelay(
        owner,
        chatId,
        (request.body as { relay_enabled: boolean | null }).relay_enabled
      );
      return {
        relay_enabled: store.getRelay(owner, chatId),
        override: store.chatRelayOverride(owner, chatId)
      };
    }
  );
  app.get("/api/v1/personal-settings/usage", (request) =>
    Promise.resolve(store.usage(identityFor(request).owner_id))
  );
}
