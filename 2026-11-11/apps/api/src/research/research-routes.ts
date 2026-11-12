import type { FastifyInstance, FastifyRequest } from "fastify";
import type { IdentityContext } from "@cosmora/contracts";
import type { ResearchBrowserAdapter } from "./browser-research-adapter.js";
import { ResearchCoordinator } from "./research-coordinator.js";
import type { ResearchStore } from "./research-store.js";
import {
  ProjectResearchOwnerBudget,
  type ResearchBudgetLimits,
  type ResearchOwnerBudget
} from "./research-synthesis.js";

export interface RegisterResearchRoutesDependencies {
  app: FastifyInstance;
  store: ResearchStore;
  gateway?: unknown;
  manager?: unknown;
  ownerBudget?: ResearchOwnerBudget;
  search?: unknown;
  browserAdapter?: ResearchBrowserAdapter;
  projects?: { getProject?(id: string, ownerId?: string): unknown } | null;
  policy?: unknown;
  identityFor: (request: FastifyRequest) => IdentityContext;
  emergency?: { getProcessStop?(): unknown } | null;
}

const noCache = (reply: { header(name: string, value: string): unknown }) => {
  reply.header("Cache-Control", "private, no-store");
  reply.header("X-Content-Type-Options", "nosniff");
  reply.header("Referrer-Policy", "no-referrer");
};

function requireOwnerIdentity(
  request: FastifyRequest,
  identityFor: (req: FastifyRequest) => IdentityContext
): { ownerId: string; sessionId: string } {
  const identity = identityFor(request);
  if (!identity || identity.actor?.kind !== "owner" || !identity.owner_id) {
    throw new Error("OWNER_AUTH_REQUIRED");
  }
  const rec = identity as unknown as Record<string, unknown>;
  const sessionId =
    typeof rec.session_id === "string" && rec.session_id.length > 0
      ? rec.session_id
      : `owner_session:${identity.owner_id}`;
  return {
    ownerId: identity.owner_id,
    sessionId
  };
}

function httpStatusForResearchError(code: string): number {
  if (
    code === "OWNER_AUTH_REQUIRED" ||
    code === "RESEARCH_RUN_FORBIDDEN" ||
    code === "RESEARCH_PROJECT_FORBIDDEN"
  ) {
    return 403;
  }
  if (code === "RESEARCH_RUN_NOT_FOUND" || code === "RESEARCH_PROJECT_NOT_FOUND") {
    return 404;
  }
  if (
    code === "OWNER_DATA_FENCED" ||
    code === "EMERGENCY_STOP_ACTIVE" ||
    code === "RESEARCH_REPORT_NOT_READY"
  ) {
    return 409;
  }
  if (code === "RESEARCH_QUOTA_EXCEEDED" || code === "RESEARCH_RUNTIME_BUDGET_EXCEEDED") {
    return 429;
  }
  return 400;
}

/**
 * Canonical route registration function imported by `apps/api/src/app.ts`:
 * `const coordinator = registerResearchRoutes({ app, store, ... });`
 */
export function registerResearchRoutes(
  deps: RegisterResearchRoutesDependencies
): ResearchCoordinator {
  // Recover any interrupted runs from a prior process crash on startup
  deps.store.recoverInterruptedRuns();

  const budget =
    deps.ownerBudget ??
    new ProjectResearchOwnerBudget(deps.store.sqlite, deps.projects ?? null, null);

  const coordinator = new ResearchCoordinator({
    store: deps.store,
    browserAdapter: deps.browserAdapter,
    ownerBudget: budget,
    emergency: deps.emergency ?? null
  });

  const { app, identityFor } = deps;

  app.post("/api/v1/research/runs", async (request, reply) => {
    noCache(reply);
    try {
      const { ownerId } = requireOwnerIdentity(request, identityFor);
      const body = (request.body ?? {}) as {
        project_id?: string | null;
        query?: string;
        client_request_id?: string | null;
        expected_targets?: Array<{ subject: string; criterion: string }>;
        budgets?: Partial<ResearchBudgetLimits>;
        run_in_background?: boolean;
      };

      const query = String(body.query ?? "").trim();
      if (!query) {
        return reply.status(400).send({
          error: { code: "RESEARCH_QUERY_REQUIRED", message: "Поисковый запрос обязателен." }
        });
      }

      const run = await coordinator.startRun({
        ownerId,
        projectId: body.project_id ?? null,
        query,
        clientRequestId: body.client_request_id ?? null,
        expectedTargets: body.expected_targets,
        budgets: body.budgets,
        runInBackground: Boolean(body.run_in_background)
      });

      return reply.status(200).send(run);
    } catch (error) {
      const code = error instanceof Error ? error.message : "RESEARCH_START_FAILED";
      return reply.status(httpStatusForResearchError(code)).send({
        error: { code, message: "Не удалось запустить исследовательскую задачу." }
      });
    }
  });

  app.get("/api/v1/research/runs", async (request, reply) => {
    noCache(reply);
    try {
      const { ownerId } = requireOwnerIdentity(request, identityFor);
      const q = (request.query ?? {}) as { project_id?: string };
      const items = coordinator.listRuns(ownerId, q.project_id ?? null);
      return reply.status(200).send({ items });
    } catch (error) {
      const code = error instanceof Error ? error.message : "RESEARCH_LIST_FAILED";
      return reply.status(httpStatusForResearchError(code)).send({
        error: { code, message: "Не удалось получить список исследовательских задач." }
      });
    }
  });

  app.get("/api/v1/research/runs/:runId", async (request, reply) => {
    noCache(reply);
    try {
      const { ownerId } = requireOwnerIdentity(request, identityFor);
      const params = (request.params ?? {}) as { runId: string };
      const run = coordinator.getRun(params.runId, ownerId);
      return reply.status(200).send(run);
    } catch (error) {
      const code = error instanceof Error ? error.message : "RESEARCH_GET_FAILED";
      return reply.status(httpStatusForResearchError(code)).send({
        error: { code, message: "Доступ к исследовательской задаче запрещён или она не найдена." }
      });
    }
  });

  app.post("/api/v1/research/runs/:runId/cancel", async (request, reply) => {
    noCache(reply);
    try {
      const { ownerId } = requireOwnerIdentity(request, identityFor);
      const params = (request.params ?? {}) as { runId: string };
      const run = coordinator.cancelRun(params.runId, ownerId);
      return reply.status(200).send(run);
    } catch (error) {
      const code = error instanceof Error ? error.message : "RESEARCH_CANCEL_FAILED";
      return reply.status(httpStatusForResearchError(code)).send({
        error: { code, message: "Не удалось остановить исследовательскую задачу." }
      });
    }
  });

  app.post("/api/v1/research/runs/:runId/resume", async (request, reply) => {
    noCache(reply);
    try {
      const { ownerId } = requireOwnerIdentity(request, identityFor);
      const params = (request.params ?? {}) as { runId: string };
      const body = (request.body ?? {}) as { reverify_changed_urls?: string[] };
      const run = await coordinator.resumeRun(params.runId, ownerId, {
        reverifyChangedUrls: body.reverify_changed_urls
      });
      return reply.status(200).send(run);
    } catch (error) {
      const code = error instanceof Error ? error.message : "RESEARCH_RESUME_FAILED";
      return reply.status(httpStatusForResearchError(code)).send({
        error: { code, message: "Не удалось продолжить исследовательскую задачу." }
      });
    }
  });

  app.get("/api/v1/research/runs/:runId/export", async (request, reply) => {
    noCache(reply);
    try {
      const { ownerId } = requireOwnerIdentity(request, identityFor);
      const params = (request.params ?? {}) as { runId: string };
      const exported = coordinator.exportReport(params.runId, ownerId);
      return reply.status(200).send(exported);
    } catch (error) {
      const code = error instanceof Error ? error.message : "RESEARCH_EXPORT_FAILED";
      return reply.status(httpStatusForResearchError(code)).send({
        error: { code, message: "Не удалось экспортировать отчёт исследования." }
      });
    }
  });

  return coordinator;
}
