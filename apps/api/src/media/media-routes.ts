import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { Type } from "typebox";
import type { IdentityContext } from "@cosmora/contracts";
import { ChatImageAttachmentSchema, type ChatImageAttachment } from "@cosmora/contracts";
import { MediaCapabilityError, type MediaAudioMime } from "@cosmora/model-gateway";
import type { MediaService } from "./media-service.js";

const bad = (
  reply: { code: (value: number) => { send: (value: unknown) => unknown } },
  status: number,
  code: string,
  reason?: string
) => reply.code(status).send({ error: { code, ...(reason ? { reason } : {}) } });

const params = Type.Object({ id: Type.String({ format: "uuid" }) });
type Id = { id: string };

const extractHeaderRequestId = (request: FastifyRequest): string | undefined => {
  const ids = [
    request.headers["x-client-request-id"],
    request.headers["idempotency-key"],
    (request.body as { client_request_id?: unknown } | null)?.client_request_id
  ].filter((value) => value !== undefined);
  if (ids.some((value) => typeof value !== "string" || !/^[A-Za-z0-9._:-]{1,128}$/.test(value)))
    throw new Error("INVALID_CLIENT_REQUEST_ID");
  if (new Set(ids).size > 1) throw new Error("REQUEST_ID_CONFLICT");
  return ids[0] as string | undefined;
};

const mapMediaRouteError = (reply: FastifyReply, error: unknown, fallbackCode: string) => {
  if (error instanceof MediaCapabilityError) {
    return bad(reply, 400, error.code, error.reason);
  }
  const code = error instanceof Error ? error.message : fallbackCode;
  if (code === "CONSENT_REQUIRED") return bad(reply, 403, code);
  if (code === "MEDIA_BUSY" || code === "IDEMPOTENCY_CONFLICT") return bad(reply, 409, code);
  if (
    code === "MEDIA_LIMIT" ||
    (error as { code?: unknown } | null)?.code === "USAGE_LIMIT_EXCEEDED"
  ) {
    return bad(reply, 429, "MEDIA_LIMIT");
  }
  if (
    code === "TEXT_REQUIRED" ||
    code === "IMAGE_REFERENCES_INVALID" ||
    code === "REQUEST_ID_CONFLICT" ||
    code === "INVALID_CLIENT_REQUEST_ID" ||
    code === "AUDIO_SIZE_INVALID" ||
    code === "AUDIO_FORMAT_INVALID" ||
    code === "AUDIO_DURATION_INVALID" ||
    code === "capability_unavailable"
  ) {
    return bad(reply, 400, code);
  }
  if (code === "MEDIA_UNAVAILABLE" || code === "IMAGE_EDITING_UNAVAILABLE")
    return bad(reply, 503, code);
  return bad(reply, fallbackCode === "TRANSCRIPTION_FAILED" ? 400 : 503, fallbackCode);
};

export function registerMediaRoutes(
  app: FastifyInstance,
  service: MediaService,
  identityFor: (request: FastifyRequest) => IdentityContext
): void {
  app.addHook("onSend", (request, reply, _payload, done) => {
    if (request.url.startsWith("/api/v1/media/"))
      reply.header("Cache-Control", "private, no-store");
    done();
  });
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
    browser: {
      speech_recognition: "client-detected",
      speech_synthesis: "client-detected",
      mode: "browser_local_or_vendor_unverified",
      server_voice_assistant: false
    }
  }));

  app.get("/api/v1/media/jobs", (request) => ({
    items: service.list(identityFor(request).owner_id)
  }));

  app.post(
    "/api/v1/media/images",
    {
      schema: {
        body: Type.Object(
          {
            prompt: Type.String({ minLength: 1, maxLength: 2000 }),
            references: Type.Optional(Type.Array(ChatImageAttachmentSchema, { maxItems: 2 })),
            explicit_paid_consent: Type.Boolean(),
            client_request_id: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
            size: Type.Optional(Type.String({ minLength: 1, maxLength: 32 })),
            resolution: Type.Optional(Type.String({ minLength: 1, maxLength: 32 })),
            aspect_ratio: Type.Optional(Type.String({ minLength: 1, maxLength: 16 })),
            quality: Type.Optional(Type.String({ minLength: 1, maxLength: 16 })),
            format: Type.Optional(Type.String({ minLength: 1, maxLength: 16 })),
            output_format: Type.Optional(Type.String({ minLength: 1, maxLength: 16 })),
            count: Type.Optional(Type.Integer({ minimum: 1, maximum: 10 })),
            n: Type.Optional(Type.Integer({ minimum: 1, maximum: 10 })),
            reference_image: Type.Optional(Type.Unknown()),
            reference_image_url: Type.Optional(Type.String({ maxLength: 2048 })),
            reference_image_base64: Type.Optional(Type.String({ maxLength: 2_000_000 }))
          },
          { additionalProperties: false }
        )
      }
    },
    async (request, reply) => {
      const body = request.body as {
        prompt: string;
        references?: ChatImageAttachment[];
        explicit_paid_consent: boolean;
        client_request_id?: string;
        size?: string;
        resolution?: string;
        aspect_ratio?: string;
        quality?: string;
        format?: string;
        output_format?: string;
        count?: number;
        n?: number;
        reference_image?: unknown;
        reference_image_url?: string;
        reference_image_base64?: string;
      };
      if (!body.prompt || !body.prompt.trim()) return bad(reply, 400, "TEXT_REQUIRED");
      try {
        const job = service.enqueue(
          identityFor(request).owner_id,
          "image",
          body.prompt,
          body.explicit_paid_consent,
          {
            client_request_id: extractHeaderRequestId(request),
            size: body.size,
            resolution: body.resolution,
            aspect_ratio: body.aspect_ratio,
            quality: body.quality,
            format: body.format,
            output_format: body.output_format,
            count: body.count,
            n: body.n,
            reference_image: body.reference_image,
            reference_image_url: body.reference_image_url,
            reference_image_base64: body.reference_image_base64
          },
          body.references
        );
        return reply.code(202).send(job);
      } catch (error) {
        return mapMediaRouteError(reply, error, "MEDIA_FAILURE");
      }
    }
  );

  app.post(
    "/api/v1/media/speech",
    {
      schema: {
        body: Type.Object(
          {
            text: Type.String({ minLength: 1, maxLength: 4096 }),
            explicit_paid_consent: Type.Boolean(),
            client_request_id: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
            voice: Type.Optional(Type.String({ minLength: 1, maxLength: 32 })),
            format: Type.Optional(Type.String({ minLength: 1, maxLength: 16 })),
            response_format: Type.Optional(Type.String({ minLength: 1, maxLength: 16 })),
            speed: Type.Optional(Type.Number())
          },
          { additionalProperties: false }
        )
      }
    },
    async (request, reply) => {
      const body = request.body as {
        text: string;
        explicit_paid_consent: boolean;
        client_request_id?: string;
        voice?: string;
        format?: string;
        response_format?: string;
        speed?: number;
      };
      if (!body.text || !body.text.trim()) return bad(reply, 400, "TEXT_REQUIRED");
      try {
        const job = service.enqueue(
          identityFor(request).owner_id,
          "speech",
          body.text,
          body.explicit_paid_consent,
          {
            client_request_id: extractHeaderRequestId(request),
            voice: body.voice,
            format: body.format,
            response_format: body.response_format,
            speed: body.speed
          }
        );
        return reply.code(202).send(job);
      } catch (error) {
        return mapMediaRouteError(reply, error, "MEDIA_FAILURE");
      }
    }
  );

  app.post<{
    Body: {
      mime: string;
      audio_base64: string;
      explicit_paid_consent: boolean;
      client_request_id?: string;
      language?: string;
      duration_seconds?: number;
    };
  }>(
    "/api/v1/media/transcriptions",
    {
      schema: {
        body: Type.Object(
          {
            mime: Type.String({ minLength: 1, maxLength: 64 }),
            audio_base64: Type.String({
              minLength: 4,
              maxLength: 2_000_000,
              pattern: "^[A-Za-z0-9+/]+={0,2}$"
            }),
            explicit_paid_consent: Type.Boolean(),
            client_request_id: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
            language: Type.Optional(Type.String({ minLength: 2, maxLength: 16 })),
            duration_seconds: Type.Optional(Type.Number())
          },
          { additionalProperties: false }
        )
      }
    },
    async (request, reply) => {
      const bytes = Buffer.from(request.body.audio_base64, "base64");
      try {
        return reply.code(202).send(
          service.enqueueTranscription(
            identityFor(request).owner_id,
            bytes,
            request.body.mime as MediaAudioMime,
            request.body.explicit_paid_consent,
            {
              client_request_id: extractHeaderRequestId(request),
              language: request.body.language,
              duration_seconds: request.body.duration_seconds
            }
          )
        );
      } catch (error) {
        return mapMediaRouteError(reply, error, "TRANSCRIPTION_FAILED");
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
