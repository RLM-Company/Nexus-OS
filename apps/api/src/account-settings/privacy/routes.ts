import type { FastifyInstance, FastifyRequest } from "fastify";
import { Type } from "typebox";
import type { IdentityContext } from "@cosmora/contracts";
import type { AccountStore } from "../account-store.js";
import type { OwnerPrivacyCoordinator } from "./coordinator.js";
import {
  PrivacyIncompleteError,
  PrivacyOperationError,
  PrivacyUnavailableError
} from "./coordinator.js";
import { PrivacySegmentLimitError } from "./segmented-export.js";

const confirm = Type.Object(
  {
    confirmation_token: Type.String({ minLength: 20, maxLength: 128 }),
    phrase: Type.Literal("УДАЛИТЬ МОИ ДАННЫЕ")
  },
  { additionalProperties: false }
);
const binaryParams = Type.Object({
  store: Type.String({ maxLength: 64 }),
  id: Type.String({ maxLength: 500 })
});
const segmentQuery = Type.Object(
  {
    max_segment_bytes: Type.Optional(Type.Integer({ minimum: 4096, maximum: 20 * 1024 * 1024 }))
  },
  { additionalProperties: false }
);
const segmentDownloadQuery = Type.Object(
  {
    max_segment_bytes: Type.Optional(Type.Integer({ minimum: 4096, maximum: 20 * 1024 * 1024 })),
    plan_digest: Type.String({ pattern: "^[a-f0-9]{64}$" })
  },
  { additionalProperties: false }
);
const noCache = (reply: { header(name: string, value: string): unknown }) => {
  reply.header("Cache-Control", "private, no-store");
  reply.header("X-Content-Type-Options", "nosniff");
};
// Control characters must be removed from the Content-Disposition filename.
const safeFilename = (name: string) =>
  // eslint-disable-next-line no-control-regex
  name.replace(/[\r\n"\\/\x00-\x1f\x7f]/g, "_").slice(0, 180) || "original";
export function registerPrivacyRoutes(
  app: FastifyInstance,
  coordinator: OwnerPrivacyCoordinator,
  account: AccountStore,
  identityFor: (request: FastifyRequest) => IdentityContext
): void {
  app.get("/api/v1/personal-settings/privacy", async (request, reply) => {
    noCache(reply);
    return coordinator.overview(identityFor(request).owner_id);
  });
  app.get("/api/v1/personal-settings/privacy/preview", async (request, reply) => {
    noCache(reply);
    try {
      const result = await coordinator.export(identityFor(request).owner_id);
      return {
        complete: true,
        generated_at: result.generated_at,
        record_count: result.record_count,
        original_count: result.original_count,
        sections: Object.fromEntries(
          Object.entries(result.sections).map(([name, s]) => [
            name,
            {
              records: s.count,
              originals: s.originals.length,
              collections: Object.fromEntries(
                Object.entries(s.records).map(([key, rows]) => [key, rows.length])
              )
            }
          ])
        ),
        retained: result.retained
      };
    } catch (e) {
      return reply.status(e instanceof PrivacyIncompleteError ? 413 : 503).send({
        error: {
          code: e instanceof PrivacyIncompleteError ? e.code : "PRIVACY_NOT_READY",
          message: e instanceof Error ? e.message : "Unavailable"
        }
      });
    }
  });
  app.get("/api/v1/personal-settings/export", async (request, reply) => {
    noCache(reply);
    try {
      const archive = await coordinator.exportArchive(identityFor(request).owner_id);
      reply.header("Content-Type", "application/zip");
      reply.header("Content-Disposition", 'attachment; filename="kosmora-complete-export.zip"');
      reply.header("Content-Length", String(archive.byteLength));
      return reply.send(archive);
    } catch (e) {
      return reply.status(e instanceof PrivacyIncompleteError ? 413 : 503).send({
        error: {
          code: e instanceof PrivacyIncompleteError ? e.code : "PRIVACY_NOT_READY",
          message: e instanceof Error ? e.message : "Unavailable"
        }
      });
    }
  });
  app.get(
    "/api/v1/personal-settings/export/segments",
    { schema: { querystring: segmentQuery } },
    async (request, reply) => {
      noCache(reply);
      const query = request.query as { max_segment_bytes?: number };
      try {
        return await coordinator.exportSegmentedPlan(
          identityFor(request).owner_id,
          query.max_segment_bytes === undefined ? {} : { maxSegmentBytes: query.max_segment_bytes }
        );
      } catch (cause) {
        return reply
          .code(
            cause instanceof PrivacyIncompleteError || cause instanceof PrivacySegmentLimitError
              ? 413
              : cause instanceof PrivacyOperationError
                ? 409
                : 503
          )
          .send({
            error: {
              code: cause instanceof PrivacyIncompleteError ? cause.code : "PRIVACY_NOT_READY",
              message: cause instanceof Error ? cause.message : "Unavailable"
            }
          });
      }
    }
  );
  app.get(
    "/api/v1/personal-settings/export/segments/:segment",
    {
      schema: {
        params: Type.Object(
          { segment: Type.Integer({ minimum: 0, maximum: 4095 }) },
          { additionalProperties: false }
        ),
        querystring: segmentDownloadQuery
      }
    },
    async (request, reply) => {
      noCache(reply);
      const params = request.params as { segment: number };
      const query = request.query as { plan_digest: string; max_segment_bytes?: number };
      try {
        const { archive, plan } = await coordinator.exportSegmentArchive(
          identityFor(request).owner_id,
          params.segment,
          {
            expectedPlanDigest: query.plan_digest,
            ...(query.max_segment_bytes === undefined
              ? {}
              : { maxSegmentBytes: query.max_segment_bytes })
          }
        );
        return reply
          .header("Content-Type", "application/zip")
          .header(
            "Content-Disposition",
            `attachment; filename="kosmora-export-${params.segment + 1}-of-${plan.total_segments}.zip"`
          )
          .header("Content-Length", String(archive.length))
          .send(archive);
      } catch (cause) {
        return reply
          .code(
            cause instanceof PrivacyIncompleteError || cause instanceof PrivacySegmentLimitError
              ? 413
              : cause instanceof PrivacyOperationError
                ? 409
                : 503
          )
          .send({
            error: {
              code: cause instanceof PrivacyIncompleteError ? cause.code : "PRIVACY_NOT_READY",
              message: cause instanceof Error ? cause.message : "Unavailable"
            }
          });
      }
    }
  );
  app.get(
    "/api/v1/personal-settings/binaries/:store/:id",
    { schema: { params: binaryParams } },
    async (request, reply) => {
      noCache(reply);
      const params = request.params as { store: string; id: string };
      try {
        const output = await coordinator.binary(
          identityFor(request).owner_id,
          params.store,
          params.id
        );
        if (!output) return reply.status(404).send({ error: { code: "BINARY_NOT_FOUND" } });
        reply.header(
          "Content-Disposition",
          `attachment; filename="${safeFilename(output.original.filename)}"`
        );
        reply.header("Content-Type", output.original.content_type);
        reply.header("Content-Length", String(output.original.size_bytes));
        return reply.send(output.stream);
      } catch {
        return reply.status(503).send({ error: { code: "BINARY_UNAVAILABLE" } });
      }
    }
  );
  app.post("/api/v1/personal-settings/delete-challenge", async (request, reply) => {
    noCache(reply);
    const owner = identityFor(request).owner_id;
    if (!coordinator.overview(owner).ready)
      return reply.status(409).send({
        error: {
          code: "PRIVACY_ADAPTERS_UNAVAILABLE",
          message: "Required stores or owner lifecycle not ready"
        }
      });
    return account.createDeleteChallenge(owner);
  });
  app.post(
    "/api/v1/personal-settings/delete",
    { schema: { body: confirm } },
    async (request, reply) => {
      noCache(reply);
      const body = request.body as { confirmation_token: string; phrase: string };
      try {
        return await coordinator.delete(
          identityFor(request).owner_id,
          body.confirmation_token,
          body.phrase
        );
      } catch (e) {
        return reply.status(e instanceof PrivacyUnavailableError ? 503 : 409).send({
          error: {
            code: e instanceof Error && "code" in e ? String(e.code) : "PRIVACY_DELETE_BLOCKED",
            message: e instanceof Error ? e.message : "Deletion blocked"
          }
        });
      }
    }
  );
}
