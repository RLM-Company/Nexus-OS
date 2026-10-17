import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { Type } from "typebox";
import type { IdentityContext } from "@cosmora/contracts";
import {
  parsePresentationPackage,
  presentationWorkGoal,
  type PresentationWorkReference,
  type PresentationWorkPreview
} from "@cosmora/contracts/presentation-package";
import {
  ManagerWorkConflict,
  PresentationError,
  type ManagerWorkStore,
  type PresentationStore,
  type ProjectStore
} from "@cosmora/db";

class ResultError extends Error {
  constructor(
    readonly status: number,
    readonly code: string
  ) {
    super(code);
  }
}

export function registerPresentationWorkRoutes(options: {
  app: FastifyInstance;
  presentations: PresentationStore;
  works: ManagerWorkStore;
  projects: ProjectStore;
  identityFor: (request: FastifyRequest) => IdentityContext;
}): void {
  const { app, presentations, works, projects, identityFor } = options;
  const id = Type.String({ minLength: 1, maxLength: 160 });
  const reference = Type.Object(
    {
      project_id: id,
      work_id: id,
      artifact_id: id,
      version: Type.Integer({ minimum: 1 }),
      sha256: Type.String({ pattern: "^[a-f0-9]{64}$" })
    },
    { additionalProperties: false }
  );
  const fail = (reply: FastifyReply, cause: unknown) => {
    if (cause instanceof ResultError)
      return reply.code(cause.status).send({ error: { code: cause.code } });
    if (cause instanceof PresentationError) {
      const status =
        cause.code === "NOT_FOUND"
          ? 404
          : cause.code === "CONFLICT"
            ? 409
            : cause.code === "IMPORT_DELETED"
              ? 410
              : cause.code === "OWNER_DATA_FENCED"
                ? 423
                : cause.code === "LIMIT_EXCEEDED"
                  ? 413
                  : 400;
      return reply.code(status).send({ error: { code: cause.code } });
    }
    if (cause instanceof ManagerWorkConflict)
      return reply
        .code(cause.message.includes("OWNER_") ? 423 : 409)
        .send({ error: { code: cause.message } });
    if (cause instanceof Error && cause.message === "INVALID_PRESENTATION_REQUEST")
      return reply.code(400).send({ error: { code: cause.message } });
    throw cause;
  };
  const preview = (owner: string, ref: PresentationWorkReference): PresentationWorkPreview => {
    if (!projects.getProject(ref.project_id, owner))
      throw new ResultError(404, "WORK_RESULT_NOT_FOUND");
    const work = works.get(ref.work_id, owner);
    const file = works.runtime.artifact(ref.project_id, owner, ref.artifact_id);
    if (
      !work ||
      work.project_id !== ref.project_id ||
      !file ||
      file.metadata.work_id !== ref.work_id
    )
      throw new ResultError(404, "WORK_RESULT_NOT_FOUND");
    if (work.status !== "completed" || work.review?.verdict !== "PASS")
      throw new ResultError(409, "WORK_REVIEW_REQUIRED");
    if (file.metadata.version !== ref.version || file.metadata.sha256 !== ref.sha256)
      throw new ResultError(409, "WORK_RESULT_CHANGED");
    if (
      createHash("sha256").update(file.content).digest("hex") !== ref.sha256 ||
      Buffer.byteLength(file.content) !== file.metadata.bytes
    )
      throw new ResultError(409, "WORK_RESULT_CORRUPT");
    let content;
    try {
      content = parsePresentationPackage(file.content, false);
    } catch {
      throw new ResultError(422, "INVALID_PRESENTATION_RESULT");
    }
    return {
      package: content,
      source: {
        ...ref,
        name: file.metadata.name,
        created_at: file.metadata.created_at,
        model_sources: (work.result_sources ?? []).map(({ run_id, provider, model, stage }) => ({
          run_id,
          provider,
          model,
          stage
        })),
        critic: { verdict: "PASS", reason: work.review.reason }
      }
    };
  };

  app.post<{
    Params: { projectId: string };
    Body: { client_request_id: string; topic: string; slide_count: number };
  }>(
    "/api/v1/projects/:projectId/presentation-work",
    {
      schema: {
        params: Type.Object({ projectId: id }, { additionalProperties: false }),
        body: Type.Object(
          {
            client_request_id: id,
            topic: Type.String({ minLength: 1, maxLength: 4000, pattern: "\\S" }),
            slide_count: Type.Integer({ minimum: 3, maximum: 8 })
          },
          { additionalProperties: false }
        )
      }
    },
    (request, reply) => {
      const identity = identityFor(request);
      if (!projects.getProject(request.params.projectId, identity.owner_id))
        return reply.code(404).send({ error: { code: "PROJECT_NOT_FOUND" } });
      try {
        const work = works.create(request.params.projectId, identity.owner_id, identity.actor_id, {
          client_request_id: request.body.client_request_id,
          goal: presentationWorkGoal(request.body.topic, request.body.slide_count),
          worker_role: "analyst",
          require_critic: true,
          output_contract: { kind: "presentation", slide_count: request.body.slide_count },
          max_model_requests: 3,
          max_input_tokens: 32000,
          max_output_tokens: 6000
        });
        return work
          ? reply.code(201).send(work)
          : reply.code(409).send({ error: { code: "PROJECT_INACTIVE" } });
      } catch (cause) {
        return fail(reply, cause);
      }
    }
  );
  app.post<{ Body: PresentationWorkReference }>(
    "/api/v1/presentations/work-preview",
    { schema: { body: reference } },
    (request, reply) => {
      reply.header("cache-control", "private, no-store");
      try {
        return preview(identityFor(request).owner_id, request.body);
      } catch (cause) {
        return fail(reply, cause);
      }
    }
  );
  app.post<{ Body: { source: PresentationWorkReference; reviewed: true } }>(
    "/api/v1/presentations/from-work",
    {
      schema: {
        body: Type.Object(
          { source: reference, reviewed: Type.Literal(true) },
          { additionalProperties: false }
        )
      }
    },
    (request, reply) => {
      try {
        const owner = identityFor(request).owner_id;
        works.assertWritable(owner);
        const prior = presentations.importedWork(owner, request.body.source);
        if (prior) return reply.code(201).send(prior);
        const result = preview(owner, request.body.source);
        return reply.code(201).send(presentations.importWork(owner, result.package, result.source));
      } catch (cause) {
        return fail(reply, cause);
      }
    }
  );
}
