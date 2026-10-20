import { githubIssueContextSchema, type GithubIssueContext } from "../github-issue-context.js";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { Type } from "typebox";
import { CodeDiffError } from "@cosmora/tool-runtime";
import type { IdentityContext } from "@cosmora/contracts";
import { GithubIntegrationError } from "../github-integration.js";
import { CodeAgentError } from "./store.js";
import type { CodeAgentService } from "./service.js";

export function registerCodeAgentRoutes(
  app: FastifyInstance,
  service: CodeAgentService,
  identityFor: (request: FastifyRequest) => IdentityContext
): void {
  const base = "/api/v1/projects/:projectId/code-agent";
  const params = Type.Object(
    {
      projectId: Type.String({ minLength: 1, maxLength: 128 }),
      id: Type.Optional(Type.String({ format: "uuid" }))
    },
    { additionalProperties: false }
  );
  type Params = { projectId: string; id: string };
  const hash = Type.String({ pattern: "^[a-f0-9]{64}$" });
  const autoCheck = Type.Object(
    {
      check: Type.Union([Type.Literal("syntax"), Type.Literal("node-test")]),
      approve: Type.Literal(true)
    },
    { additionalProperties: false }
  );
  const patch = Type.String({ minLength: 1, maxLength: 200000 });
  const files = Type.Array(
    Type.Object(
      {
        path: Type.String({ minLength: 1, maxLength: 240 }),
        content: Type.String({ maxLength: 50000 })
      },
      { additionalProperties: false }
    ),
    { minItems: 1, maxItems: 8 }
  );
  const handle = async <T>(
    fn: () => T | Promise<T>,
    reply: { code: (code: number) => { send: (value: unknown) => unknown } }
  ) => {
    try {
      return await fn();
    } catch (error) {
      if (!(
        error instanceof CodeAgentError ||
        error instanceof GithubIntegrationError ||
        error instanceof CodeDiffError
      ))
        throw error;
      const code = error instanceof CodeDiffError ? error.code : error.message;
      return reply
        .code(
          code === "RUN_NOT_FOUND" || code === "PROJECT_NOT_FOUND"
            ? 404
            : code === "POLICY_DENIED" ||
                code === "EXECUTION_STOPPED" ||
                code === "STEP_UP_REQUIRED"
              ? 403
              : code === "INVALID_INPUT" || code === "INVALID_PATCH" || code.startsWith("PATCH_")
                ? 400
                : 409
        )
        .send({
          error: {
            code,
            ...(error instanceof CodeDiffError
              ? {
                  diagnostic: {
                    ...(error.path ? { path: error.path } : {}),
                    ...(error.line ? { line: error.line } : {})
                  }
                }
              : {})
          }
        });
    }
  };
  app.post<{ Body: { client_project_id: string; title: string; approve_local_execution: true } }>(
    "/api/v1/code-projects",
    {
      schema: {
        body: Type.Object(
          {
            client_project_id: Type.String({
              pattern:
                "^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-4[a-fA-F0-9]{3}-[89abAB][a-fA-F0-9]{3}-[a-fA-F0-9]{12}$"
            }),
            title: Type.String({ minLength: 1, maxLength: 160, pattern: "\\S" }),
            approve_local_execution: Type.Literal(true)
          },
          { additionalProperties: false }
        )
      }
    },
    (request, reply) =>
      handle(() => {
        const identity = identityFor(request);
        if (identity.owner_id !== service.deps.github.ownerId)
          throw new CodeAgentError("PROJECT_NOT_FOUND");
        if (
          service.deps.store.sqlite
            .prepare(
              "SELECT 1 FROM kosmora_owner_data_lifecycle WHERE owner_id=? AND state<>'active'"
            )
            .get(identity.owner_id)
        )
          throw new CodeAgentError("EXECUTION_STOPPED");
        const project = service.deps.projects.createEmptyProject(
          request.body.client_project_id,
          request.body.title,
          identity.owner_id,
          "ACTIVE"
        );
        const existing = service.deps.policy.getProfile(project.id);
        if (!existing) {
          const profile = service.deps.policy.ensureProfile(project.id);
          if (!profile) throw new CodeAgentError("PROJECT_NOT_FOUND");
          service.deps.policy.updateProfile({
            projectId: project.id,
            baseLevel: "A2",
            overrides: [],
            expectedVersion: profile.version
          });
        }
        return { project };
      }, reply)
  );
  const owned = (request: FastifyRequest<{ Params: Params }>) => {
    const identity = identityFor(request);
    if (
      identity.owner_id !== service.deps.github.ownerId ||
      !service.deps.projects.getProject(request.params.projectId, identity.owner_id)
    )
      throw new CodeAgentError("PROJECT_NOT_FOUND");
    if (request.params.id) {
      const run = service.deps.store.get(request.params.id, identity.owner_id);
      if (!run || run.project_id !== request.params.projectId)
        throw new CodeAgentError("RUN_NOT_FOUND");
    }
    return identity;
  };
  app.get<{ Params: Params }>(base, { schema: { params } }, (request, reply) =>
    handle(() => {
      const identity = owned(request);
      return {
        items: service.deps.store
          .list(request.params.projectId, identity.owner_id)
          .map((r) => service.view(r))
      };
    }, reply)
  );
  app.get<{ Params: { projectId: string; requestId: string } }>(
    base + "/by-request/:requestId",
    {
      schema: {
        params: Type.Object(
          {
            projectId: Type.String({ minLength: 1, maxLength: 128 }),
            requestId: Type.String({ minLength: 1, maxLength: 128 })
          },
          { additionalProperties: false }
        )
      }
    },
    (request, reply) =>
      handle(() => {
        const identity = identityFor(request);
        if (
          identity.owner_id !== service.deps.github.ownerId ||
          !service.deps.projects.getProject(request.params.projectId, identity.owner_id)
        )
          throw new CodeAgentError("PROJECT_NOT_FOUND");
        const run = service.deps.store.findRequest(identity.owner_id, request.params.requestId);
        if (!run || run.project_id !== request.params.projectId)
          throw new CodeAgentError("RUN_NOT_FOUND");
        return service.view(run);
      }, reply)
  );
  app.post<{
    Params: Params;
    Body: {
      client_request_id?: string;
      issue_context?: GithubIssueContext;
      task: string;
      base_branch: string;
      files?: string[];
      auto_check?: { check: "syntax" | "node-test"; approve: true };
    };
  }>(
    base,
    {
      schema: {
        params,
        body: Type.Object(
          {
            client_request_id: Type.Optional(
              Type.String({
                pattern:
                  "^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-4[a-fA-F0-9]{3}-[89abAB][a-fA-F0-9]{3}-[a-fA-F0-9]{12}$"
              })
            ),
            issue_context: Type.Optional(githubIssueContextSchema),
            auto_check: Type.Optional(autoCheck),
            task: Type.String({ minLength: 1, maxLength: 8000 }),
            base_branch: Type.String({ minLength: 1, maxLength: 240 }),
            files: Type.Optional(
              Type.Array(Type.String({ minLength: 1, maxLength: 240 }), {
                maxItems: 32,
                uniqueItems: true
              })
            )
          },
          { additionalProperties: false }
        )
      }
    },
    (request, reply) =>
      handle(() => service.create(request.params.projectId, owned(request), request.body), reply)
  );
  app.post<{
    Params: Params;
    Body: {
      task: string;
      base_branch: string;
      base_sha: string;
      diff: string;
      auto_check?: { check: "syntax" | "node-test"; approve: true };
    };
  }>(
    base + "/import-diff",
    {
      schema: {
        params,
        body: Type.Object(
          {
            task: Type.String({ minLength: 1, maxLength: 8000 }),
            base_branch: Type.String({ minLength: 1, maxLength: 240 }),
            base_sha: Type.String({ pattern: "^[a-f0-9]{40}$" }),
            diff: patch,
            auto_check: Type.Optional(autoCheck)
          },
          { additionalProperties: false }
        )
      }
    },
    (request, reply) =>
      handle(
        () => service.importDiff(request.params.projectId, owned(request), request.body),
        reply
      )
  );
  app.post<{
    Params: Params;
    Body: { proposal_hash: string; base_sha: string; snapshot_digest: string; diff: string };
  }>(
    base + "/:id/preview-diff",
    {
      schema: {
        params,
        body: Type.Object(
          {
            proposal_hash: hash,
            base_sha: Type.String({ pattern: "^[a-f0-9]{40}$" }),
            snapshot_digest: hash,
            diff: patch
          },
          { additionalProperties: false }
        )
      }
    },
    (request, reply) =>
      handle(
        () => service.previewDiff(request.params.id, owned(request).owner_id, request.body),
        reply
      )
  );
  app.post<{
    Params: Params;
    Body: { proposal_hash: string; check: "syntax" | "node-test"; approve: true };
  }>(
    base + "/:id/proposal-check",
    {
      schema: {
        params,
        body: Type.Object(
          {
            proposal_hash: hash,
            check: Type.Union([Type.Literal("syntax"), Type.Literal("node-test")]),
            approve: Type.Literal(true)
          },
          { additionalProperties: false }
        )
      }
    },
    (request, reply) =>
      handle(
        () => service.retryProposalCheck(request.params.id, owned(request).owner_id, request.body),
        reply
      )
  );
  app.post<{ Params: Params; Body: { proposal_hash: string } }>(
    base + "/:id/invalidate-review",
    {
      schema: {
        params,
        body: Type.Object({ proposal_hash: hash }, { additionalProperties: false })
      }
    },
    (request, reply) =>
      handle(
        () =>
          service.invalidateReview(
            request.params.id,
            owned(request).owner_id,
            request.body.proposal_hash
          ),
        reply
      )
  );
  app.get<{ Params: Params }>(base + "/:id", { schema: { params } }, (request, reply) =>
    handle(() => {
      const identity = owned(request);
      return service.view(service.deps.store.get(request.params.id, identity.owner_id)!);
    }, reply)
  );
  app.post<{ Params: Params }>(base + "/:id/cancel", { schema: { params } }, (request, reply) =>
    handle(() => service.cancel(request.params.id, owned(request).owner_id), reply)
  );
  app.post<{
    Params: Params;
    Body: { proposal_hash: string; files: Array<{ path: string; content: string }> };
  }>(
    base + "/:id/review",
    {
      schema: {
        params,
        body: Type.Object({ proposal_hash: hash, files }, { additionalProperties: false })
      }
    },
    (request, reply) =>
      handle(() => service.review(request.params.id, owned(request).owner_id, request.body), reply)
  );
  app.post<{
    Params: Params;
    Body: { review_hash: string; check: "node-test" | "syntax"; approve: true };
  }>(
    base + "/:id/check",
    {
      schema: {
        params,
        body: Type.Object(
          {
            review_hash: hash,
            check: Type.Union([Type.Literal("node-test"), Type.Literal("syntax")]),
            approve: Type.Literal(true)
          },
          { additionalProperties: false }
        )
      }
    },
    (request, reply) =>
      handle(() => service.check(request.params.id, owned(request).owner_id, request.body), reply)
  );
  app.post<{
    Params: Params;
    Body: { review_hash: string; publication_token: string; approve: true };
  }>(
    base + "/:id/publish",
    {
      schema: {
        params,
        body: Type.Object(
          {
            review_hash: hash,
            publication_token: Type.String({ format: "uuid" }),
            approve: Type.Literal(true)
          },
          { additionalProperties: false }
        )
      }
    },
    (request, reply) =>
      handle(() => service.publish(request.params.id, owned(request).owner_id, request.body), reply)
  );
  app.post<{ Params: Params }>(base + "/:id/reconcile", { schema: { params } }, (request, reply) =>
    handle(() => service.reconcile(request.params.id, owned(request).owner_id), reply)
  );
  app.addHook("onReady", () => service.reconcileOwnerBudget());
  app.addHook("onClose", () => service.stop());
}
