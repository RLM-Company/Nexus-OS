import {
  ApiErrorSchema,
  GitHubConnectionStatusSchema,
  GitHubRepositoryListResponseSchema,
  GitHubRepositorySummarySchema,
  type ApiError
} from "@cosmora/contracts";
import { TypeBoxValidatorCompiler, type TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import type { FastifyInstance } from "fastify";
import { Type } from "typebox";
import type { GitHubReadonlyService } from "./github-readonly.js";

const repositoryParams = Type.Object(
  {
    owner: Type.String({ minLength: 1, maxLength: 100 }),
    repository: Type.String({ minLength: 1, maxLength: 100 })
  },
  { additionalProperties: false }
);

const errorBody = (requestId: string, code: ApiError["error"]["code"]): ApiError => ({
  error: {
    code,
    message:
      code === "GITHUB_NOT_CONFIGURED"
        ? "GitHub read-only connection is not configured."
        : "GitHub data is temporarily unavailable.",
    request_id: requestId,
    retryable: code === "GITHUB_UNAVAILABLE"
  }
});

export const registerGitHubReadonlyRoutes = (
  app: FastifyInstance,
  service: GitHubReadonlyService
): void => {
  const typedApp = app.withTypeProvider<TypeBoxTypeProvider>();
  typedApp.setValidatorCompiler(TypeBoxValidatorCompiler);

  typedApp.get(
    "/api/v1/github/status",
    { schema: { response: { 200: GitHubConnectionStatusSchema } } },
    async () => ({ mode: "read_only" as const, ...(await service.status()) })
  );

  typedApp.get(
    "/api/v1/github/repositories",
    {
      schema: {
        response: {
          200: GitHubRepositoryListResponseSchema,
          503: ApiErrorSchema
        }
      }
    },
    async (request, reply) => {
      const result = await service.listRepositories();
      if (result.kind === "ok") return { items: result.value };
      return reply
        .status(503)
        .send(
          errorBody(
            request.id,
            result.kind === "not_configured" ? "GITHUB_NOT_CONFIGURED" : "GITHUB_UNAVAILABLE"
          )
        );
    }
  );

  typedApp.get(
    "/api/v1/github/repositories/:owner/:repository/summary",
    {
      schema: {
        params: repositoryParams,
        response: {
          200: GitHubRepositorySummarySchema,
          503: ApiErrorSchema
        }
      }
    },
    async (request, reply) => {
      const result = await service.getRepositorySummary(
        request.params.owner,
        request.params.repository
      );
      if (result.kind === "ok") return result.value;
      return reply
        .status(503)
        .send(
          errorBody(
            request.id,
            result.kind === "not_configured" ? "GITHUB_NOT_CONFIGURED" : "GITHUB_UNAVAILABLE"
          )
        );
    }
  );
};
