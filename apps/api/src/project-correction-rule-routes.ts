import type { FastifyInstance, FastifyRequest } from "fastify";
import { Type } from "typebox";
import type { IdentityContext } from "@cosmora/contracts";
import { ProjectCorrectionRuleError, type ProjectCorrectionRuleStore } from "@cosmora/db";
import { proposeSkillCorrection, supplierRuleEffect } from "@cosmora/core";

const scope = Type.Object({ projectId: Type.String({ minLength: 1, maxLength: 120 }) });
const item = Type.Object({
  projectId: Type.String({ minLength: 1, maxLength: 120 }),
  id: Type.String({ minLength: 1, maxLength: 120 })
});
const version = Type.Object({ expected_version: Type.Integer({ minimum: 1 }) });
const draft = Type.Object({
  client_request_id: Type.String({ minLength: 1, maxLength: 128 }),
  correction: Type.String({ minLength: 2, maxLength: 2000 })
});

export function registerProjectCorrectionRuleRoutes(options: {
  app: FastifyInstance;
  store: ProjectCorrectionRuleStore;
  identityFor: (request: FastifyRequest) => IdentityContext;
}): void {
  const { app, store, identityFor } = options;
  const base = "/api/v1/projects/:projectId/correction-rules";
  const fail = (
    reply: { code(status: number): { send(value: unknown): unknown } },
    cause: unknown
  ) => {
    if (cause instanceof ProjectCorrectionRuleError)
      return reply
        .code(
          cause.code === "NOT_FOUND"
            ? 404
            : cause.code === "CONFLICT" || cause.code === "OWNER_DATA_FENCED"
              ? 409
              : cause.code === "NO_PREVIOUS_VERSION"
                ? 422
                : 400
        )
        .send({ error: { code: cause.code } });
    throw cause;
  };

  // Reuses the existing inert Skills proposal loop: nothing is stored here.
  app.post<{ Params: { projectId: string }; Body: { correction: string } }>(
    `${base}/propose`,
    {
      schema: {
        params: scope,
        body: Type.Object({ correction: Type.String({ minLength: 2, maxLength: 2000 }) })
      }
    },
    (request, reply) => {
      reply.header("Cache-Control", "private, no-store");
      try {
        store.assertProject(request.params.projectId, identityFor(request).owner_id);
        return { draft: proposeSkillCorrection(request.body.correction) };
      } catch (cause) {
        if (cause instanceof ProjectCorrectionRuleError) return fail(reply, cause);
        return reply.code(400).send({ error: { code: "INVALID_CORRECTION" } });
      }
    }
  );

  app.post<{
    Params: { projectId: string };
    Body: { client_request_id: string; correction: string };
  }>(`${base}/accept`, { schema: { params: scope, body: draft } }, (request, reply) => {
    reply.header("Cache-Control", "private, no-store");
    try {
      store.assertProject(request.params.projectId, identityFor(request).owner_id);
      const proposed = proposeSkillCorrection(request.body.correction);
      const name = supplierRuleEffect(proposed.instructions)
        ? "Доставка отдельной строкой"
        : proposed.name;
      const rule = store.create({
        projectId: request.params.projectId,
        ownerId: identityFor(request).owner_id,
        clientRequestId: request.body.client_request_id,
        name,
        summary: proposed.summary,
        instructions: proposed.instructions
      });
      return reply.code(201).send({ rule, draft: proposed });
    } catch (cause) {
      if (cause instanceof Error && cause.message === "INVALID_CORRECTION")
        return reply.code(400).send({ error: { code: cause.message } });
      return fail(reply, cause);
    }
  });

  app.get<{ Params: { projectId: string } }>(
    base,
    { schema: { params: scope } },
    (request, reply) => {
      reply.header("Cache-Control", "private, no-store");
      try {
        return { rules: store.list(request.params.projectId, identityFor(request).owner_id) };
      } catch (cause) {
        return fail(reply, cause);
      }
    }
  );

  app.post<{
    Params: { projectId: string; id: string };
    Body: { expected_version: number };
  }>(`${base}/:id/disable`, { schema: { params: item, body: version } }, (request, reply) => {
    try {
      return {
        rule: store.setEnabled(
          request.params.projectId,
          identityFor(request).owner_id,
          request.params.id,
          false,
          request.body.expected_version
        )
      };
    } catch (cause) {
      return fail(reply, cause);
    }
  });

  app.post<{
    Params: { projectId: string; id: string };
    Body: { expected_version: number };
  }>(`${base}/:id/enable`, { schema: { params: item, body: version } }, (request, reply) => {
    try {
      return {
        rule: store.setEnabled(
          request.params.projectId,
          identityFor(request).owner_id,
          request.params.id,
          true,
          request.body.expected_version
        )
      };
    } catch (cause) {
      return fail(reply, cause);
    }
  });

  app.post<{ Params: { projectId: string; id: string }; Body: { expected_version: number } }>(
    `${base}/:id/rollback`,
    { schema: { params: item, body: version } },
    (request, reply) => {
      try {
        return {
          rule: store.rollback(
            request.params.projectId,
            identityFor(request).owner_id,
            request.params.id,
            request.body.expected_version
          )
        };
      } catch (cause) {
        return fail(reply, cause);
      }
    }
  );
}
