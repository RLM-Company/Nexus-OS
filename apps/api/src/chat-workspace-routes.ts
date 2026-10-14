import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { Type } from "typebox";
import { TypeBoxValidatorCompiler, type TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { ChatWorkspaceError, type ChatWorkspaceStore } from "@cosmora/db";
import type { IdentityContext } from "@cosmora/contracts";

export function registerChatWorkspaceRoutes(
  app: FastifyInstance,
  store: ChatWorkspaceStore,
  identityFor: (r: FastifyRequest) => IdentityContext
) {
  const typed = app.withTypeProvider<TypeBoxTypeProvider>();
  const id = Type.String({ minLength: 1, maxLength: 160 });
  const uuid = Type.String({
    pattern:
      "^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-4[a-fA-F0-9]{3}-[89abAB][a-fA-F0-9]{3}-[a-fA-F0-9]{12}$"
  });
  const chatParams = Type.Object({ chatId: id }, { additionalProperties: false });
  const excluded = Type.Array(id, { maxItems: 500, uniqueItems: true });
  const handle = (reply: FastifyReply, fn: () => unknown) => {
    reply.header("Cache-Control", "private, no-store");
    try {
      return fn();
    } catch (error) {
      if (error instanceof ChatWorkspaceError)
        return reply.code(error.status).send({
          error: {
            code:
              error.status === 404
                ? "CHAT_NOT_FOUND"
                : error.status === 409
                  ? "CONFLICT"
                  : "VALIDATION_ERROR",
            message: error.message
          }
        });
      throw error;
    }
  };
  const owner = (r: FastifyRequest) => identityFor(r).owner_id;
  typed.get("/api/v1/chat-navigation", (r, reply) =>
    handle(reply, () => store.navigation(owner(r)))
  );
  typed.post(
    "/api/v1/chat-navigation/import-pins",
    {
      validatorCompiler: TypeBoxValidatorCompiler,
      schema: {
        body: Type.Object(
          {
            chats: Type.Array(id, { maxItems: 100, uniqueItems: true }),
            projects: Type.Array(id, { maxItems: 100, uniqueItems: true })
          },
          { additionalProperties: false }
        )
      }
    },
    (r, reply) => handle(reply, () => store.importPins(owner(r), r.body))
  );
  typed.put(
    "/api/v1/chat-navigation/pins/:kind/:id",
    {
      validatorCompiler: TypeBoxValidatorCompiler,
      schema: {
        params: Type.Object(
          { kind: Type.Union([Type.Literal("chats"), Type.Literal("projects")]), id },
          { additionalProperties: false }
        ),
        body: Type.Object({ pinned: Type.Boolean() }, { additionalProperties: false })
      }
    },
    (r, reply) =>
      handle(reply, () => store.pin(owner(r), r.params.kind, r.params.id, r.body.pinned))
  );
  typed.put(
    "/api/v1/chat-navigation/folders/:id",
    {
      validatorCompiler: TypeBoxValidatorCompiler,
      schema: {
        params: Type.Object({ id: uuid }, { additionalProperties: false }),
        body: Type.Object(
          { title: Type.String({ minLength: 1, maxLength: 80, pattern: "\\S" }) },
          { additionalProperties: false }
        )
      }
    },
    (r, reply) => handle(reply, () => store.folder(owner(r), r.params.id, r.body.title))
  );
  typed.delete(
    "/api/v1/chat-navigation/folders/:id",
    { schema: { params: Type.Object({ id: uuid }, { additionalProperties: false }) } },
    (r, reply) => handle(reply, () => store.removeFolder(owner(r), r.params.id))
  );
  typed.put(
    "/api/v1/chats/:chatId/folder",
    {
      validatorCompiler: TypeBoxValidatorCompiler,
      schema: {
        params: chatParams,
        body: Type.Object(
          { folder_id: Type.Union([id, Type.Null()]) },
          { additionalProperties: false }
        )
      }
    },
    (r, reply) => handle(reply, () => store.assign(owner(r), r.params.chatId, r.body.folder_id))
  );
  typed.get("/api/v1/chats/:chatId/context", { schema: { params: chatParams } }, (r, reply) =>
    handle(reply, () => ({ context: store.context(r.params.chatId, owner(r)) }))
  );
  typed.put(
    "/api/v1/chats/:chatId/context",
    {
      validatorCompiler: TypeBoxValidatorCompiler,
      schema: {
        params: chatParams,
        body: Type.Object(
          {
            expected_version: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER - 1 }),
            excluded_ids: excluded,
            summary: Type.String({ maxLength: 8000 }),
            summary_through: Type.Union([id, Type.Null()])
          },
          { additionalProperties: false }
        )
      }
    },
    (r, reply) =>
      handle(reply, () => ({ context: store.updateContext(r.params.chatId, owner(r), r.body) }))
  );
  typed.post(
    "/api/v1/chats/:chatId/context/draft",
    {
      validatorCompiler: TypeBoxValidatorCompiler,
      schema: {
        params: chatParams,
        body: Type.Object({ excluded_ids: excluded }, { additionalProperties: false })
      }
    },
    (r, reply) =>
      handle(reply, () => store.summaryDraft(r.params.chatId, owner(r), r.body.excluded_ids))
  );
}
