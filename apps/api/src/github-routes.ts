import type { FastifyInstance, FastifyRequest } from "fastify";
import { Type } from "typebox";
import type { IdentityContext } from "@cosmora/contracts";
import type { ProjectStore, EmergencyStopStore } from "@cosmora/db";
import {
  type GithubIntegration,
  type GithubDraftStore,
  GithubIntegrationError,
  type GithubFileChange
} from "./github-integration.js";

export function registerGithubRoutes(options: {
  app: FastifyInstance;
  integration: GithubIntegration;
  drafts?: GithubDraftStore;
  projects?: ProjectStore;
  emergency?: EmergencyStopStore;
  identityFor: (request: FastifyRequest) => IdentityContext;
}) {
  const { app, integration, identityFor } = options;
  app.addHook("preHandler", async (request, reply) => {
    const path = request.routeOptions.url ?? "";
    if (
      integration.configured &&
      (path.startsWith("/api/v1/github/") || path.includes("/github-drafts")) &&
      identityFor(request).owner_id !== integration.ownerId
    ) {
      return reply.code(403).send({ error: { code: "GITHUB_ACCESS_DENIED" } });
    }
  });
  const handle = async <T>(
    operation: () => Promise<T>,
    reply: { code: (code: number) => { send: (body: unknown) => unknown } }
  ) => {
    try {
      return await operation();
    } catch (error) {
      if (!(error instanceof GithubIntegrationError)) throw error;
      const status =
        error.code === "GITHUB_INVALID_FILE"
          ? 400
          : error.code === "GITHUB_ACCESS_DENIED"
            ? 403
            : error.code === "GITHUB_RATE_LIMITED"
              ? 429
              : error.code === "GITHUB_BASE_CHANGED" || error.code === "GITHUB_CONFLICT"
                ? 409
                : 503;
      return reply
        .code(status)
        .send({ error: { code: error.code, message: error.code, retryable: false } });
    }
  };
  app.get("/api/v1/github/status", (_request, reply) => handle(() => integration.status(), reply));
  app.get<{ Querystring: { page?: number } }>(
    "/api/v1/github/branches",
    {
      schema: {
        querystring: Type.Object(
          { page: Type.Optional(Type.Integer({ minimum: 1, maximum: 1000 })) },
          { additionalProperties: false }
        )
      }
    },
    (request, reply) => handle(() => integration.branches(request.query.page), reply)
  );
  app.get<{ Querystring: { ref: string } }>(
    "/api/v1/github/tree",
    {
      schema: {
        querystring: Type.Object(
          { ref: Type.String({ minLength: 1, maxLength: 240 }) },
          { additionalProperties: false }
        )
      }
    },
    (request, reply) => handle(() => integration.tree(request.query.ref), reply)
  );
  app.get<{ Querystring: { sha: string } }>(
    "/api/v1/github/file",
    {
      schema: {
        querystring: Type.Object(
          { sha: Type.String({ pattern: "^[a-f0-9]{40}$" }) },
          { additionalProperties: false }
        )
      }
    },
    (request, reply) => handle(() => integration.file(request.query.sha), reply)
  );
  const { drafts, projects, emergency } = options;
  if (!drafts || !projects) return;
  const params = Type.Object(
    { projectId: Type.String({ minLength: 1 }), id: Type.Optional(Type.String({ minLength: 1 })) },
    { additionalProperties: false }
  );
  type Params = { projectId: string; id: string };
  const base = "/api/v1/projects/:projectId/github-drafts";
  const owned = (request: FastifyRequest<{ Params: Params }>): boolean =>
    projects.getProject(request.params.projectId, identityFor(request).owner_id) !== null;
  const get = (request: FastifyRequest<{ Params: Params }>) => {
    const draft = drafts.get(request.params.id, identityFor(request).owner_id);
    return draft?.project_id === request.params.projectId && owned(request) ? draft : null;
  };
  app.get<{ Params: Params }>(base, { schema: { params } }, (request, reply) =>
    owned(request)
      ? { items: drafts.list(request.params.projectId, identityFor(request).owner_id) }
      : reply.code(404).send({ error: { code: "PROJECT_NOT_FOUND" } })
  );
  app.post<{
    Params: Params;
    Body: {
      base_branch: string;
      base_sha: string;
      title: string;
      files: GithubFileChange[];
      workspace_scope?: string;
    };
  }>(
    base,
    {
      schema: {
        params,
        body: Type.Object(
          {
            base_branch: Type.String({ minLength: 1, maxLength: 240 }),
            workspace_scope: Type.Optional(Type.String({ pattern: "^[a-f0-9]{64}$" })),
            base_sha: Type.String({ pattern: "^[a-f0-9]{40}$" }),
            title: Type.String({ minLength: 1, maxLength: 160 }),
            files: Type.Array(
              Type.Object(
                {
                  path: Type.String({ minLength: 1, maxLength: 240 }),
                  content: Type.String({ maxLength: 50_000 })
                },
                { additionalProperties: false }
              ),
              { minItems: 1, maxItems: 8 }
            )
          },
          { additionalProperties: false }
        )
      }
    },
    (request, reply) => {
      if (!owned(request)) return reply.code(404).send({ error: { code: "PROJECT_NOT_FOUND" } });
      return handle(
        () =>
          drafts.create(
            identityFor(request).owner_id,
            request.params.projectId,
            integration,
            request.body
          ),
        reply
      );
    }
  );
  app.get<{ Params: Params }>(
    base + "/:id",
    { schema: { params } },
    (request, reply) => get(request) ?? reply.code(404).send({ error: { code: "DRAFT_NOT_FOUND" } })
  );
  app.post<{ Params: Params; Body: { review_hash: string; approve: true } }>(
    base + "/:id/publish",
    {
      schema: {
        params,
        body: Type.Object(
          { review_hash: Type.String({ pattern: "^[a-f0-9]{64}$" }), approve: Type.Literal(true) },
          { additionalProperties: false }
        )
      }
    },
    (request, reply) => {
      if (!get(request)) return reply.code(404).send({ error: { code: "DRAFT_NOT_FOUND" } });
      const owner = identityFor(request).owner_id;
      const allowed = () =>
        emergency !== undefined && !emergency.getBlockingStop(request.params.projectId, owner);
      if (!allowed())
        return reply.code(403).send({
          error: { code: "EMERGENCY_STOP_ACTIVE", message: "Отправка изменений остановлена." }
        });
      return handle(async () => {
        const draft = drafts.claim(request.params.id, owner, request.body.review_hash);
        let writeAttempted = false;
        try {
          const url = await integration.publish(
            draft.plan,
            allowed,
            (commit) => drafts.checkpoint(draft.id, owner, commit),
            () => {
              writeAttempted = true;
            }
          );
          drafts.finish(draft.id, owner, url);
          return drafts.get(draft.id, owner);
        } catch (error) {
          if (writeAttempted) drafts.finish(draft.id, owner, null);
          else drafts.release(draft.id, owner);
          throw error;
        }
      }, reply);
    }
  );
  app.post<{ Params: Params }>(
    base + "/:id/reconcile",
    { schema: { params } },
    (request, reply) => {
      const draft = get(request);
      if (!draft) return reply.code(404).send({ error: { code: "DRAFT_NOT_FOUND" } });
      return handle(async () => {
        const url = await integration.reconcile(draft);
        if (url) drafts.reconcile(draft.id, identityFor(request).owner_id, url);
        return drafts.get(draft.id, identityFor(request).owner_id);
      }, reply);
    }
  );
}
