import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { Type } from "typebox";
import { TypeBoxValidatorCompiler } from "@fastify/type-provider-typebox";
import type { IdentityContext } from "@cosmora/contracts";
import type { CanvasRevision } from "@cosmora/contracts/canvas-artifacts";
import { DATA_SERVER_BYTES } from "@cosmora/contracts/data-workspace";
import {
  TableAnalysisError,
  TableComparisonError,
  compareTables,
  type TableAlignment,
  selectTable,
  profileTable,
  tableRows,
  exportTableCsv,
  exportTableJson,
  type TableScope
} from "@cosmora/core";
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
    if (error instanceof TableComparisonError)
      return reply.code(error.code === "TABLE_COMPARE_INVALID" ? 400 : 422).send({
        error: { code: error.code, ...(error.side ? { side: error.side, row: error.row } : {}) }
      });
    if (error instanceof TableAnalysisError)
      return reply.code(400).send({ error: { code: error.code } });
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
  const keyColumns = Type.Array(Type.Integer({ minimum: 1, maximum: 100 }), {
    minItems: 1,
    maxItems: 3,
    uniqueItems: true
  });
  app.post<{
    Params: Path;
    Body: {
      before_version: number;
      after_version: number;
      alignment: TableAlignment;
      offset?: number;
      limit?: number;
      include_values?: boolean;
    };
  }>(
    root + "/:id/compare",
    {
      bodyLimit: 4096,
      validatorCompiler: TypeBoxValidatorCompiler,
      schema: {
        params,
        body: Type.Object(
          {
            before_version: Type.Integer({ minimum: 1, maximum: 20 }),
            after_version: Type.Integer({ minimum: 1, maximum: 20 }),
            alignment: Type.Union([
              Type.Object({ kind: Type.Literal("position") }, { additionalProperties: false }),
              Type.Object(
                {
                  kind: Type.Literal("key"),
                  before_columns: keyColumns,
                  after_columns: keyColumns
                },
                { additionalProperties: false }
              )
            ]),
            offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 160000 })),
            limit: Type.Optional(Type.Integer({ minimum: 0, maximum: 200 })),
            include_values: Type.Optional(Type.Boolean())
          },
          { additionalProperties: false }
        )
      }
    },
    (req, reply) => {
      if (!ownTable(req, req.params)) return missing(reply);
      const before = store.getRevision(
        req.params.projectId,
        owner(req),
        req.params.id,
        req.body.before_version
      );
      const after = store.getRevision(
        req.params.projectId,
        owner(req),
        req.params.id,
        req.body.after_version
      );
      if (!before || !after) return missing(reply);
      if (!verified(before) || !verified(after)) return corrupt(reply);
      try {
        const result = compareTables(before.content, after.content, {
          alignment: req.body.alignment,
          ...(req.body.offset === undefined ? {} : { offset: req.body.offset }),
          ...(req.body.limit === undefined ? {} : { limit: req.body.limit }),
          ...(req.body.include_values === undefined
            ? {}
            : { include_values: req.body.include_values })
        });
        const content = JSON.stringify({
          ...result,
          source: {
            table_id: req.params.id,
            before: { version: before.version, sha256: before.sha256 },
            after: { version: after.version, sha256: after.sha256 }
          }
        });
        if (Buffer.byteLength(content) > 1_000_000)
          return reply.code(413).send({ error: { code: "TABLE_COMPARE_RESULT_TOO_LARGE" } });
        return reply.type("application/json; charset=utf-8").send(content);
      } catch (error) {
        return handle(reply, error);
      }
    }
  );
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
  // Read-only derived results are always pinned to an immutable, checksum-verified revision.
  const scopeSchema = Type.Optional(Type.Union([Type.Literal("all"), Type.Literal("view")]));
  type DerivedQuery = {
    scope?: TableScope;
    offset?: number;
    limit?: number;
    format?: "csv" | "json";
  };
  for (const operation of ["analysis", "rows", "export"] as const) {
    const querystring =
      operation === "rows"
        ? Type.Object(
            {
              scope: scopeSchema,
              offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 80_000 })),
              limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 }))
            },
            { additionalProperties: false }
          )
        : operation === "export"
          ? Type.Object(
              {
                scope: scopeSchema,
                format: Type.Union([Type.Literal("csv"), Type.Literal("json")])
              },
              { additionalProperties: false }
            )
          : Type.Object({ scope: scopeSchema }, { additionalProperties: false });
    app.get<{ Params: Path & { version: number }; Querystring: DerivedQuery }>(
      root + "/:id/revisions/:version/" + operation,
      { schema: { params: revisionParams, querystring } },
      (req, reply) => {
        if (!ownTable(req, req.params)) return missing(reply);
        const revision = store.getRevision(
          req.params.projectId,
          owner(req),
          req.params.id,
          req.params.version
        );
        if (!revision) return missing(reply);
        if (!verified(revision)) return corrupt(reply);
        reply
          .header("x-table-version", String(revision.version))
          .header("x-table-sha256", revision.sha256);
        try {
          const selection = selectTable(revision.content, req.query.scope ?? "view");
          if (operation === "analysis") return profileTable(selection);
          if (operation === "rows")
            return tableRows(selection, req.query.offset ?? 0, req.query.limit ?? 100);
          const format = req.query.format!;
          const content = format === "csv" ? exportTableCsv(selection) : exportTableJson(selection);
          if (Buffer.byteLength(content) > 32_000_000)
            return reply.code(413).send({ error: { code: "TABLE_EXPORT_TOO_LARGE" } });
          return reply
            .header(
              "content-disposition",
              `attachment; filename="kosmora-table-v${revision.version}-${selection.scope}.${format}"`
            )
            .header("content-security-policy", "default-src 'none'; sandbox")
            .header("x-export-sha256", createHash("sha256").update(content).digest("hex"))
            .type(format === "csv" ? "text/csv; charset=utf-8" : "application/json; charset=utf-8")
            .send(content);
        } catch (error) {
          return handle(reply, error);
        }
      }
    );
  }
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
