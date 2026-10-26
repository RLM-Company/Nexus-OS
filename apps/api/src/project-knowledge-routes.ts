import { Type } from "typebox";
import { TypeBoxValidatorCompiler } from "@fastify/type-provider-typebox";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { IdentityContext } from "@cosmora/contracts";
import type { KnowledgeKind, KnowledgeHit } from "@cosmora/core";
import type {
  ProjectStore,
  CanvasArtifactStore,
  ManagerWorkStore,
  DocumentLibraryStore
} from "@cosmora/db";
import {
  ProjectKnowledge,
  ProjectKnowledgeError,
  KnowledgeSearchError
} from "./project-knowledge.js";
export function registerProjectKnowledgeRoutes(
  app: FastifyInstance,
  stores: {
    projects: ProjectStore;
    canvas?: CanvasArtifactStore;
    work?: ManagerWorkStore;
    documents?: DocumentLibraryStore;
  },
  identityFor: (request: FastifyRequest) => IdentityContext
) {
  const service = new ProjectKnowledge(stores),
    base = "/api/v1/projects/:projectId/knowledge";
  const id = Type.String({ minLength: 1, maxLength: 128 }),
    hash = Type.String({ pattern: "^[a-f0-9]{64}$" });
  const params = Type.Object({ projectId: id }, { additionalProperties: false });
  const kind = Type.Union([
    Type.Literal("canvas"),
    Type.Literal("work"),
    Type.Literal("memory"),
    Type.Literal("document")
  ]);
  const offsets = {
    start: Type.Integer({ minimum: 0, maximum: 16_000_000 }),
    end: Type.Integer({ minimum: 1, maximum: 16_000_000 }),
    excerpt_sha256: hash
  };
  const reference = Type.Union([
    Type.Object(
      {
        kind: Type.Union([Type.Literal("canvas"), Type.Literal("work"), Type.Literal("memory")]),
        id,
        version: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
        sha256: hash,
        ...offsets
      },
      { additionalProperties: false }
    ),
    Type.Object(
      {
        kind: Type.Literal("document"),
        id,
        version: Type.Null(),
        sha256: hash,
        chunk_id: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
        ...offsets
      },
      { additionalProperties: false }
    )
  ]);
  app.addHook("onSend", async (request, reply, payload) => {
    if (request.routeOptions.url?.startsWith(base))
      reply
        .header("cache-control", "private, no-store")
        .header("x-content-type-options", "nosniff");
    return payload;
  });
  const failure = (reply: { code(n: number): { send(v: unknown): unknown } }, error: unknown) => {
    if (!(error instanceof ProjectKnowledgeError) && !(error instanceof KnowledgeSearchError))
      throw error;
    return reply
      .code(
        error.message.endsWith("NOT_FOUND")
          ? 404
          : /CONFLICT|CORRUPT/.test(error.message)
            ? 409
            : error.message.endsWith("LIMIT")
              ? 413
              : 400
      )
      .send({ error: { code: error.message } });
  };
  app.post<{
    Params: { projectId: string };
    Body: { query: string; kinds?: KnowledgeKind[]; limit?: number };
  }>(
    base + "/search",
    {
      bodyLimit: 4096,
      validatorCompiler: TypeBoxValidatorCompiler,
      schema: {
        params,
        body: Type.Object(
          {
            query: Type.String({ minLength: 2, maxLength: 200 }),
            kinds: Type.Optional(Type.Array(kind, { minItems: 1, maxItems: 4, uniqueItems: true })),
            limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 30 }))
          },
          { additionalProperties: false }
        )
      }
    },
    (req, reply) => {
      const owner = identityFor(req).owner_id;
      if (!stores.projects.getProject(req.params.projectId, owner))
        return reply.code(404).send({ error: { code: "PROJECT_NOT_FOUND" } });
      try {
        return service.search(
          req.params.projectId,
          owner,
          req.body.query,
          req.body.kinds,
          req.body.limit
        );
      } catch (error) {
        return failure(reply, error);
      }
    }
  );
  app.post<{ Params: { projectId: string }; Body: { references: KnowledgeHit["reference"][] } }>(
    base + "/context",
    {
      bodyLimit: 8192,
      validatorCompiler: TypeBoxValidatorCompiler,
      schema: {
        params,
        body: Type.Object(
          { references: Type.Array(reference, { minItems: 1, maxItems: 6 }) },
          { additionalProperties: false }
        )
      }
    },
    (req, reply) => {
      const owner = identityFor(req).owner_id;
      if (!stores.projects.getProject(req.params.projectId, owner))
        return reply.code(404).send({ error: { code: "PROJECT_NOT_FOUND" } });
      try {
        return service.context(req.params.projectId, owner, req.body.references);
      } catch (error) {
        return failure(reply, error);
      }
    }
  );
}
