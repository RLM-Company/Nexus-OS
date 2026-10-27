import {
  ProjectMemoryControlSchema,
  ProjectMemoryInputSchema,
  ProjectMemoryUpdateSchema,
  type IdentityContext,
  type ProjectMemoryInput
} from "@cosmora/contracts";
import { ProjectMemoryConflict, type ProjectMemoryStore, type ProjectStore } from "@cosmora/db";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { Type } from "typebox";

export function registerProjectMemoryRoutes(options: {
  app: FastifyInstance;
  memory: ProjectMemoryStore;
  projects: ProjectStore;
  identityFor: (request: FastifyRequest) => IdentityContext;
}): void {
  const { app, memory, projects, identityFor } = options;
  const base = "/api/v1/projects/:projectId/memory";
  type Params = { projectId: string; id: string };
  const params = Type.Object(
    { projectId: Type.String({ minLength: 1 }), id: Type.Optional(Type.String({ minLength: 1 })) },
    { additionalProperties: false }
  );
  const owned = (req: FastifyRequest<{ Params: Params }>) =>
    projects.getProject(req.params.projectId, identityFor(req).owner_id);
  app.get<{ Params: Params; Querystring: { q?: string } }>(
    base,
    {
      schema: {
        params,
        querystring: Type.Object(
          { q: Type.Optional(Type.String({ maxLength: 200 })) },
          { additionalProperties: false }
        )
      }
    },
    (req, reply) => {
      if (!owned(req)) return reply.code(404).send({ error: "PROJECT_NOT_FOUND" });
      return { items: memory.list(req.params.projectId, identityFor(req).owner_id, req.query.q) };
    }
  );
  const handle = <T>(operation: () => T) => {
    try {
      return { value: operation() };
    } catch (error) {
      if (error instanceof ProjectMemoryConflict) return { error: error.message };
      throw error;
    }
  };
  app.post<{ Params: Params; Body: ProjectMemoryInput }>(
    base,
    { schema: { params, body: ProjectMemoryInputSchema } },
    (req, reply) => {
      if (!owned(req)) return reply.code(404).send({ error: "PROJECT_NOT_FOUND" });
      const result = handle(() =>
        memory.create(req.params.projectId, identityFor(req).owner_id, req.body)
      );
      if (result.error) return reply.code(409).send({ error: result.error });
      return result.value
        ? reply.code(201).send(result.value)
        : reply.code(409).send({ error: "PROJECT_INACTIVE" });
    }
  );
  app.get<{ Params: Params }>(
    base + "/:id",
    { schema: { params } },
    (req, reply) =>
      memory.get(req.params.projectId, identityFor(req).owner_id, req.params.id) ??
      reply.code(404).send({ error: "MEMORY_NOT_FOUND" })
  );
  app.put<{ Params: Params; Body: ProjectMemoryInput & { version: number } }>(
    base + "/:id",
    { schema: { params, body: ProjectMemoryUpdateSchema } },
    (req, reply) => {
      const { version, ...input } = req.body;
      const result = handle(() =>
        memory.update(
          req.params.projectId,
          identityFor(req).owner_id,
          req.params.id,
          version,
          input
        )
      );
      if (result.error) return reply.code(409).send({ error: result.error });
      return result.value ?? reply.code(404).send({ error: "MEMORY_NOT_FOUND" });
    }
  );
  app.post<{ Params: Params; Body: { version: number; action: "pin" | "unpin" | "forget" } }>(
    base + "/:id/control",
    { schema: { params, body: ProjectMemoryControlSchema } },
    (req, reply) => {
      const result = handle(() =>
        memory.control(
          req.params.projectId,
          identityFor(req).owner_id,
          req.params.id,
          req.body.version,
          req.body.action
        )
      );
      if (result.error) return reply.code(409).send({ error: result.error });
      return result.value ?? reply.code(404).send({ error: "MEMORY_NOT_FOUND" });
    }
  );
}
