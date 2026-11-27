import { Readable } from "node:stream";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { IdentityContext } from "@cosmora/contracts";
import { Type } from "typebox";
import { DocumentAnswerError } from "@cosmora/db";
import type { DocumentAnswerService } from "./document-answer-service.js";
import { DocumentAnswerUnavailable } from "./document-answer-service.js";

export function registerDocumentAnswerRoutes(
  app: FastifyInstance,
  service: DocumentAnswerService,
  identityFor: (request: FastifyRequest) => IdentityContext
): void {
  const base = "/api/v1/projects/:projectId/document-library/answers";
  const scope = Type.Object({ projectId: Type.String({ minLength: 1, maxLength: 120 }) });
  const item = Type.Object({
    projectId: Type.String({ minLength: 1, maxLength: 120 }),
    id: Type.String({ minLength: 1, maxLength: 120 })
  });
  const err = (
    reply: { code: (status: number) => { send: (v: unknown) => unknown } },
    cause: unknown
  ) => {
    if (cause instanceof DocumentAnswerUnavailable)
      return reply.code(503).send({ error: { code: "MODEL_OR_OWNER_BUDGET_UNAVAILABLE" } });
    if (cause instanceof DocumentAnswerError)
      return reply
        .code(
          cause.code === "NOT_FOUND"
            ? 404
            : cause.code === "QUIESCED"
              ? 423
              : cause.code === "CONFLICT"
                ? 409
                : 422
        )
        .send({ error: { code: cause.code } });
    throw cause;
  };
  app.get<{ Params: { projectId: string } }>(base, { schema: { params: scope } }, (req, reply) => {
    try {
      return {
        answers: service.store.list(req.params.projectId, identityFor(req).owner_id),
        available: service.isAvailable()
      };
    } catch (cause) {
      return err(reply, cause);
    }
  });
  app.post<{
    Params: { projectId: string };
    Body: { question: string; file_ids: string[]; mode?: "search" | "deep" };
  }>(
    base,
    {
      schema: {
        params: scope,
        body: Type.Object(
          {
            mode: Type.Optional(Type.Union([Type.Literal("search"), Type.Literal("deep")])),
            question: Type.String({ minLength: 2, maxLength: 500 }),
            file_ids: Type.Array(Type.String({ minLength: 1, maxLength: 120 }), {
              minItems: 1,
              maxItems: 100
            })
          },
          { additionalProperties: false }
        )
      }
    },
    async (req, reply) => {
      try {
        const answer = await service.ask(
          req.params.projectId,
          identityFor(req).owner_id,
          req.body.question,
          req.body.file_ids,
          req.body.mode
        );
        return reply.code(202).send(answer);
      } catch (cause) {
        return err(reply, cause);
      }
    }
  );
  const requestParam = Type.Object({
    projectId: Type.String({ minLength: 1, maxLength: 120 }),
    requestId: Type.String({ minLength: 1, maxLength: 160 })
  });
  // Declared before /:id so a stable retry id is never mistaken for an answer id.
  app.get<{ Params: { projectId: string; requestId: string } }>(
    `${base}/retry/:requestId`,
    { schema: { params: requestParam } },
    (req, reply) => {
      const answer = service.store.findByRetryRequest(
        req.params.projectId,
        identityFor(req).owner_id,
        req.params.requestId
      );
      return answer ?? reply.code(404).send({ error: { code: "NOT_FOUND" } });
    }
  );
  app.get<{ Params: { projectId: string; id: string } }>(
    `${base}/:id`,
    { schema: { params: item } },
    (req, reply) => {
      const answer = service.store.get(
        req.params.projectId,
        identityFor(req).owner_id,
        req.params.id
      );
      return answer ?? reply.code(404).send({ error: { code: "NOT_FOUND" } });
    }
  );
  app.post<{
    Params: { projectId: string; id: string };
    Body: { retry_request_id?: string };
    Headers: { "x-kosmora-retry-id"?: string };
  }>(
    `${base}/:id/retry`,
    {
      // No body schema: older clients send no body (and possibly only the
      // header). The optional id is validated explicitly below.
      schema: { params: item }
    },
    async (req, reply) => {
      try {
        // Body is preferred; the header keeps older clients working unchanged.
        const provided = req.body?.retry_request_id ?? req.headers["x-kosmora-retry-id"];
        if (provided !== undefined && (typeof provided !== "string" || provided.length > 160))
          return reply.code(400).send({ error: { code: "INVALID_RETRY_REQUEST_ID" } });
        const retryRequestId = provided?.trim() || undefined;
        const answer = await service.retry(
          req.params.projectId,
          identityFor(req).owner_id,
          req.params.id,
          retryRequestId
        );
        return reply.code(202).send(answer);
      } catch (cause) {
        return err(reply, cause);
      }
    }
  );
  app.get<{ Params: { projectId: string; id: string } }>(
    `${base}/:id/analysis.ndjson`,
    { schema: { params: item } },
    (req, reply) => {
      const owner = identityFor(req).owner_id;
      const run = service.store.get(req.params.projectId, owner, req.params.id);
      if (!run?.coverage) return reply.code(404).send({ error: { code: "NOT_FOUND" } });
      function* records() {
        if (!run) return;
        yield JSON.stringify({
          type: "coverage",
          id: run.id,
          retry_of: run.retry_of,
          status: run.status,
          question: run.question,
          coverage: run.coverage,
          summary: run.answer
        }) + "\n";
        for (const row of service.store.batches(run)) {
          if (reply.raw.destroyed) return;
          const { ordinal, input_hash } = row;
          yield JSON.stringify({
            type: row.verified ? "verified_batch" : "failed_batch",
            ordinal,
            input_hash,
            result: JSON.parse(row.notes) as unknown
          }) + "\n";
        }
      }
      return reply
        .header("Cache-Control", "private, no-store")
        .header("X-Content-Type-Options", "nosniff")
        .header("Content-Disposition", 'attachment; filename="kosmora-analysis.ndjson"')
        .type("application/x-ndjson")
        .send(Readable.from(records(), { objectMode: false }));
    }
  );
  app.post<{ Params: { projectId: string; id: string } }>(
    `${base}/:id/pause`,
    { schema: { params: item } },
    (req, reply) => {
      try {
        service.pause(req.params.projectId, identityFor(req).owner_id, req.params.id);
        return { status: "paused" };
      } catch (cause) {
        return err(reply, cause);
      }
    }
  );
  app.post<{ Params: { projectId: string; id: string } }>(
    `${base}/:id/cancel`,
    { schema: { params: item } },
    async (req, reply) => {
      const cancelled = await service.cancel(
        req.params.projectId,
        identityFor(req).owner_id,
        req.params.id
      );
      return cancelled
        ? { status: "cancel_requested" }
        : reply.code(404).send({ error: { code: "NOT_FOUND" } });
    }
  );
}
