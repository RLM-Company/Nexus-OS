import type { FastifyInstance, FastifyRequest } from "fastify";
import { createHash } from "node:crypto";
import { Type } from "typebox";
import type { IdentityContext } from "@cosmora/contracts";
import {
  CANVAS_MAX_CONTENT_BYTES,
  CANVAS_MAX_TITLE_BYTES,
  type CanvasFormat
} from "@cosmora/contracts";
import { type CanvasArtifactStore, CanvasConflictError, CanvasLimitError } from "@cosmora/db";

const idString = Type.String({ minLength: 1, maxLength: 128 });
const params = Type.Object({ projectId: idString, id: idString }, { additionalProperties: false });
const projectParams = Type.Object({ projectId: idString }, { additionalProperties: false });
const revisionParams = Type.Object(
  { projectId: idString, id: idString, version: Type.Integer({ minimum: 1 }) },
  { additionalProperties: false }
);
const formatSchema = Type.Union([
  Type.Literal("markdown"),
  Type.Literal("text"),
  Type.Literal("code"),
  Type.Literal("html")
]);
const title = Type.String({ minLength: 1, maxLength: CANVAS_MAX_TITLE_BYTES });
const content = Type.String({ maxLength: CANVAS_MAX_CONTENT_BYTES });
const draftFields = { title, format: formatSchema, content };
const draftBody = Type.Object(draftFields, { additionalProperties: false });
const updateBody = Type.Object(
  { ...draftFields, baseVersion: Type.Integer({ minimum: 1 }) },
  { additionalProperties: false }
);
const importBody = Type.Object(
  {
    title,
    format: formatSchema,
    source: Type.Union([
      Type.Object(
        { kind: Type.Literal("work"), work_artifact_id: idString },
        { additionalProperties: false }
      ),
      Type.Object(
        { kind: Type.Literal("chat"), chat_id: idString, message_id: idString },
        { additionalProperties: false }
      ),
      Type.Object(
        { kind: Type.Literal("project_chat"), message_id: idString },
        { additionalProperties: false }
      )
    ])
  },
  { additionalProperties: false }
);
type Path = { projectId: string; id: string };
const notFound = (reply: { code: (n: number) => { send: (o: unknown) => unknown } }) =>
  reply.code(404).send({ error: { code: "CANVAS_NOT_FOUND" } });
const filename = (name: string, format: CanvasFormat) => {
  const ext = { markdown: ".md", text: ".txt", code: ".txt", html: ".html" }[format];
  // RFC 5987, never let user title inject Content-Disposition headers.
  const safe = Array.from(name, (character) =>
    character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127 ? "_" : character
  )
    .join("")
    .replace(/[\\/]/g, "_")
    .slice(0, 100);
  const encoded = encodeURIComponent((safe + ext).toWellFormed()).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  );
  return `attachment; filename="canvas${ext}"; filename*=UTF-8''${encoded}`;
};
export function registerCanvasRoutes(
  app: FastifyInstance,
  store: CanvasArtifactStore,
  identityFor: (request: FastifyRequest) => IdentityContext
): void {
  const path = "/api/v1/projects/:projectId/canvas";
  const owner = (request: FastifyRequest) => identityFor(request).owner_id;
  const handle = (
    reply: { code: (n: number) => { send: (o: unknown) => unknown } },
    error: unknown
  ) => {
    if (error instanceof CanvasConflictError)
      return reply
        .code(409)
        .send({ error: { code: "CANVAS_VERSION_CONFLICT", currentVersion: error.currentVersion } });
    if (error instanceof CanvasLimitError)
      return reply
        .code(error.code === "CANVAS_OWNER_FENCED" ? 409 : 413)
        .send({ error: { code: error.code } });
    if (error instanceof Error && error.message === "CANVAS_INVALID_CONTENT")
      return reply.code(400).send({ error: { code: "CANVAS_INVALID_CONTENT" } });
    throw error;
  };
  // Resolve authenticated draft scope before the browser restores any local content.
  // This is an opaque storage namespace, never an authorization credential.
  app.get<{ Params: { projectId: string } }>(
    path + "/scope",
    { schema: { params: projectParams } },
    (req, reply) => {
      const ownerId = owner(req);
      if (!store.list(req.params.projectId, ownerId, 1)) return notFound(reply);
      return {
        owner_scope: createHash("sha256").update(`kosmora:canvas:${ownerId}`).digest("hex")
      };
    }
  );
  app.get<{ Params: { projectId: string }; Querystring: { limit?: number; offset?: number } }>(
    path,
    {
      schema: {
        params: projectParams,
        querystring: Type.Object(
          {
            limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
            offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 10000 }))
          },
          { additionalProperties: false }
        )
      }
    },
    (req, reply) => {
      const items = store.list(req.params.projectId, owner(req), req.query.limit, req.query.offset);
      return items ? { items } : notFound(reply);
    }
  );
  app.get<{ Params: { projectId: string } }>(
    path + "/sources",
    { schema: { params: projectParams } },
    (req, reply) => {
      const items = store.importCandidates(req.params.projectId, owner(req));
      return items ? { items } : notFound(reply);
    }
  );
  app.post<{
    Params: { projectId: string };
    Body: { title: string; format: CanvasFormat; content: string };
  }>(path, { schema: { params: projectParams, body: draftBody } }, (req, reply) => {
    try {
      const result = store.create(req.params.projectId, owner(req), req.body);
      return result ? reply.code(201).send(result) : notFound(reply);
    } catch (error) {
      return handle(reply, error);
    }
  });
  app.post<{
    Params: { projectId: string };
    Body: {
      title: string;
      format: CanvasFormat;
      source:
        | { kind: "work"; work_artifact_id: string }
        | { kind: "chat"; chat_id: string; message_id: string }
        | { kind: "project_chat"; message_id: string };
    };
  }>(path + "/import", { schema: { params: projectParams, body: importBody } }, (req, reply) => {
    try {
      const result = store.importSource(req.params.projectId, owner(req), req.body);
      return result ? reply.code(201).send(result) : notFound(reply);
    } catch (error) {
      return handle(reply, error);
    }
  });
  app.get<{ Params: Path }>(
    path + "/:id",
    { schema: { params } },
    (req, reply) => store.get(req.params.projectId, owner(req), req.params.id) ?? notFound(reply)
  );
  app.put<{
    Params: Path;
    Body: { title: string; format: CanvasFormat; content: string; baseVersion: number };
  }>(path + "/:id", { schema: { params, body: updateBody } }, (req, reply) => {
    try {
      return (
        store.update(req.params.projectId, owner(req), req.params.id, req.body) ?? notFound(reply)
      );
    } catch (error) {
      return handle(reply, error);
    }
  });
  app.get<{ Params: Path; Querystring: { limit?: number; offset?: number } }>(
    path + "/:id/revisions",
    {
      schema: {
        params,
        querystring: Type.Object(
          {
            limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
            offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 500 }))
          },
          { additionalProperties: false }
        )
      }
    },
    (req, reply) => {
      const items = store.history(
        req.params.projectId,
        owner(req),
        req.params.id,
        req.query.limit,
        req.query.offset
      );
      return items ? { items } : notFound(reply);
    }
  );
  app.get<{ Params: Path & { version: number } }>(
    path + "/:id/revisions/:version",
    { schema: { params: revisionParams } },
    (req, reply) =>
      store.getRevision(req.params.projectId, owner(req), req.params.id, req.params.version) ??
      notFound(reply)
  );
  app.get<{ Params: Path & { version: number } }>(
    path + "/:id/revisions/:version/download",
    { schema: { params: revisionParams } },
    (req, reply) => {
      const revision = store.getRevision(
        req.params.projectId,
        owner(req),
        req.params.id,
        req.params.version
      );
      if (!revision) return notFound(reply);
      if (createHash("sha256").update(revision.content).digest("hex") !== revision.sha256)
        return reply.code(409).send({ error: { code: "CANVAS_REVISION_CORRUPT" } });
      return reply
        .header(
          "content-disposition",
          filename(`${revision.title}-v${revision.version}`, revision.format)
        )
        .header("x-content-type-options", "nosniff")
        .header("cache-control", "no-store")
        .header("content-security-policy", "default-src 'none'; sandbox")
        .header("x-canvas-version", String(revision.version))
        .header("x-canvas-sha256", revision.sha256)
        .type("text/plain; charset=utf-8")
        .send(revision.content);
    }
  );
  app.post<{ Params: Path; Body: { baseVersion: number; sourceVersion: number } }>(
    path + "/:id/restore",
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
      try {
        return (
          store.restore(
            req.params.projectId,
            owner(req),
            req.params.id,
            req.body.baseVersion,
            req.body.sourceVersion
          ) ?? notFound(reply)
        );
      } catch (error) {
        return handle(reply, error);
      }
    }
  );
  app.delete<{ Params: Path }>(path + "/:id", { schema: { params } }, (req, reply) => {
    try {
      return store.delete(req.params.projectId, owner(req), req.params.id)
        ? reply.code(204).send()
        : notFound(reply);
    } catch (error) {
      return handle(reply, error);
    }
  });
  app.get<{ Params: Path }>(path + "/:id/download", { schema: { params } }, (req, reply) => {
    const result = store.get(req.params.projectId, owner(req), req.params.id);
    if (!result) return notFound(reply);
    return (
      reply
        .header("content-disposition", filename(result.artifact.title, result.artifact.format))
        .header("x-content-type-options", "nosniff")
        .header("cache-control", "no-store")
        // HTML and code are ALWAYS delivered as text/plain attachment, never executable in this origin.
        .header("content-security-policy", "default-src 'none'; sandbox")
        .type("text/plain; charset=utf-8")
        .send(result.revision.content)
    );
  });
}
