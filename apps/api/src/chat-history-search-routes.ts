import type { FastifyInstance, FastifyRequest } from "fastify";
import { Type } from "typebox";
import type { ChatHistorySearchStore } from "@cosmora/db";
import type { IdentityContext } from "@cosmora/contracts";

const Query = Type.Object({
  q: Type.String({ minLength: 1, maxLength: 160, pattern: "\\S" }),
  scope: Type.Optional(
    Type.Union([Type.Literal("all"), Type.Literal("general"), Type.Literal("project")])
  ),
  archive: Type.Optional(
    Type.Union([Type.Literal("active"), Type.Literal("archived"), Type.Literal("all")])
  ),
  project: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
  after: Type.Optional(Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" })),
  before: Type.Optional(Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 30 })),
  offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 1000 }))
});

/** Register after the existing owner-only authentication hook. No separate auth path. */
export function registerChatHistorySearchRoutes(
  app: FastifyInstance,
  store: ChatHistorySearchStore,
  identityFor: (request: FastifyRequest) => IdentityContext
): void {
  app.get("/api/v1/chat-history/search", { schema: { querystring: Query } }, (request) => {
    const q = request.query as {
      q: string;
      scope?: "all" | "general" | "project";
      archive?: "active" | "archived" | "all";
      project?: string;
      after?: string;
      before?: string;
      limit?: number;
      offset?: number;
    };
    return store.search({
      query: q.q,
      ownerId: identityFor(request).owner_id,
      ...(q.scope !== undefined ? { scope: q.scope } : {}),
      ...(q.archive !== undefined ? { archive: q.archive } : {}),
      ...(q.project !== undefined ? { projectId: q.project } : {}),
      ...(q.after !== undefined ? { after: q.after } : {}),
      ...(q.before !== undefined ? { before: q.before } : {}),
      ...(q.limit !== undefined ? { limit: q.limit } : {}),
      ...(q.offset !== undefined ? { offset: q.offset } : {})
    });
  });
}
