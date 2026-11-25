import type { FastifyInstance, FastifyRequest } from "fastify";
import { Type } from "typebox";
import type { IdentityContext } from "@cosmora/contracts";
import { ProjectCorrectionRuleError, type ProjectCorrectionRuleStore } from "@cosmora/db";
import { applyProjectRulesToWorkResult, proposeSkillCorrection } from "@cosmora/core";

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
  /** Real Work API results reader; injected by the server when available. */
  workResults?: (
    ownerId: string,
    dagId: string
  ) => { files: Array<{ name: string; content: string }> };
}): void {
  const { app, store, identityFor, workResults } = options;
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
            : cause.code === "CONFLICT"
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
    (_request, reply) => {
      reply.header("Cache-Control", "private, no-store");
      try {
        return { draft: proposeSkillCorrection(_request.body.correction) };
      } catch {
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
      const proposed = proposeSkillCorrection(request.body.correction);
      const rule = store.create({
        projectId: request.params.projectId,
        ownerId: identityFor(request).owner_id,
        clientRequestId: request.body.client_request_id,
        name: proposed.name,
        summary: proposed.summary,
        instructions: proposed.instructions
      });
      return reply.code(201).send({ rule, draft: proposed });
    } catch (cause) {
      return fail(reply, cause);
    }
  });

  app.get<{ Params: { projectId: string } }>(base, { schema: { params: scope } }, (request) => ({
    rules: store.list(request.params.projectId, identityFor(request).owner_id)
  }));

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

  app.post<{ Params: { projectId: string; id: string } }>(
    `${base}/:id/rollback`,
    { schema: { params: item } },
    (request, reply) => {
      try {
        return {
          rule: store.rollback(
            request.params.projectId,
            identityFor(request).owner_id,
            request.params.id
          )
        };
      } catch (cause) {
        return fail(reply, cause);
      }
    }
  );

  // Ordinary Koswork task entry point: apply accepted rules to a real Work
  // artifact. Rules never rewrite the immutable original; the report records
  // exact applied versions, conflicts and unknown/inapplicable statuses.
  app.post<{
    Params: { projectId: string };
    Body: { dag_id: string; file_name?: string };
  }>(
    `${base}/work-apply`,
    {
      schema: {
        params: scope,
        body: Type.Object(
          {
            dag_id: Type.String({ minLength: 1, maxLength: 120 }),
            file_name: Type.Optional(Type.String({ minLength: 1, maxLength: 120 }))
          },
          { additionalProperties: false }
        )
      }
    },
    (request, reply) => {
      const ownerId = identityFor(request).owner_id;
      if (!workResults)
        return reply.code(503).send({ error: { code: "WORK_RESULTS_UNAVAILABLE" } });
      let results: { files: Array<{ name: string; content: string }> };
      try {
        results = workResults(ownerId, request.body.dag_id);
      } catch {
        return reply.code(404).send({ error: { code: "WORK_DAG_NOT_FOUND" } });
      }
      const file = results.files.find(
        (item) => item.name === (request.body.file_name ?? results.files[0]?.name)
      );
      if (!file) return reply.code(404).send({ error: { code: "WORK_ARTIFACT_NOT_FOUND" } });
      const rules = store.active(request.params.projectId, ownerId);
      const report = applyProjectRulesToWorkResult(file.content, rules);
      return {
        source: { dag_id: request.body.dag_id, file_name: file.name },
        rule_versions: rules.map((rule) => ({ id: rule.id, version: rule.version })),
        ...report
      };
    }
  );
}
