import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { Type } from "typebox";
import type { IdentityContext } from "@cosmora/contracts";
import { OwnerSkillError, type OwnerSkillStore } from "@cosmora/db";
import {
  AcceptSkillCorrectionSchema,
  SkillCorrectionProposalSchema,
  SkillResultEvaluationSchema
} from "@cosmora/contracts";
import { evaluateSkillResult, proposeSkillCorrection } from "@cosmora/core";
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
const creationHeaders = Type.Object(
  {
    "idempotency-key": Type.Optional(
      Type.String({ pattern: "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$" })
    )
  },
  { additionalProperties: true }
);

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
        : cause.code === "VERSION_CONFLICT" || cause.code === "REQUEST_CONFLICT"
          ? 409
          : cause.code === "CREATION_DELETED"
            ? 410
            : cause.code === "LIMIT_REACHED"
              ? 413
              : cause.code === "OWNER_DATA_FENCED"
                ? 423
                : 400;
    return reply.code(status).send({ error: { code: cause.code } });
  };
  app.get(`${base}/scope`, (request) => ({
    owner_scope: createHash("sha256")
      .update(`kosmora:skills:${identityFor(request).owner_id}`)
      .digest("hex")
  }));
  // Inert: builds a draft from the owner's own correction text and stores NOTHING.
  // No other chats are read and no personality inference is made.
  app.post<{ Body: { correction: string } }>(
    `${base}/corrections/propose`,
    { schema: { body: SkillCorrectionProposalSchema } },
    (request, reply) => {
      reply.header("Cache-Control", "private, no-store");
      try {
        return { draft: proposeSkillCorrection(request.body.correction) };
      } catch {
        return reply.code(400).send({ error: { code: "INVALID_CORRECTION" } });
      }
    }
  );
  // Model-free, stateless check of an answer against explicit criteria. Never
  // claims to verify truth, intelligence or benchmark gain.
  app.post<{
    Body: {
      source: string;
      answer: string;
      required_facts: string[];
      forbidden: string[];
      format: "bullets" | "plain" | "any";
    };
  }>(
    `${base}/evaluate-result`,
    { schema: { body: SkillResultEvaluationSchema } },
    (request, reply) => {
      reply.header("Cache-Control", "private, no-store");
      return evaluateSkillResult(request.body);
    }
  );
  // The ONLY path that persists a correction: explicit owner accept with the
  // exact draft shown before. Reuses OwnerSkillStore.create() and its
  // idempotent creation receipt; no second store or hidden learning.
  app.post<{
    Body: {
      client_request_id: string;
      draft: { format: string; name: string; summary: string; instructions: string };
    };
  }>(
    `${base}/corrections/accept`,
    { schema: { body: AcceptSkillCorrectionSchema } },
    (request, reply) => {
      reply.header("Cache-Control", "private, no-store");
      try {
        const { client_request_id, draft: value } = request.body;
        const skill = store.create(
          identityFor(request).owner_id,
          { name: value.name, summary: value.summary, instructions: value.instructions },
          client_request_id
        );
        return reply.code(201).send({ skill });
      } catch (cause) {
        return handle(reply, cause);
      }
    }
  );
  app.get<{ Params: { requestId: string } }>(
    `${base}/creations/:requestId`,
    {
      schema: { params: Type.Object({ requestId: id }) }
    },
    (request, reply) => {
      try {
        const skill = store.creation(identityFor(request).owner_id, request.params.requestId);
        if (!skill) throw new OwnerSkillError("NOT_FOUND");
        reply.header("Cache-Control", "private, no-store");
        return skill;
      } catch (cause) {
        return handle(reply, cause);
      }
    }
  );
  app.get(base, (request) => ({ items: store.list(identityFor(request).owner_id) }));
  app.post<{ Body: OwnerSkillPackage; Headers: { "idempotency-key"?: string } }>(
    `${base}/import`,
    {
      schema: {
        headers: creationHeaders,
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
          .send(
            store.create(
              identityFor(request).owner_id,
              verifyOwnerSkillPackage(request.body),
              request.headers["idempotency-key"]
            )
          );
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
  app.post<{
    Body: { name: string; summary: string; instructions: string };
    Headers: { "idempotency-key"?: string };
  }>(base, { schema: { body: draft, headers: creationHeaders } }, (request, reply) => {
    try {
      return reply
        .code(201)
        .send(
          store.create(
            identityFor(request).owner_id,
            request.body,
            request.headers["idempotency-key"]
          )
        );
    } catch (cause) {
      return handle(reply, cause);
    }
  });
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
