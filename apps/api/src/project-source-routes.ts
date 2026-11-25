import {
  RunSourcesInputSchema,
  SourceExclusionsInputSchema,
  type IdentityContext
} from "@cosmora/contracts";
import { ProjectSourceError, type ProjectSourceStore } from "@cosmora/db";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { Type } from "typebox";
import { TypeBoxValidatorCompiler } from "@fastify/type-provider-typebox";

const id = Type.String({ minLength: 1, maxLength: 128 });
const params = Type.Object({ projectId: id }, { additionalProperties: false });
const runParams = Type.Object({ projectId: id, runId: id }, { additionalProperties: false });

/** Project-scoped source exclusions and immutable run receipts. */
export function registerProjectSourceRoutes(
  app: FastifyInstance,
  store: ProjectSourceStore,
  identityFor: (request: FastifyRequest) => IdentityContext
) {
  const base = "/api/v1/projects/:projectId/sources";
  app.addHook("onSend", async (request, reply, payload) => {
    if (request.routeOptions.url?.startsWith(base))
      reply
        .header("cache-control", "private, no-store")
        .header("x-content-type-options", "nosniff");
    return payload;
  });
  const failure = (reply: { code(n: number): { send(v: unknown): unknown } }, error: unknown) => {
    if (!(error instanceof ProjectSourceError)) throw error;
    return reply.code(error.status).send({ error: { code: error.code } });
  };

  app.get<{ Params: { projectId: string } }>(
    base + "/exclusions",
    { schema: { params }, validatorCompiler: TypeBoxValidatorCompiler },
    (req, reply) => {
      try {
        return store.exclusions(req.params.projectId, identityFor(req).owner_id);
      } catch (error) {
        return failure(reply, error);
      }
    }
  );
  app.put<{ Params: { projectId: string }; Body: unknown }>(
    base + "/exclusions",
    {
      bodyLimit: 32768,
      validatorCompiler: TypeBoxValidatorCompiler,
      schema: { params, body: SourceExclusionsInputSchema }
    },
    (req, reply) => {
      try {
        return store.updateExclusions(
          req.params.projectId,
          identityFor(req).owner_id,
          req.body as never
        );
      } catch (error) {
        return failure(reply, error);
      }
    }
  );
  app.post<{ Params: { projectId: string }; Body: unknown }>(
    base + "/run",
    {
      bodyLimit: 262144,
      validatorCompiler: TypeBoxValidatorCompiler,
      schema: { params, body: RunSourcesInputSchema }
    },
    (req, reply) => {
      try {
        return store.recordRunSources(
          req.params.projectId,
          identityFor(req).owner_id,
          req.body as never
        );
      } catch (error) {
        return failure(reply, error);
      }
    }
  );
  app.get<{ Params: { projectId: string; runId: string } }>(
    base + "/run/:runId",
    { schema: { params: runParams }, validatorCompiler: TypeBoxValidatorCompiler },
    (req, reply) => {
      try {
        return store.runSources(req.params.projectId, identityFor(req).owner_id, req.params.runId);
      } catch (error) {
        return failure(reply, error);
      }
    }
  );
  return Promise.resolve();
}
