import {
  SourceExclusionsInputSchema,
  type SourceExclusionsInput,
  type IdentityContext
} from "@cosmora/contracts";
import {
  ProjectSourceError,
  type ProjectSourceStore,
  type ProjectMembershipStore
} from "@cosmora/db";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { Type } from "typebox";
import { TypeBoxValidatorCompiler } from "@fastify/type-provider-typebox";
import { projectAccess } from "./project-access.js";

const id = Type.String({ minLength: 1, maxLength: 128 });
const params = Type.Object({ projectId: id }, { additionalProperties: false });
const runParams = Type.Object({ projectId: id, runId: id }, { additionalProperties: false });

/** Project-scoped source exclusions and immutable run receipts. */
export function registerProjectSourceRoutes(
  app: FastifyInstance,
  store: ProjectSourceStore,
  identityFor: (request: FastifyRequest) => IdentityContext,
  membership?: ProjectMembershipStore
) {
  const base = "/api/v1/projects/:projectId/sources";
  app.addHook("onSend", (request, reply, payload, done) => {
    if (request.routeOptions.url?.startsWith(base))
      reply
        .header("cache-control", "private, no-store")
        .header("x-content-type-options", "nosniff");
    done(null, payload);
  });
  const failure = (reply: { code(n: number): { send(v: unknown): unknown } }, error: unknown) => {
    if (!(error instanceof ProjectSourceError)) throw error;
    return reply.code(error.status).send({ error: { code: error.code } });
  };

  app.get<{ Params: { projectId: string } }>(
    base + "/exclusions",
    { schema: { params }, validatorCompiler: TypeBoxValidatorCompiler },
    (req, reply) => {
      const { projectId } = req.params;
      const access = projectAccess(membership, projectId, identityFor(req).owner_id);
      if (!access) return reply.code(403).send({ error: { code: "PROJECT_MEMBER_REQUIRED" } });
      try {
        const result = store.exclusions(projectId, access.ownerId);
        return access.role === "owner"
          ? result
          : {
              ...result,
              items: result.items
                .filter((item) => store.isSharedSource(projectId, item))
                .map((item) => ({ ...item, reason: "" }))
            };
      } catch (error) {
        return failure(reply, error);
      }
    }
  );
  app.put<{ Params: { projectId: string }; Body: SourceExclusionsInput }>(
    base + "/exclusions",
    {
      bodyLimit: 32768,
      validatorCompiler: TypeBoxValidatorCompiler,
      schema: { params, body: SourceExclusionsInputSchema }
    },
    (req, reply) => {
      const access = projectAccess(
        membership,
        req.params.projectId,
        identityFor(req).owner_id,
        "owner"
      );
      if (!access) return reply.code(403).send({ error: { code: "PROJECT_MEMBER_REQUIRED" } });
      try {
        return store.updateExclusions(req.params.projectId, access.ownerId, req.body);
      } catch (error) {
        return failure(reply, error);
      }
    }
  );
  app.get<{ Params: { projectId: string; runId: string } }>(
    base + "/run/:runId",
    { schema: { params: runParams }, validatorCompiler: TypeBoxValidatorCompiler },
    (req, reply) => {
      const { projectId, runId } = req.params;
      const access = projectAccess(membership, projectId, identityFor(req).owner_id);
      if (!access) return reply.code(403).send({ error: { code: "PROJECT_MEMBER_REQUIRED" } });
      try {
        const result = store.runSources(projectId, access.ownerId, runId);
        if (access.role === "owner") return result;
        const sources = result.sources.filter((source) => store.isSharedSource(projectId, source));
        return {
          ...result,
          sources,
          excluded_now: result.excluded_now.filter((id) =>
            sources.some((source) => source.source_id === id)
          )
        };
      } catch (error) {
        return failure(reply, error);
      }
    }
  );
}
