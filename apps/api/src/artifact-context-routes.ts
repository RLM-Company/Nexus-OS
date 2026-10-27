import { Type } from "typebox";
import { TypeBoxValidatorCompiler } from "@fastify/type-provider-typebox";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { IdentityContext } from "@cosmora/contracts";
import type {
  ArtifactContextRequest,
  ArtifactContextSource
} from "@cosmora/contracts/artifact-context";
import type { CanvasArtifactStore, ManagerWorkStore, ProjectStore } from "@cosmora/db";
import { ArtifactContext, ArtifactContextError } from "./artifact-context.js";

export function registerArtifactContextRoutes(
  app: FastifyInstance,
  projects: ProjectStore,
  canvas: CanvasArtifactStore,
  identityFor: (request: FastifyRequest) => IdentityContext,
  work?: ManagerWorkStore
) {
  const service = new ArtifactContext(canvas, work);
  const path = "/api/v1/projects/:projectId/materials/artifacts";
  const params = Type.Object(
    { projectId: Type.String({ minLength: 1, maxLength: 128 }) },
    { additionalProperties: false }
  );
  const positive = Type.Integer({ minimum: 1, maximum: 1000000 });
  const selection = Type.Union([
    Type.Object({ kind: Type.Literal("full") }, { additionalProperties: false }),
    Type.Object(
      { kind: Type.Literal("lines"), from: positive, to: positive },
      { additionalProperties: false }
    ),
    Type.Object(
      {
        kind: Type.Literal("rows"),
        from: positive,
        to: positive,
        columns: Type.Array(Type.Integer({ minimum: 1, maximum: 100 }), {
          minItems: 1,
          maxItems: 100,
          uniqueItems: true
        })
      },
      { additionalProperties: false }
    )
  ]);
  const source = Type.Object(
    {
      kind: Type.Union([Type.Literal("canvas"), Type.Literal("table"), Type.Literal("work")]),
      id: Type.String({ minLength: 1, maxLength: 128 }),
      version: positive,
      sha256: Type.String({ pattern: "^[a-f0-9]{64}$" })
    },
    { additionalProperties: false }
  );
  const owned = (request: FastifyRequest<{ Params: { projectId: string } }>) =>
    projects.getProject(request.params.projectId, identityFor(request).owner_id);
  app.addHook("onSend", async (request, reply, payload) => {
    if (request.routeOptions.url?.startsWith(path))
      reply.header("cache-control", "private, no-store");
    return payload;
  });
  app.get<{ Params: { projectId: string } }>(
    path,
    { validatorCompiler: TypeBoxValidatorCompiler, schema: { params } },
    (req, reply) => {
      if (!owned(req)) return reply.code(404).send({ error: { code: "PROJECT_NOT_FOUND" } });
      return { items: service.list(req.params.projectId, identityFor(req).owner_id) ?? [] };
    }
  );
  app.post<{ Params: { projectId: string }; Body: ArtifactContextRequest }>(
    path + "/preview",
    {
      bodyLimit: 4096,
      validatorCompiler: TypeBoxValidatorCompiler,
      schema: { params, body: Type.Object({ source, selection }, { additionalProperties: false }) }
    },
    (req, reply) => {
      if (!owned(req)) return reply.code(404).send({ error: { code: "PROJECT_NOT_FOUND" } });
      try {
        return service.preview(req.params.projectId, identityFor(req).owner_id, req.body);
      } catch (error) {
        if (!(error instanceof ArtifactContextError)) throw error;
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
      }
    }
  );
  app.post<{
    Params: { projectId: string };
    Body: { source: ArtifactContextSource; scope: "all" | "view"; columns?: number[] };
  }>(
    path + "/table-summary",
    {
      bodyLimit: 4096,
      validatorCompiler: TypeBoxValidatorCompiler,
      schema: {
        params,
        body: Type.Object(
          {
            source: Type.Object(
              {
                kind: Type.Literal("table"),
                id: Type.String({ minLength: 1, maxLength: 128 }),
                version: positive,
                sha256: Type.String({ pattern: "^[a-f0-9]{64}$" })
              },
              { additionalProperties: false }
            ),
            scope: Type.Union([Type.Literal("all"), Type.Literal("view")]),
            columns: Type.Optional(
              Type.Array(Type.Integer({ minimum: 1, maximum: 100 }), {
                minItems: 1,
                maxItems: 100,
                uniqueItems: true
              })
            )
          },
          { additionalProperties: false }
        )
      }
    },
    (req, reply) => {
      if (!owned(req)) return reply.code(404).send({ error: { code: "PROJECT_NOT_FOUND" } });
      try {
        return service.tableSummary(
          req.params.projectId,
          identityFor(req).owner_id,
          req.body.source,
          req.body.scope,
          req.body.columns
        );
      } catch (error) {
        if (!(error instanceof ArtifactContextError)) throw error;
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
      }
    }
  );
}
