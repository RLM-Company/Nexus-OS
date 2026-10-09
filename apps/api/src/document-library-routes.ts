import type { FastifyInstance, FastifyRequest } from "fastify";
import { Type } from "typebox";
import type { IdentityContext } from "@cosmora/contracts";
import { DocumentLibraryError, type DocumentLibraryStore } from "@cosmora/db";
import { chunkLibraryPages, libraryTerms, rankLibraryChunks, libraryCitation } from "@cosmora/core";

/** Requires the existing owner authentication hook in buildApp; no independent auth bypass. */
export function registerDocumentLibraryRoutes(
  app: FastifyInstance,
  store: DocumentLibraryStore,
  identityFor: (request: FastifyRequest) => IdentityContext
): void {
  app.addContentTypeParser(
    "application/octet-stream",
    {
      parseAs: "buffer",
      bodyLimit: 20_000_000
    },
    (_request, body, done) => done(null, body)
  );
  const base = "/api/v1/projects/:projectId/document-library";
  const params = Type.Object({ projectId: Type.String({ minLength: 1, maxLength: 120 }) });
  const fileParams = Type.Object({
    projectId: Type.String({ minLength: 1, maxLength: 120 }),
    fileId: Type.String({ minLength: 1, maxLength: 120 })
  });
  type Scope = { projectId: string };
  type FileScope = Scope & { fileId: string };
  const errors = (
    reply: { code: (code: number) => { send: (value: unknown) => unknown } },
    error: unknown
  ) => {
    if (!(error instanceof DocumentLibraryError)) throw error;
    const status =
      error.code === "NOT_FOUND"
        ? 404
        : error.code === "CONFLICT"
          ? 409
          : error.code === "QUOTA_EXCEEDED"
            ? 413
            : 400;
    return reply.code(status).send({ error: { code: error.code } });
  };

  app.get<{ Params: Scope }>(base, { schema: { params } }, (request, reply) => {
    try {
      return { files: store.list(request.params.projectId, identityFor(request).owner_id) };
    } catch (error) {
      return errors(reply, error);
    }
  });

  app.post<{ Params: Scope; Body: Buffer }>(
    base,
    {
      schema: { params },
      bodyLimit: 20_000_000
    },
    (request, reply) => {
      try {
        if (!Buffer.isBuffer(request.body))
          return reply.code(415).send({ error: { code: "INVALID_FILE" } });
        const raw = request.headers["x-kosmora-file-name"];
        if (typeof raw !== "string" || raw.length > 1_600)
          return reply.code(400).send({ error: { code: "INVALID_FILE" } });
        let name: string;
        try {
          name = decodeURIComponent(raw);
        } catch {
          return reply.code(400).send({ error: { code: "INVALID_FILE" } });
        }
        const file = store.stage(
          request.params.projectId,
          identityFor(request).owner_id,
          name,
          request.body
        );
        return reply.code(201).send(file);
      } catch (error) {
        return errors(reply, error);
      }
    }
  );

  app.put<{ Params: FileScope; Body: { pages: Array<{ page: number | null; text: string }> } }>(
    `${base}/:fileId/index`,
    {
      schema: {
        params: fileParams,
        body: Type.Object(
          {
            pages: Type.Array(
              Type.Object(
                {
                  page: Type.Union([Type.Integer({ minimum: 1, maximum: 500 }), Type.Null()]),
                  text: Type.String({ maxLength: 2_000_000 })
                },
                { additionalProperties: false }
              ),
              { minItems: 1, maxItems: 500 }
            )
          },
          { additionalProperties: false }
        )
      },
      bodyLimit: 12_000_000
    },
    (request, reply) => {
      try {
        let chunks;
        try {
          chunks = chunkLibraryPages(request.body.pages);
        } catch {
          return reply.code(400).send({ error: { code: "INVALID_INDEX" } });
        }
        return store.complete(
          request.params.projectId,
          identityFor(request).owner_id,
          request.params.fileId,
          request.body.pages,
          chunks
        );
      } catch (error) {
        return errors(reply, error);
      }
    }
  );

  app.post<{ Params: FileScope }>(
    `${base}/:fileId/failed`,
    { schema: { params: fileParams } },
    (request, reply) => {
      const file = store.get(
        request.params.projectId,
        identityFor(request).owner_id,
        request.params.fileId
      );
      if (!file) return reply.code(404).send({ error: { code: "NOT_FOUND" } });
      if (file.status !== "processing")
        return reply.code(409).send({ error: { code: "CONFLICT" } });
      store.fail(request.params.projectId, identityFor(request).owner_id, request.params.fileId);
      return { status: "failed" };
    }
  );

  app.post<{ Params: FileScope }>(`${base}/:fileId/retry`, { schema: { params: fileParams } }, (request, reply) => {
    try { return store.retry(request.params.projectId, identityFor(request).owner_id, request.params.fileId); }
    catch(error) { return errors(reply,error); }
  });
  app.post<{ Params: FileScope }>(`${base}/:fileId/cancel`, { schema: { params: fileParams } }, (request, reply) => {
    if (!store.get(request.params.projectId, identityFor(request).owner_id, request.params.fileId))
      return reply.code(404).send({ error: { code: "NOT_FOUND" } });
    return {cancelled:store.cancelIndex(request.params.projectId,identityFor(request).owner_id,request.params.fileId)};
  });
  app.delete<{ Params: FileScope }>(
    `${base}/:fileId`,
    { schema: { params: fileParams } },
    (request, reply) =>
      store.remove(request.params.projectId, identityFor(request).owner_id, request.params.fileId)
        ? reply.code(204).send()
        : reply.code(404).send({ error: { code: "NOT_FOUND" } })
  );

  app.get<{ Params: FileScope }>(
    `${base}/:fileId/download`,
    { schema: { params: fileParams } },
    (request, reply) => {
      const file = store.original(
        request.params.projectId,
        identityFor(request).owner_id,
        request.params.fileId
      );
      if (!file) return reply.code(404).send({ error: { code: "NOT_FOUND" } });
      return reply
        .header("Cache-Control", "private, no-store")
        .header("X-Content-Type-Options", "nosniff")
        .header(
          "Content-Disposition",
          `attachment; filename="document"; filename*=UTF-8''${encodeURIComponent(file.name)}`
        )
        .type("application/octet-stream")
        .send(file.bytes);
    }
  );

  app.post<{ Params: Scope; Body: { question: string; file_ids: string[] } }>(
    `${base}/search`,
    {
      schema: {
        params,
        body: Type.Object(
          {
            question: Type.String({ minLength: 2, maxLength: 500 }),
            file_ids: Type.Array(Type.String({ minLength: 1, maxLength: 120 }), { maxItems: 100 })
          },
          { additionalProperties: false }
        )
      }
    },
    (request, reply) => {
      try {
        const terms = libraryTerms(request.body.question);
        const rows = store.search(
          request.params.projectId,
          identityFor(request).owner_id,
          terms,
          request.body.file_ids
        );
        return {
          hits: rankLibraryChunks(rows, request.body.question).map((hit) => ({
            ...hit,
            citation: libraryCitation(hit)
          }))
        };
      } catch (error) {
        return errors(reply, error);
      }
    }
  );
}
