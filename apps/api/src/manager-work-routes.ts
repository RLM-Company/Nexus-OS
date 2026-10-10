import { registerWorkDagRoutes } from "./work-dag-routes.js";
import { registerProjectMemoryRoutes } from "./project-memory-routes.js";
import { registerWorkRuntimeRoutes } from "./work-runtime-routes.js";
import {
  CreateManagerWorkSchema,
  type CreateManagerWork,
  type IdentityContext
} from "@cosmora/contracts";
import { ManagerWorkConflict, type ManagerWorkStore, type ProjectStore } from "@cosmora/db";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { Type } from "typebox";
import type { ManagerWorkCoordinator } from "./manager-work-coordinator.js";

export function registerManagerWorkRoutes(options: {
  app: FastifyInstance;
  store: ManagerWorkStore;
  projects: ProjectStore;
  coordinator: ManagerWorkCoordinator;
  identityFor: (request: FastifyRequest) => IdentityContext;
}): void {
  const { app, store, projects, coordinator, identityFor } = options;
  registerWorkDagRoutes({ app, projects, coordinator: coordinator.dag, identityFor });
  registerProjectMemoryRoutes({ app, memory: store.memory, projects, identityFor });
  registerWorkRuntimeRoutes({ app, store, projects, identityFor });
  const base = "/api/v1/projects/:projectId/work";
  const params = Type.Object(
    {
      projectId: Type.String({ minLength: 1 }),
      id: Type.Optional(Type.String({ minLength: 1 })),
      name: Type.Optional(Type.String({ minLength: 1, maxLength: 100 }))
    },
    { additionalProperties: false }
  );
  const control = Type.Object(
    {
      version: Type.Integer({ minimum: 1 }),
      action: Type.Union([
        Type.Literal("pause"),
        Type.Literal("resume"),
        Type.Literal("approve"),
        Type.Literal("cancel")
      ])
    },
    { additionalProperties: false }
  );
  type Params = { projectId: string; id: string; name: string };
  const owned = (request: FastifyRequest<{ Params: Params }>) =>
    projects.getProject(request.params.projectId, identityFor(request).owner_id);
  const get = (request: FastifyRequest<{ Params: Params }>) => {
    const work = store.get(request.params.id, identityFor(request).owner_id);
    return work?.project_id === request.params.projectId ? work : null;
  };
  app.get<{ Params: Params }>(base, { schema: { params } }, (request, reply) => {
    if (!owned(request)) return reply.code(404).send({ error: "PROJECT_NOT_FOUND" });
    return { items: store.list(request.params.projectId, identityFor(request).owner_id) };
  });
  app.post<{ Params: Params; Body: CreateManagerWork }>(
    base,
    { schema: { params, body: CreateManagerWorkSchema } },
    (request, reply) => {
      const identity = identityFor(request);
      if (!owned(request)) return reply.code(404).send({ error: "PROJECT_NOT_FOUND" });
      try {
        const result = store.create(
          request.params.projectId,
          identity.owner_id,
          identity.actor_id,
          request.body
        );
        return result
          ? reply.code(201).send(result)
          : reply.code(409).send({ error: "PROJECT_INACTIVE" });
      } catch (error) {
        if (error instanceof ManagerWorkConflict)
          return reply.code(409).send({ error: error.message });
        throw error;
      }
    }
  );
  app.get<{ Params: Params }>(base + "/:id", { schema: { params } }, (request, reply) => {
    const work = get(request);
    return work ?? reply.code(404).send({ error: "WORK_NOT_FOUND" });
  });
  app.post<{
    Params: Params;
    Body: { version: number; action: "pause" | "resume" | "approve" | "cancel" };
  }>(base + "/:id/control", { schema: { params, body: control } }, (request, reply) => {
    if (!get(request)) return reply.code(404).send({ error: "WORK_NOT_FOUND" });
    try {
      return coordinator.control(
        request.params.id,
        identityFor(request).owner_id,
        request.body.version,
        request.body.action
      );
    } catch (error) {
      if (error instanceof ManagerWorkConflict)
        return reply.code(409).send({ error: error.message });
      throw error;
    }
  });
  app.get<{ Params: Params }>(
    base + "/:id/files/:name",
    { schema: { params } },
    (request, reply) => {
      if (!get(request)) return reply.code(404).send({ error: "WORK_NOT_FOUND" });
      const content = store.file(
        request.params.id,
        identityFor(request).owner_id,
        request.params.name
      );
      if (content === null) return reply.code(404).send({ error: "FILE_NOT_FOUND" });
      return reply
        .header(
          "content-disposition",
          'attachment; filename="' + encodeURIComponent(request.params.name) + '"'
        )
        .header("x-content-type-options", "nosniff")
        .type("text/plain; charset=utf-8")
        .send(content);
    }
  );
}
