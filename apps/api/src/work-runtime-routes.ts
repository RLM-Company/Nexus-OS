import type { IdentityContext } from "@cosmora/contracts";
import { workRuntimeProgress } from "@cosmora/core";
import type { ManagerWorkStore, ProjectStore } from "@cosmora/db";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { Type } from "typebox";

export function registerWorkRuntimeRoutes(options: {
  app: FastifyInstance;
  store: ManagerWorkStore;
  projects: ProjectStore;
  identityFor: (request: FastifyRequest) => IdentityContext;
}): void {
  const { app, store, projects, identityFor } = options;
  type Params = { projectId: string; id: string };
  const params = Type.Object(
    { projectId: Type.String({ minLength: 1 }), id: Type.Optional(Type.String({ minLength: 1 })) },
    { additionalProperties: false }
  );
  const base = "/api/v1/projects/:projectId";
  app.get<{ Params: Params }>(base + "/work/:id/runtime", { schema: { params } }, (req, reply) => {
    const owner = identityFor(req).owner_id,
      work = store.get(req.params.id, owner);
    if (!work || work.project_id !== req.params.projectId)
      return reply.code(404).send({ error: "WORK_NOT_FOUND" });
    return {
      progress: workRuntimeProgress(work),
      checkpoints: store.runtime.checkpoints(work.project_id, owner, work.id),
      artifacts: store.runtime.artifacts(work.project_id, owner, work.id),
      memory: {
        included: work.memory_snapshot?.items.length ?? 0,
        omitted: work.memory_snapshot?.omitted ?? 0
      }
    };
  });
  app.get<{ Params: Params }>(base + "/work-artifacts", { schema: { params } }, (req, reply) => {
    const owner = identityFor(req).owner_id;
    if (!projects.getProject(req.params.projectId, owner))
      return reply.code(404).send({ error: "PROJECT_NOT_FOUND" });
    return { items: store.runtime.artifacts(req.params.projectId, owner) };
  });
  app.get<{ Params: Params }>(
    base + "/work-artifacts/:id/download",
    { schema: { params } },
    (req, reply) => {
      const artifact = store.runtime.artifact(
        req.params.projectId,
        identityFor(req).owner_id,
        req.params.id
      );
      if (!artifact) return reply.code(404).send({ error: "ARTIFACT_NOT_FOUND" });
      return reply
        .header(
          "content-disposition",
          `attachment; filename="${encodeURIComponent(artifact.metadata.name)}"`
        )
        .header("x-content-type-options", "nosniff")
        .header("cache-control", "no-store")
        .type("text/plain; charset=utf-8")
        .send(artifact.content);
    }
  );
}
