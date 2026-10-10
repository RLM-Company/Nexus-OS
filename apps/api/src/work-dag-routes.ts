import {
  WorkDagCreateSchema,
  WorkDagEditSchema,
  WorkDagControlSchema,
  type WorkDagCreate,
  type WorkDagControl,
  type WorkDagNodeInput,
  type IdentityContext
} from "@cosmora/contracts";
import { ManagerWorkConflict, WorkDagConflict, type ProjectStore } from "@cosmora/db";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { Type } from "typebox";
import type { WorkDagCoordinator } from "./work-dag-coordinator.js";

export function registerWorkDagRoutes(options: {
  app: FastifyInstance;
  projects: ProjectStore;
  coordinator: WorkDagCoordinator;
  identityFor: (request: FastifyRequest) => IdentityContext;
}): void {
  const { app, projects, coordinator, identityFor } = options;
  const base = "/api/v1/projects/:projectId/work-dags";
  type Params = { projectId: string; id: string };
  const params = Type.Object(
    { projectId: Type.String({ minLength: 1 }), id: Type.Optional(Type.String({ minLength: 1 })) },
    { additionalProperties: false }
  );
  const owned = (r: FastifyRequest<{ Params: Params }>) =>
    projects.getProject(r.params.projectId, identityFor(r).owner_id);
  const graph = (r: FastifyRequest<{ Params: Params }>) => {
    const g = coordinator.get(r.params.id, identityFor(r).owner_id);
    return g?.project_id === r.params.projectId ? g : null;
  };
  const safe = (
    fn: () => unknown,
    reply: { code: (n: number) => { send: (value: unknown) => unknown } }
  ) => {
    try {
      return fn();
    } catch (e) {
      if (e instanceof WorkDagConflict || e instanceof ManagerWorkConflict)
        return reply.code(409).send({ error: e.message });
      throw e;
    }
  };
  app.get<{ Params: Params }>(base, { schema: { params } }, (r, reply) => {
    if (!owned(r)) return reply.code(404).send({ error: "PROJECT_NOT_FOUND" });
    return safe(
      () => ({ items: coordinator.list(r.params.projectId, identityFor(r).owner_id) }),
      reply
    );
  });
  app.post<{ Params: Params; Body: WorkDagCreate }>(
    base,
    { schema: { params, body: WorkDagCreateSchema } },
    (r, reply) => {
      if (!owned(r)) return reply.code(404).send({ error: "PROJECT_NOT_FOUND" });
      const identity = identityFor(r);
      return safe(
        () =>
          reply
            .code(201)
            .send(
              coordinator.create(r.params.projectId, identity.owner_id, identity.actor_id, r.body)
            ),
        reply
      );
    }
  );
  app.get<{ Params: Params }>(base + "/:id", { schema: { params } }, (r, reply) =>
    safe(() => graph(r) ?? reply.code(404).send({ error: "DAG_NOT_FOUND" }), reply)
  );
  app.get<{ Params: Params }>(base + "/:id/checkpoints", { schema: { params } }, (r, reply) =>
    safe(() => {
      if (!coordinator.owns(r.params.id, identityFor(r).owner_id, r.params.projectId))
        return reply.code(404).send({ error: "DAG_NOT_FOUND" });
      return { items: coordinator.checkpoints(r.params.id, identityFor(r).owner_id) };
    }, reply)
  );
  app.put<{ Params: Params; Body: { version: number; nodes: WorkDagNodeInput[] } }>(
    base + "/:id",
    { schema: { params, body: WorkDagEditSchema } },
    (r, reply) =>
      safe(() => {
        if (!coordinator.owns(r.params.id, identityFor(r).owner_id, r.params.projectId))
          return reply.code(404).send({ error: "DAG_NOT_FOUND" });
        return coordinator.edit(r.params.id, identityFor(r).owner_id, r.body.version, r.body.nodes);
      }, reply)
  );
  app.post<{ Params: Params; Body: WorkDagControl }>(
    base + "/:id/control",
    { schema: { params, body: WorkDagControlSchema } },
    (r, reply) =>
      safe(() => {
        if (!coordinator.owns(r.params.id, identityFor(r).owner_id, r.params.projectId))
          return reply.code(404).send({ error: "DAG_NOT_FOUND" });
        return coordinator.control(r.params.id, identityFor(r).owner_id, r.body);
      }, reply)
  );
}
