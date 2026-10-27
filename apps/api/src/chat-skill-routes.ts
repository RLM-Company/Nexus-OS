import type { FastifyInstance, FastifyRequest } from "fastify";
import { Type } from "typebox";
import { TypeBoxValidatorCompiler, type TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { ChatSkillError, type ChatSkillStore } from "@cosmora/db";
import { UpdateChatSkillsSchema, type IdentityContext } from "@cosmora/contracts";

export function registerChatSkillRoutes(
  app: FastifyInstance,
  store: ChatSkillStore,
  identityFor: (r: FastifyRequest) => IdentityContext
) {
  const typed = app.withTypeProvider<TypeBoxTypeProvider>();
  const params = Type.Object(
    { chatId: Type.String({ minLength: 1, maxLength: 160 }) },
    { additionalProperties: false }
  );
  const runParams = Type.Object(
    { runId: Type.String({ minLength: 1, maxLength: 160 }) },
    { additionalProperties: false }
  );
  typed.get("/api/v1/chats/:chatId/skills", { schema: { params } }, (r, reply) => {
    reply.header("Cache-Control", "private, no-store");
    try {
      return { selection: store.get(r.params.chatId, identityFor(r).owner_id) };
    } catch (e) {
      if (e instanceof ChatSkillError)
        return reply.code(e.status).send({ error: { code: "CHAT_NOT_FOUND", message: e.message } });
      throw e;
    }
  });
  typed.put(
    "/api/v1/chats/:chatId/skills",
    {
      validatorCompiler: TypeBoxValidatorCompiler,
      schema: { params, body: UpdateChatSkillsSchema }
    },
    (r, reply) => {
      reply.header("Cache-Control", "private, no-store");
      try {
        return {
          selection: store.update(
            r.params.chatId,
            identityFor(r).owner_id,
            r.body.expected_version,
            r.body.items
          )
        };
      } catch (e) {
        if (e instanceof ChatSkillError)
          return reply.code(e.status).send({
            error: {
              code:
                e.status === 409
                  ? "CONFLICT"
                  : e.status === 404
                    ? "CHAT_NOT_FOUND"
                    : "VALIDATION_ERROR",
              message: e.message
            }
          });
        throw e;
      }
    }
  );
  typed.get("/api/v1/chat-runs/:runId/skills", { schema: { params: runParams } }, (r, reply) => {
    reply.header("Cache-Control", "private, no-store");
    const snapshot = store.forRun(r.params.runId, identityFor(r).owner_id);
    return snapshot
      ? { snapshot }
      : reply.code(404).send({ error: { code: "RUN_NOT_FOUND", message: "Ответ не найден." } });
  });
}
