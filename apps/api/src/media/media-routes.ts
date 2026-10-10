import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { Type } from "typebox";
import type { IdentityContext } from "@cosmora/contracts";
import type { MediaService } from "./media-service.js";

const bad = (
  reply: { code: (value: number) => { send: (value: unknown) => unknown } },
  status: number,
  code: string
) => reply.code(status).send({ error: { code } });
const params = Type.Object({ id: Type.String({ format: "uuid" }) });
type Id = { id: string };

export function registerMediaRoutes(
  app: FastifyInstance,
  service: MediaService,
  identityFor: (request: FastifyRequest) => IdentityContext
): void {
  // Non-simple owner-confirmation header prevents cross-origin form submission of paid work.
  app.addHook("preHandler", (request, reply, done) => {
    if (
      request.url.startsWith("/api/v1/media/") &&
      request.method === "POST" &&
      request.headers["x-kosmora-media-consent"] !== "explicit"
    ) {
      void bad(reply, 403, "EXPLICIT_HEADER_REQUIRED");
      return;
    }
    done();
  });
  app.get("/api/v1/media/capabilities", () => ({
    capabilities: service.capabilities(),
    browser: { speech_recognition: "client-detected", speech_synthesis: "client-detected" }
  }));
  app.get("/api/v1/media/jobs", (request) => ({
    items: service.list(identityFor(request).owner_id)
  }));
  const onSubmit =
    (kind: "image" | "speech") => async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as {
        prompt?: string;
        text?: string;
        explicit_paid_consent: boolean;
      };
      const value = kind === "image" ? body.prompt : body.text;
      if (!value || !value.trim()) return bad(reply, 400, "TEXT_REQUIRED");
      try {
        return reply
          .code(202)
          .send(
            service.enqueue(identityFor(request).owner_id, kind, value, body.explicit_paid_consent)
          );
      } catch (error) {
        const code = error instanceof Error ? error.message : "MEDIA_FAILURE";
        return bad(
          reply,
          code === "CONSENT_REQUIRED"
            ? 403
            : code === "MEDIA_BUSY"
              ? 409
              : code === "MEDIA_LIMIT"
                ? 429
                : 503,
          code
        );
      }
    };
  app.post(
    "/api/v1/media/images",
    {
      schema: {
        body: Type.Object(
          {
            prompt: Type.String({ minLength: 1, maxLength: 2000 }),
            explicit_paid_consent: Type.Boolean()
          },
          { additionalProperties: false }
        )
      }
    },
    onSubmit("image")
  );
  app.post(
    "/api/v1/media/speech",
    {
      schema: {
        body: Type.Object(
          {
            text: Type.String({ minLength: 1, maxLength: 4096 }),
            explicit_paid_consent: Type.Boolean()
          },
          { additionalProperties: false }
        )
      }
    },
    onSubmit("speech")
  );
  app.post<{
    Body: {
      mime: "audio/webm" | "audio/wav" | "audio/mp4" | "audio/mpeg";
      audio_base64: string;
      explicit_paid_consent: boolean;
    };
  }>(
    "/api/v1/media/transcriptions",
    {
      schema: {
        body: Type.Object(
          {
            mime: Type.Union([
              Type.Literal("audio/webm"),
              Type.Literal("audio/wav"),
              Type.Literal("audio/mp4"),
              Type.Literal("audio/mpeg")
            ]),
            audio_base64: Type.String({
              minLength: 4,
              maxLength: 2_000_000,
              pattern: "^[A-Za-z0-9+/]+={0,2}$"
            }),
            explicit_paid_consent: Type.Boolean()
          },
          { additionalProperties: false }
        )
      }
    },
    async (request, reply) => {
      const bytes = Buffer.from(request.body.audio_base64, "base64");
      try {
        return reply
          .code(202)
          .send(
            service.enqueueTranscription(
              identityFor(request).owner_id,
              bytes,
              request.body.mime,
              request.body.explicit_paid_consent
            )
          );
      } catch (error) {
        const code =
          error instanceof Error &&
          [
            "MEDIA_UNAVAILABLE",
            "CONSENT_REQUIRED",
            "AUDIO_SIZE_INVALID",
            "AUDIO_FORMAT_INVALID",
            "MEDIA_BUSY",
            "MEDIA_LIMIT"
          ].includes(error.message)
            ? error.message
            : "TRANSCRIPTION_FAILED";
        return bad(
          reply,
          code === "CONSENT_REQUIRED"
            ? 403
            : code === "MEDIA_UNAVAILABLE"
              ? 503
              : code === "MEDIA_BUSY"
                ? 409
                : code === "MEDIA_LIMIT"
                  ? 429
                  : 400,
          code
        );
      }
    }
  );
  app.get<{ Params: Id }>(
    "/api/v1/media/jobs/:id",
    { schema: { params } },
    (request, reply) =>
      service.get(request.params.id, identityFor(request).owner_id) ??
      bad(reply, 404, "MEDIA_NOT_FOUND")
  );
  app.delete<{ Params: Id }>(
    "/api/v1/media/jobs/:id",
    { schema: { params } },
    (request, reply) =>
      service.cancel(request.params.id, identityFor(request).owner_id) ??
      bad(reply, 404, "MEDIA_NOT_FOUND")
  );
  // Explicit deletion of an owned asset/job, distinct from cancellation (which retains history).
  app.delete<{ Params: Id }>(
    "/api/v1/media/assets/:id",
    { schema: { params } },
    async (request, reply) =>
      (await service.delete(request.params.id, identityFor(request).owner_id))
        ? { deleted: true }
        : bad(reply, 404, "MEDIA_NOT_FOUND")
  );
  app.get<{ Params: Id; Querystring: { download?: string } }>(
    "/api/v1/media/assets/:id",
    {
      schema: {
        params,
        querystring: Type.Object(
          { download: Type.Optional(Type.Literal("1")) },
          { additionalProperties: false }
        )
      }
    },
    (request, reply) => {
      const asset = service.asset(request.params.id, identityFor(request).owner_id);
      if (!asset) return bad(reply, 404, "MEDIA_NOT_FOUND");
      reply.header("Cache-Control", "private, no-store");
      reply.header("X-Content-Type-Options", "nosniff");
      reply.header("Content-Security-Policy", "default-src 'none'; sandbox");
      if (request.query.download === "1")
        reply.header(
          "Content-Disposition",
          `attachment; filename="kosmora-${request.params.id}.${asset.extension}"`
        );
      return reply.type(asset.mime).send(asset.bytes);
    }
  );
}
