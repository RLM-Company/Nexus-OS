import type { FastifyInstance, FastifyRequest } from "fastify";
import { Type } from "typebox";
import type { IdentityContext } from "@cosmora/contracts";
import { DATA_SERVER_BYTES } from "@cosmora/contracts/data-workspace";
import { type CanvasArtifactStore, CanvasConflictError, CanvasLimitError } from "@cosmora/db";

export function registerDataWorkspaceRoutes(
  app: FastifyInstance,
  store: CanvasArtifactStore,
  identityFor: (request: FastifyRequest) => IdentityContext
) {
  const root = "/api/v1/projects/:projectId/tables";
  const id = Type.String({ minLength: 1, maxLength: 128 });
  const project = Type.Object({ projectId: id }, { additionalProperties: false });
  const params = Type.Object({ projectId: id, id }, { additionalProperties: false });
  const fields = {
    title: Type.String({ minLength: 1, maxLength: 240 }),
    content: Type.String({ maxLength: DATA_SERVER_BYTES })
  };
  type Path = { projectId: string; id: string };
  const owner = (request: FastifyRequest) => identityFor(request).owner_id;
  const missing = (reply: { code(n: number): { send(v: unknown): unknown } }) =>
    reply.code(404).send({ error: { code: "DATA_WORKSPACE_NOT_FOUND" } });
  const handle = (reply: { code(n: number): { send(v: unknown): unknown } }, error: unknown) => {
    if (error instanceof CanvasConflictError)
      return reply.code(409).send({
        error: { code: "DATA_WORKSPACE_VERSION_CONFLICT", currentVersion: error.currentVersion }
      });
    if (error instanceof CanvasLimitError)
      return reply
        .code(
          error.code.includes("FENCED") || error.code.includes("CONFLICT")
            ? 409
            : error.code.includes("INVALID") || error.code.includes("EDITOR_REQUIRED")
              ? 400
              : 413
        )
        .send({ error: { code: error.code } });
    if (error instanceof Error && error.message === "CANVAS_INVALID_CONTENT")
      return reply.code(400).send({ error: { code: "DATA_WORKSPACE_INVALID" } });
    throw error;
  };
  const ownTable = (request: FastifyRequest, path: Path) =>
    store.isTable(path.projectId, owner(request), path.id);
  app.addHook("onSend", async (request, reply, payload) => {
    if (request.routeOptions.url?.startsWith(root))
      reply
        .header("cache-control", "private, no-store")
        .header("x-content-type-options", "nosniff");
    return payload;
  });
  app.get<{ Params: { projectId: string } }>(
    root,
    { schema: { params: project } },
    (req, reply) => {
      const first = store.list(req.params.projectId, owner(req), 100, 0, true);
      return first
        ? {
            items: [
              ...first,
              ...(store.list(req.params.projectId, owner(req), 100, 100, true) ?? [])
            ]
          }
        : missing(reply);
    }
  );
  app.post<{
    Params: { projectId: string };
    Body: { client_id: string; title: string; content: string };
  }>(
    root,
    {
      bodyLimit: DATA_SERVER_BYTES * 6 + 4096,
      schema: {
        params: project,
        body: Type.Object(
          { ...fields, client_id: Type.String({ pattern: "^[a-fA-F0-9-]{36}$" }) },
          { additionalProperties: false }
        )
      }
    },
    (req, reply) => {
      try {
        const value = store.create(req.params.projectId, owner(req), {
          ...req.body,
          format: "code",
          source: { kind: "data_workspace" },
          idempotency_id: req.body.client_id
        });
        return value ? reply.code(201).send(value) : missing(reply);
      } catch (error) {
        return handle(reply, error);
      }
    }
  );
  app.get<{ Params: Path }>(root + "/:id", { schema: { params } }, (req, reply) =>
    ownTable(req, req.params)
      ? store.get(req.params.projectId, owner(req), req.params.id)
      : missing(reply)
  );
  app.put<{ Params: Path; Body: { baseVersion: number; title: string; content: string } }>(
    root + "/:id",
    {
      bodyLimit: DATA_SERVER_BYTES * 6 + 4096,
      schema: {
        params,
        body: Type.Object(
          { ...fields, baseVersion: Type.Integer({ minimum: 1 }) },
          { additionalProperties: false }
        )
      }
    },
    (req, reply) => {
      if (!ownTable(req, req.params)) return missing(reply);
      try {
        return store.update(req.params.projectId, owner(req), req.params.id, {
          ...req.body,
          format: "code",
          source: { kind: "data_workspace" }
        });
      } catch (error) {
        return handle(reply, error);
      }
    }
  );
  app.get<{ Params: Path }>(root + "/:id/revisions", { schema: { params } }, (req, reply) =>
    ownTable(req, req.params)
      ? { items: store.history(req.params.projectId, owner(req), req.params.id) }
      : missing(reply)
  );
  app.post<{ Params: Path; Body: { baseVersion: number; sourceVersion: number } }>(
    root + "/:id/restore",
    {
      schema: {
        params,
        body: Type.Object(
          {
            baseVersion: Type.Integer({ minimum: 1 }),
            sourceVersion: Type.Integer({ minimum: 1 })
          },
          { additionalProperties: false }
        )
      }
    },
    (req, reply) => {
      if (!ownTable(req, req.params)) return missing(reply);
      const original = store.getRevision(
        req.params.projectId,
        owner(req),
        req.params.id,
        req.body.sourceVersion
      );
      if (!original) return missing(reply);
      try {
        return store.update(req.params.projectId, owner(req), req.params.id, {
          baseVersion: req.body.baseVersion,
          title: original.title,
          content: original.content,
          format: "code",
          source: { kind: "data_workspace", restored_from: req.body.sourceVersion }
        });
      } catch (error) {
        return handle(reply, error);
      }
    }
  );
  app.get<{ Params: Path }>(root + "/:id/download", { schema: { params } }, (req, reply) => {
    if (!ownTable(req, req.params)) return missing(reply);
    const value = store.get(req.params.projectId, owner(req), req.params.id);
    if (!value) return missing(reply);
    return reply
      .header("content-disposition", 'attachment; filename="kosmora-table.workspace.json"')
      .header("content-security-policy", "default-src 'none'; sandbox")
      .type("application/json; charset=utf-8")
      .send(value.revision.content);
  });
  app.delete<{ Params: Path }>(root + "/:id", { schema: { params } }, (req, reply) => {
    if (!ownTable(req, req.params)) return missing(reply);
    try {
      return store.delete(req.params.projectId, owner(req), req.params.id)
        ? reply.code(204).send()
        : missing(reply);
    } catch (error) {
      return handle(reply, error);
    }
  });
}
