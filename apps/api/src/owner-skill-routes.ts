import type { FastifyInstance, FastifyRequest } from "fastify";
import { Type } from "typebox";
import type { IdentityContext } from "@cosmora/contracts";
import { OwnerSkillError, type OwnerSkillStore } from "@cosmora/db";
import {
  exportOwnerSkillPackage,
  verifyOwnerSkillPackage,
  type OwnerSkillPackage
} from "./owner-skill-package.js";

const draft = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 80 }),
    summary: Type.String({ minLength: 1, maxLength: 240 }),
    instructions: Type.String({ minLength: 1, maxLength: 20_000 })
  },
  { additionalProperties: false }
);
const version = Type.Integer({ minimum: 1, maximum: 20 });
const id = Type.String({ format: "uuid" });

export function registerOwnerSkillRoutes(
  app: FastifyInstance,
  store: OwnerSkillStore,
  identityFor: (request: FastifyRequest) => IdentityContext
): void {
  const base = "/api/v1/owner-skills";
  const handle = (
    reply: { code: (status: number) => { send: (body: unknown) => unknown } },
    cause: unknown
  ) => {
    if (!(cause instanceof OwnerSkillError)) throw cause;
    const status =
      cause.code === "NOT_FOUND"
        ? 404
        : cause.code === "VERSION_CONFLICT"
          ? 409
          : cause.code === "LIMIT_REACHED"
            ? 413
            : cause.code === "OWNER_DATA_FENCED"
              ? 423
              : 400;
    return reply.code(status).send({ error: { code: cause.code } });
  };
  app.get(base, (request) => ({ items: store.list(identityFor(request).owner_id) }));
  app.post<{ Body: OwnerSkillPackage }>(
    `${base}/import`,
    {
      schema: {
        body: Type.Object(
          {
            format: Type.Literal("kosmora.skill.v1"),
            name: Type.String({ minLength: 1, maxLength: 80 }),
            summary: Type.String({ minLength: 1, maxLength: 240 }),
            instructions: Type.String({ minLength: 1, maxLength: 20_000 }),
            execution: Type.Literal("disabled"),
            permissions: Type.Array(Type.Never(), { maxItems: 0 }),
            sha256: Type.String({ pattern: "^[a-f0-9]{64}$" })
          },
          { additionalProperties: false }
        )
      }
    },
    (request, reply) => {
      try {
        return reply
          .code(201)
          .send(store.create(identityFor(request).owner_id, verifyOwnerSkillPackage(request.body)));
      } catch (cause) {
        return handle(reply, cause);
      }
    }
  );
  app.get<{ Params: { id: string } }>(
    `${base}/:id/package`,
    { schema: { params: Type.Object({ id }) } },
    (request, reply) => {
      try {
        const latest = store.get(identityFor(request).owner_id, request.params.id).versions[0];
        if (!latest) throw new OwnerSkillError("NOT_FOUND");
        reply.header("Content-Disposition", 'attachment; filename="skill.json"');
        reply.header("Cache-Control", "private, no-store");
        return exportOwnerSkillPackage(latest);
      } catch (cause) {
        return handle(reply, cause);
      }
    }
  );
  app.get<{ Params: { id: string } }>(
    `${base}/:id`,
    { schema: { params: Type.Object({ id }) } },
    (request, reply) => {
      try {
        return store.get(identityFor(request).owner_id, request.params.id);
      } catch (cause) {
        return handle(reply, cause);
      }
    }
  );
  app.post<{ Body: { name: string; summary: string; instructions: string } }>(
    base,
    { schema: { body: draft } },
    (request, reply) => {
      try {
        return reply.code(201).send(store.create(identityFor(request).owner_id, request.body));
      } catch (cause) {
        return handle(reply, cause);
      }
    }
  );
  app.put<{
    Params: { id: string };
    Body: { expected_version: number; name: string; summary: string; instructions: string };
  }>(
    `${base}/:id`,
    {
      schema: {
        params: Type.Object({ id }),
        body: Type.Object(
          {
            expected_version: version,
            name: Type.String({ minLength: 1, maxLength: 80 }),
            summary: Type.String({ minLength: 1, maxLength: 240 }),
            instructions: Type.String({ minLength: 1, maxLength: 20_000 })
          },
          { additionalProperties: false }
        )
      }
    },
    (request, reply) => {
      try {
        return store.update(
          identityFor(request).owner_id,
          request.params.id,
          request.body.expected_version,
          request.body
        );
      } catch (cause) {
        return handle(reply, cause);
      }
    }
  );
  app.post<{ Params: { id: string }; Body: { expected_version: number; source_version: number } }>(
    `${base}/:id/restore`,
    {
      schema: {
        params: Type.Object({ id }),
        body: Type.Object(
          { expected_version: version, source_version: version },
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
        return handle(reply, cause);
      }
    }
  );
  app.delete<{ Params: { id: string }; Body: { expected_version: number } }>(
    `${base}/:id`,
    {
      schema: {
        params: Type.Object({ id }),
        body: Type.Object({ expected_version: version }, { additionalProperties: false })
      }
    },
    (request, reply) => {
      try {
        store.delete(
          identityFor(request).owner_id,
          request.params.id,
          request.body.expected_version
        );
        return reply.code(204).send();
      } catch (cause) {
        return handle(reply, cause);
      }
    }
  );
}
