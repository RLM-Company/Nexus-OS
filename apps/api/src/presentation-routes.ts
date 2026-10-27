import type { FastifyInstance, FastifyRequest } from "fastify";
import type { IdentityContext } from "@cosmora/contracts";
import { PresentationError, type PresentationStore } from "@cosmora/db";
import { Type } from "typebox";

export function registerPresentationRoutes(
  app: FastifyInstance,
  store: PresentationStore,
  identityFor: (request: FastifyRequest) => IdentityContext
): void {
  const base = "/api/v1/presentations";
  const params = Type.Object({ id: Type.String({ format: "uuid" }) });
  const title = Type.String({ minLength: 1, maxLength: 160 });
  const slide = Type.Object(
    {
      id: Type.String({ minLength: 1, maxLength: 80, pattern: "^[a-zA-Z0-9_-]+$" }),
      layout: Type.Union([
        Type.Literal("title"),
        Type.Literal("content"),
        Type.Literal("two-column"),
        Type.Literal("quote")
      ]),
      title: Type.String({ maxLength: 180 }),
      body: Type.String({ maxLength: 4000 }),
      aside: Type.String({ maxLength: 4000 }),
      notes: Type.String({ maxLength: 4000 })
    },
    { additionalProperties: false }
  );
  const error = (
    reply: { code: (status: number) => { send: (body: unknown) => unknown } },
    cause: unknown
  ) => {
    if (!(cause instanceof PresentationError)) throw cause;
    const status =
      cause.code === "NOT_FOUND"
        ? 404
        : cause.code === "IMPORT_DELETED"
          ? 410
          : cause.code === "CONFLICT"
            ? 409
            : cause.code === "OWNER_DATA_FENCED"
              ? 423
              : cause.code === "LIMIT_EXCEEDED"
                ? 413
                : 400;
    return reply.code(status).send({ error: { code: cause.code } });
  };
  const content = {
    title,
    theme: Type.Union([Type.Literal("paper"), Type.Literal("night"), Type.Literal("ocean")]),
    slides: Type.Array(slide, { minItems: 1, maxItems: 50 })
  };

  app.post<{
    Body: { format: "kosmora-presentation-v1"; title: string; theme: string; slides: unknown[] };
  }>(
    `${base}/import`,
    {
      bodyLimit: 350_000,
      schema: {
        body: Type.Object(
          { format: Type.Literal("kosmora-presentation-v1"), ...content },
          { additionalProperties: false }
        )
      }
    },
    (request, reply) => {
      try {
        return reply.code(201).send(store.import(identityFor(request).owner_id, request.body));
      } catch (cause) {
        return error(reply, cause);
      }
    }
  );
  app.get<{ Params: { id: string } }>(
    `${base}/:id/versions`,
    { schema: { params } },
    (request, reply) => {
      try {
        return { items: store.versions(identityFor(request).owner_id, request.params.id) };
      } catch (cause) {
        return error(reply, cause);
      }
    }
  );
  app.get<{ Params: { id: string; version: number } }>(
    `${base}/:id/versions/:version`,
    {
      schema: {
        params: Type.Object({
          id: Type.String({ format: "uuid" }),
          version: Type.Integer({ minimum: 1 })
        })
      }
    },
    (request, reply) => {
      try {
        return store.revision(
          identityFor(request).owner_id,
          request.params.id,
          request.params.version
        );
      } catch (cause) {
        return error(reply, cause);
      }
    }
  );
  app.post<{ Params: { id: string }; Body: { expected_version: number; source_version: number } }>(
    `${base}/:id/restore`,
    {
      schema: {
        params,
        body: Type.Object(
          {
            expected_version: Type.Integer({ minimum: 1 }),
            source_version: Type.Integer({ minimum: 1 })
          },
          { additionalProperties: false }
        )
      }
    },
    (request, reply) => {
      try {
        return store.restore(
          identityFor(request).owner_id,
          request.params.id,
          request.body.expected_version,
          request.body.source_version
        );
      } catch (cause) {
        return error(reply, cause);
      }
    }
  );

  app.get(base, (request) => ({ items: store.list(identityFor(request).owner_id) }));
  app.post<{ Body: { title: string } }>(
    base,
    {
      schema: { body: Type.Object({ title }, { additionalProperties: false }) }
    },
    (request, reply) => {
      try {
        return reply
          .code(201)
          .send(store.create(identityFor(request).owner_id, request.body.title));
      } catch (cause) {
        return error(reply, cause);
      }
    }
  );
  app.get<{ Params: { id: string } }>(`${base}/:id`, { schema: { params } }, (request, reply) => {
    try {
      return store.get(identityFor(request).owner_id, request.params.id);
    } catch (cause) {
      return error(reply, cause);
    }
  });
  app.put<{
    Params: { id: string };
    Body: { version: number; title: string; theme: "paper" | "night" | "ocean"; slides: unknown[] };
  }>(
    `${base}/:id`,
    {
      bodyLimit: 350_000,
      schema: {
        params,
        body: Type.Object(
          {
            version: Type.Integer({ minimum: 1 }),
            ...content
          },
          { additionalProperties: false }
        )
      }
    },
    (request, reply) => {
      try {
        return store.save(
          identityFor(request).owner_id,
          request.params.id,
          request.body.version,
          request.body
        );
      } catch (cause) {
        return error(reply, cause);
      }
    }
  );
  app.delete<{ Params: { id: string }; Querystring: { version: number } }>(
    `${base}/:id`,
    {
      schema: { params, querystring: Type.Object({ version: Type.Integer({ minimum: 1 }) }) }
    },
    (request, reply) => {
      try {
        store.delete(identityFor(request).owner_id, request.params.id, request.query.version);
        return reply.code(204).send();
      } catch (cause) {
        return error(reply, cause);
      }
    }
  );
}
