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
        : cause.code === "CONFLICT"
          ? 409
          : cause.code === "OWNER_DATA_FENCED"
            ? 423
            : cause.code === "LIMIT_EXCEEDED"
              ? 413
              : 400;
    return reply.code(status).send({ error: { code: cause.code } });
  };

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
            title,
            theme: Type.Union([
              Type.Literal("paper"),
              Type.Literal("night"),
              Type.Literal("ocean")
            ]),
            slides: Type.Array(slide, { minItems: 1, maxItems: 50 })
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
