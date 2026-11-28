import {
  WorkDagCreateSchema,
  WorkDagEditSchema,
  WorkDagControlSchema,
  WorkDagCloneSchema,
  WorkDagArchiveSchema,
  WorkDagRenameSchema,
  WorkPlanImportSchema,
  WORK_PLAN_PACKAGE_MAX_BYTES,
  type WorkDagCreate,
  type WorkDagClone,
  type WorkDagArchive,
  type WorkDagRename,
  type WorkPlanImport,
  type WorkDagControl,
  type WorkDagNodeInput,
  type IdentityContext
} from "@cosmora/contracts";
import { ManagerWorkConflict, WorkDagConflict, type ProjectStore } from "@cosmora/db";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { Type } from "typebox";
import { TypeBoxValidatorCompiler } from "@fastify/type-provider-typebox";
import type { WorkDagCoordinator } from "./work-dag-coordinator.js";
import { projectAccess } from "./project-access.js";
import type { ProjectMembershipStore } from "@cosmora/db";

export function registerWorkDagRoutes(options: {
  app: FastifyInstance;
  projects: ProjectStore;
  coordinator: WorkDagCoordinator;
  identityFor: (request: FastifyRequest) => IdentityContext;
  membership?: ProjectMembershipStore | undefined;
}): void {
  const { app, projects, coordinator, identityFor, membership } = options;
  const base = "/api/v1/projects/:projectId/work-dags";
  type Params = { projectId: string; id: string };
  const params = Type.Object(
    { projectId: Type.String({ minLength: 1 }), id: Type.Optional(Type.String({ minLength: 1 })) },
    { additionalProperties: false }
  );
  const owned = (r: FastifyRequest<{ Params: Params }>) => {
    const actor = identityFor(r).owner_id;
    const access = projectAccess(
      membership,
      r.params.projectId,
      actor,
      r.method === "GET" ? "any" : "editor"
    );
    return access && access.projectId === r.params.projectId
      ? projects.getProject(r.params.projectId, access.ownerId)
      : null;
  };
  /** Owner scope for an id-based DAG operation; member access is checked on
   * every call, so a revoked member cannot reuse a previously known id. */
  const projectDataOwner = (r: FastifyRequest<{ Params: Params }>): string | null => {
    const access = projectAccess(
      membership,
      r.params.projectId,
      identityFor(r).owner_id,
      r.method === "GET" ? "any" : "editor"
    );
    return access && access.projectId === r.params.projectId ? access.ownerId : null;
  };
  const dataOwner = (r: FastifyRequest<{ Params: Params }>): string | null => {
    const actor = identityFor(r).owner_id;
    const scope = coordinator.scope(r.params.id ?? "");
    if (!scope || scope.projectId !== r.params.projectId) return null;
    const access = projectAccess(
      membership,
      scope.projectId,
      actor,
      r.method === "GET" ? "any" : "editor"
    );
    return access && access.ownerId === scope.ownerId ? scope.ownerId : null;
  };
  const safe = (
    fn: () => unknown,
    reply: { code: (n: number) => { send: (value: unknown) => unknown } }
  ) => {
    try {
      return fn();
    } catch (e) {
      if (
        e instanceof Error &&
        !(e instanceof WorkDagConflict) &&
        [
          "INVALID_WORK_PLAN_PACKAGE",
          "PLAN_PACKAGE_LIMIT",
          "INVALID_DAG",
          "DAG_CYCLE",
          "DAG_DEPENDENCY_MISSING"
        ].includes(e.message)
      )
        return reply.code(400).send({ error: e.message });
      if (e instanceof WorkDagConflict || e instanceof ManagerWorkConflict)
        return reply
          .code(["DAG_NOT_FOUND", "PROJECT_NOT_FOUND"].includes(e.message) ? 404 : 409)
          .send({ error: e.message });
      throw e;
    }
  };
  app.get<{ Params: Params }>(base, { schema: { params } }, (r, reply) => {
    if (!owned(r)) return reply.code(404).send({ error: "PROJECT_NOT_FOUND" });
    return safe(
      () => ({ items: coordinator.list(r.params.projectId, projectDataOwner(r) ?? "") }),
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
              coordinator.create(
                r.params.projectId,
                projectDataOwner(r) ?? "",
                identity.actor_id,
                r.body
              )
            ),
        reply
      );
    }
  );
  app.get<{ Params: Params }>(base + "/:id", { schema: { params } }, (r, reply) => {
    reply.header("Cache-Control", "private, no-store");
    return safe(
      () =>
        coordinator.get(r.params.id, dataOwner(r) ?? "", r.params.projectId) ??
        reply.code(404).send({ error: "DAG_NOT_FOUND" }),
      reply
    );
  });
  app.post<{ Params: Params; Body: WorkPlanImport }>(
    base + "/import",
    {
      bodyLimit: WORK_PLAN_PACKAGE_MAX_BYTES + 1024,
      validatorCompiler: TypeBoxValidatorCompiler,
      schema: { params, body: WorkPlanImportSchema }
    },
    (r, reply) =>
      safe(() => {
        const identity = identityFor(r);
        if (!owned(r)) return reply.code(404).send({ error: "PROJECT_NOT_FOUND" });
        return reply
          .header("Cache-Control", "private, no-store")
          .code(201)
          .send(
            coordinator.import(
              r.params.projectId,
              projectDataOwner(r) ?? "",
              identity.actor_id,
              r.body
            )
          );
      }, reply)
  );
  app.get<{ Params: Params }>(base + "/:id/package", { schema: { params } }, (r, reply) =>
    safe(
      () =>
        reply
          .header("content-disposition", 'attachment; filename="work-plan.json"')
          .header("Cache-Control", "private, no-store")
          .header("X-Content-Type-Options", "nosniff")
          .type("application/json; charset=utf-8")
          .send(
            JSON.stringify(coordinator.package(r.params.id, dataOwner(r) ?? "", r.params.projectId))
          ),
      reply
    )
  );
  app.post<{ Params: Params; Body: WorkDagClone }>(
    base + "/:id/clone",
    {
      validatorCompiler: TypeBoxValidatorCompiler,
      schema: { params, body: WorkDagCloneSchema }
    },
    (r, reply) =>
      safe(() => {
        const identity = identityFor(r);
        return reply
          .header("Cache-Control", "private, no-store")
          .code(201)
          .send(
            coordinator.clone(
              r.params.projectId,
              r.params.id,
              dataOwner(r) ?? "",
              identity.actor_id,
              r.body
            )
          );
      }, reply)
  );
  app.get<{ Params: Params }>(base + "/:id/checkpoints", { schema: { params } }, (r, reply) =>
    safe(() => {
      if (!coordinator.owns(r.params.id, dataOwner(r) ?? "", r.params.projectId))
        return reply.code(404).send({ error: "DAG_NOT_FOUND" });
      return { items: coordinator.checkpoints(r.params.id, dataOwner(r) ?? "") };
    }, reply)
  );
  app.put<{ Params: Params; Body: WorkDagArchive }>(
    base + "/:id/archive",
    { validatorCompiler: TypeBoxValidatorCompiler, schema: { params, body: WorkDagArchiveSchema } },
    (r, reply) =>
      safe(() => {
        const owner = dataOwner(r) ?? "";
        if (!coordinator.owns(r.params.id, owner, r.params.projectId))
          return reply.code(404).send({ error: "DAG_NOT_FOUND" });
        return reply
          .header("Cache-Control", "private, no-store")
          .send(coordinator.archive(r.params.id, owner, r.body));
      }, reply)
  );
  app.put<{ Params: Params; Body: WorkDagRename }>(
    base + "/:id/title",
    { validatorCompiler: TypeBoxValidatorCompiler, schema: { params, body: WorkDagRenameSchema } },
    (r, reply) =>
      safe(() => {
        const owner = dataOwner(r) ?? "";
        if (!coordinator.owns(r.params.id, owner, r.params.projectId))
          return reply.code(404).send({ error: "DAG_NOT_FOUND" });
        return reply
          .header("Cache-Control", "private, no-store")
          .send(coordinator.rename(r.params.id, owner, r.body));
      }, reply)
  );
  app.get<{ Params: Params }>(base + "/:id/results", { schema: { params } }, (r, reply) =>
    safe(() => {
      reply.header("cache-control", "private, no-store");
      const owner = dataOwner(r) ?? "";
      if (!coordinator.owns(r.params.id, owner, r.params.projectId))
        return reply.code(404).send({ error: "DAG_NOT_FOUND" });
      const result = coordinator.results(r.params.id, owner);
      return reply
        .header("content-disposition", 'attachment; filename="work-results.json"')
        .header("x-content-type-options", "nosniff")
        .type("application/json; charset=utf-8")
        .send(result);
    }, reply)
  );
  app.get<{ Params: Params; Querystring: { node_id?: string; node_ids?: string } }>(
    base + "/:id/results.zip",
    {
      schema: {
        params,
        querystring: Type.Object(
          {
            node_id: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
            node_ids: Type.Optional(Type.String({ minLength: 1, maxLength: 2000 }))
          },
          { additionalProperties: false }
        )
      }
    },
    (r, reply) =>
      safe(() => {
        reply.header("cache-control", "private, no-store");
        const owner = dataOwner(r) ?? "";
        if (!coordinator.owns(r.params.id, owner, r.params.projectId))
          return reply.code(404).send({ error: "DAG_NOT_FOUND" });
        const { node_id, node_ids } = r.query;
        if (node_id && node_ids) return reply.code(400).send({ error: "INVALID_NODE_IDS" });
        const nodeIds = node_id
          ? [node_id]
          : node_ids
            ? [
                ...new Set(
                  node_ids
                    .split(",")
                    .map((id) => id.trim())
                    .filter(Boolean)
                )
              ]
            : undefined;
        if (nodeIds && (!nodeIds.length || nodeIds.length > 32))
          return reply.code(400).send({ error: "INVALID_NODE_IDS" });
        const archive = coordinator.resultsArchive(r.params.id, owner, nodeIds);
        return reply
          .header(
            "content-disposition",
            `attachment; filename="${nodeIds ? "work-results-partial" : "work-results"}.zip"`
          )
          .header("x-content-type-options", "nosniff")
          .header("content-length", String(archive.byteLength))
          .type("application/zip")
          .send(archive);
      }, reply)
  );
  app.put<{ Params: Params; Body: { version: number; nodes: WorkDagNodeInput[] } }>(
    base + "/:id",
    { schema: { params, body: WorkDagEditSchema } },
    (r, reply) =>
      safe(() => {
        if (!coordinator.owns(r.params.id, dataOwner(r) ?? "", r.params.projectId))
          return reply.code(404).send({ error: "DAG_NOT_FOUND" });
        return coordinator.edit(r.params.id, dataOwner(r) ?? "", r.body.version, r.body.nodes);
      }, reply)
  );
  app.post<{ Params: Params; Body: WorkDagControl }>(
    base + "/:id/control",
    { schema: { params, body: WorkDagControlSchema } },
    (r, reply) =>
      safe(() => {
        if (!coordinator.owns(r.params.id, dataOwner(r) ?? "", r.params.projectId))
          return reply.code(404).send({ error: "DAG_NOT_FOUND" });
        return coordinator.control(r.params.id, dataOwner(r) ?? "", r.body);
      }, reply)
  );
}
