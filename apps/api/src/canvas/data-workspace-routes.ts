import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { Type } from "typebox";
import type { IdentityContext } from "@cosmora/contracts";
import type { CanvasRevision } from "@cosmora/contracts/canvas-artifacts";
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
  const revisionParams = Type.Object(
    { projectId: id, id, version: Type.Integer({ minimum: 1, maximum: 500 }) },
    { additionalProperties: false }
  );
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
  const verified = (revision: CanvasRevision) =>
    createHash("sha256").update(revision.content).digest("hex") === revision.sha256;
  const corrupt = (reply: FastifyReply) =>
    reply.code(409).send({ error: { code: "DATA_WORKSPACE_REVISION_CORRUPT" } });
  const download = (revision: CanvasRevision, reply: FastifyReply) => {
    if (!verified(revision)) return corrupt(reply);
    return reply
      .header(
        "content-disposition",
        `attachment; filename="kosmora-table-v${revision.version}.workspace.json"`
      )
      .header("content-security-policy", "default-src 'none'; sandbox")
      .header("x-table-version", String(revision.version))
      .header("x-table-sha256", revision.sha256)
      .type("application/json; charset=utf-8")
      .send(revision.content);
  };
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
  app.get<{ Params: Path }>(root + "/:id", { schema: { params } }, (req, reply) => {
    if (!ownTable(req, req.params)) return missing(reply);
    const value = store.get(req.params.projectId, owner(req), req.params.id);
    if (!value) return missing(reply);
    return verified(value.revision) ? value : corrupt(reply);
  });
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
  app.get<{ Params: Path & { version: number } }>(
    root + "/:id/revisions/:version",
    { schema: { params: revisionParams } },
    (req, reply) => {
      if (!ownTable(req, req.params)) return missing(reply);
      const revision = store.getRevision(
        req.params.projectId,
        owner(req),
        req.params.id,
        req.params.version
      );
      if (!revision) return missing(reply);
      return verified(revision) ? revision : corrupt(reply);
    }
  );
  app.get<{ Params: Path & { version: number } }>(
    root + "/:id/revisions/:version/download",
    { schema: { params: revisionParams } },
    (req, reply) => {
      if (!ownTable(req, req.params)) return missing(reply);
      const revision = store.getRevision(
        req.params.projectId,
        owner(req),
        req.params.id,
        req.params.version
      );
      return revision ? download(revision, reply) : missing(reply);
    }
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
      if (!verified(original)) return corrupt(reply);
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
    return download(value.revision, reply);
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
