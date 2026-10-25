import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { Type } from "typebox";
import type { IdentityContext } from "@cosmora/contracts";
import type { ProjectStore } from "@cosmora/db";
import type { GithubIntegration } from "./github-integration.js";
import { GithubIssuesError, type GithubIssueState } from "./github-issues-client.js";

/** Project ownership is checked before every read; repository comes only from server configuration. */
export function registerGithubIssueRoutes(options: {
  app: FastifyInstance;
  integration: GithubIntegration;
  projects: ProjectStore;
  identityFor: (request: FastifyRequest) => IdentityContext;
}) {
  const { app, integration, projects, identityFor } = options;
  const controllers = new Set<AbortController>();
  const owned = (request: FastifyRequest<{ Params: { projectId: string } }>) => {
    const identity = identityFor(request);
    return (
      identity.actor_kind === "owner" &&
      identity.owner_id === integration.ownerId &&
      !!projects.getProject(request.params.projectId, identity.owner_id)
    );
  };
  const params = Type.Object(
    { projectId: Type.String({ minLength: 1, maxLength: 128 }) },
    { additionalProperties: false }
  );
  const base = "/api/v1/projects/:projectId/github-issues";
  type Query = { state?: GithubIssueState; query?: string; page?: number };
  async function read<T>(
    request: FastifyRequest<{ Params: { projectId: string } }>,
    reply: FastifyReply,
    operation: (signal: AbortSignal) => Promise<T>
  ) {
    reply.header("cache-control", "no-store");
    if (!owned(request)) return reply.code(404).send({ error: { code: "PROJECT_NOT_FOUND" } });
    const controller = new AbortController();
    controllers.add(controller);
    const abort = () => controller.abort();
    const close = () => {
      if (!reply.raw.writableEnded) abort();
    };
    request.raw.once("aborted", abort);
    reply.raw.once("close", close);
    try {
      const data = await operation(controller.signal);
      if (!owned(request)) return reply.code(404).send({ error: { code: "PROJECT_NOT_FOUND" } });
      return data;
    } catch (error) {
      if (!(error instanceof GithubIssuesError)) throw error;
      const status =
        error.code === "GITHUB_ISSUES_INPUT"
          ? 400
          : error.code === "GITHUB_ISSUES_DENIED"
            ? 403
            : error.code === "GITHUB_ISSUES_RATE_LIMITED"
              ? 429
              : error.code === "GITHUB_ISSUES_NOT_FOUND"
                ? 404
                : error.code === "GITHUB_ISSUES_TIMEOUT"
                  ? 504
                  : error.code === "GITHUB_ISSUES_CANCELLED"
                    ? 499
                    : 503;
      return reply.code(status).send({ error: { code: error.code } });
    } finally {
      controller.abort();
      controllers.delete(controller);
      request.raw.removeListener("aborted", abort);
      reply.raw.removeListener("close", close);
    }
  }
  app.get<{ Params: { projectId: string }; Querystring: Query }>(
    base,
    {
      schema: {
        params,
        querystring: Type.Object(
          {
            state: Type.Optional(
              Type.Union([Type.Literal("open"), Type.Literal("closed"), Type.Literal("all")])
            ),
            query: Type.Optional(Type.String({ maxLength: 160 })),
            page: Type.Optional(Type.Integer({ minimum: 1, maximum: 10 }))
          },
          { additionalProperties: false }
        )
      }
    },
    (request, reply) =>
      read(request, reply, (signal) => integration.issues.list(request.query, signal))
  );
  app.get<{ Params: { projectId: string; number: number } }>(
    base + "/:number",
    {
      schema: {
        params: Type.Object(
          {
            projectId: Type.String({ minLength: 1, maxLength: 128 }),
            number: Type.Integer({ minimum: 1, maximum: 2_147_483_647 })
          },
          { additionalProperties: false }
        )
      }
    },
    (request, reply) =>
      read(request, reply, async (signal) => ({
        repository: integration.repository,
        issue: await integration.issues.get(request.params.number, signal)
      }))
  );
  app.addHook("onClose", () => {
    for (const controller of controllers) controller.abort();
    controllers.clear();
  });
}
