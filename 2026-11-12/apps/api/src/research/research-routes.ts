import type { FastifyInstance, FastifyRequest } from "fastify";
import type { IdentityContext } from "@cosmora/contracts";
import type { ResearchBrowserAdapter } from "./browser-research-adapter.js";
import {
  ResearchCoordinator,
  type ResearchModelPlannerGateway
} from "./research-coordinator.js";
import type { ResearchStore, VerifiableResearchBundle } from "./research-store.js";
import {
  ProjectResearchOwnerBudget,
  type ResearchBudgetLimits,
  type ResearchOwnerBudget
} from "./research-synthesis.js";

export interface RegisterResearchRoutesDependencies {
  app: FastifyInstance;
  store: ResearchStore;
  gateway?: ResearchModelPlannerGateway | unknown;
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
  if (code === "RESEARCH_RUN_NOT_FOUND" || code === "RESEARCH_PROJECT_NOT_FOUND" || code === "RESEARCH_CLAIM_NOT_FOUND") {
    return 404;
  }
  if (
    code === "OWNER_DATA_FENCED" ||
    code === "EMERGENCY_STOP_ACTIVE" ||
    code === "RESEARCH_REPORT_NOT_READY"
  ) {
    return 409;
  }
  if (code === "RESEARCH_QUOTA_EXCEEDED" || code === "RESEARCH_RUNTIME_BUDGET_EXCEEDED" || code === "WORKFLOW_STEP_MAX_ATTEMPTS_EXCEEDED") {
    return 429;
  }
  return 400;
}

export function registerResearchRoutes(
  deps: RegisterResearchRoutesDependencies
): ResearchCoordinator {
  deps.store.recoverInterruptedRuns();

  const budget =
    deps.ownerBudget ??
    new ProjectResearchOwnerBudget(deps.store.sqlite, deps.projects ?? null, null);

  const coordinator = new ResearchCoordinator({
    store: deps.store,
    browserAdapter: deps.browserAdapter,
    gateway: (deps.gateway as ResearchModelPlannerGateway) ?? null,
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
        include_project_documents?: boolean;
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
        includeProjectDocuments: body.include_project_documents,
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

  app.post("/api/v1/research/runs/:runId/follow-up", async (request, reply) => {
    noCache(reply);
    try {
      const { ownerId } = requireOwnerIdentity(request, identityFor);
      const params = (request.params ?? {}) as { runId: string };
      const body = (request.body ?? {}) as {
        additional_source_urls?: string[];
        refresh_project_documents?: boolean;
      };
      const run = await coordinator.followUpUnconfirmedClaims(params.runId, ownerId, {
        additionalSourceUrls: body.additional_source_urls,
        refreshProjectDocuments: body.refresh_project_documents
      });
      return reply.status(200).send(run);
    } catch (error) {
      const code = error instanceof Error ? error.message : "RESEARCH_FOLLOW_UP_FAILED";
      return reply.status(httpStatusForResearchError(code)).send({
        error: {
          code,
          message: "Не удалось выполнить доисследование неподтверждённых утверждений."
        }
      });
    }
  });

  app.post(
    "/api/v1/research/runs/:runId/claims/:claimId/resolve",
    async (request, reply) => {
      noCache(reply);
      try {
        const { ownerId } = requireOwnerIdentity(request, identityFor);
        const params = (request.params ?? {}) as { runId: string; claimId: string };
        const body = (request.body ?? {}) as {
          winning_source_id?: string;
          resolution_note?: string;
        };
        const winningSourceId = String(body.winning_source_id ?? "").trim();
        if (!winningSourceId) {
          return reply.status(400).send({
            error: {
              code: "RESEARCH_WINNING_SOURCE_REQUIRED",
              message: "Необходимо указать идентификатор или канонический URL выбранного источника."
            }
          });
        }
        const updatedRun = deps.store.resolveConflictingClaim(
          params.runId,
          ownerId,
          params.claimId,
          {
            winningSourceId,
            resolutionNote: body.resolution_note
          }
        );
        return reply.status(200).send(updatedRun);
      } catch (error) {
        const code = error instanceof Error ? error.message : "RESEARCH_CLAIM_RESOLVE_FAILED";
        return reply.status(httpStatusForResearchError(code)).send({
          error: {
            code,
            message: "Не удалось разрешить конфликт источников по утверждению."
          }
        });
      }
    }
  );

  app.post(
    "/api/v1/research/runs/:runId/reverify-sources",
    async (request, reply) => {
      noCache(reply);
      try {
        const { ownerId } = requireOwnerIdentity(request, identityFor);
        const params = (request.params ?? {}) as { runId: string };
        const body = (request.body ?? {}) as { target_urls?: string[] };
        const result = await coordinator.reverifySources(params.runId, ownerId, {
          targetUrls: body.target_urls
        });
        return reply.status(200).send(result);
      } catch (error) {
        const code =
          error instanceof Error ? error.message : "RESEARCH_REVERIFY_SOURCES_FAILED";
        return reply.status(httpStatusForResearchError(code)).send({
          error: {
            code,
            message: "Не удалось перепроверить актуальность источников исследования."
          }
        });
      }
    }
  );

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

  app.post("/api/v1/research/runs/:runId/canvas", async (request, reply) => {
    noCache(reply);
    try {
      const { ownerId } = requireOwnerIdentity(request, identityFor);
      const params = (request.params ?? {}) as { runId: string };
      const body = (request.body ?? {}) as { title?: string };
      const artifact = coordinator.exportToCanvas(params.runId, ownerId, {
        title: body.title
      });
      return reply.status(200).send(artifact);
    } catch (error) {
      const code = error instanceof Error ? error.message : "RESEARCH_CANVAS_EXPORT_FAILED";
      return reply.status(httpStatusForResearchError(code)).send({
        error: { code, message: "Не удалось сохранить отчёт исследования в Canvas." }
      });
    }
  });

  app.post("/api/v1/research/runs/:runId/handoff-to-project", async (request, reply) => {
    noCache(reply);
    try {
      const { ownerId } = requireOwnerIdentity(request, identityFor);
      const params = (request.params ?? {}) as { runId: string };
      const handoff = deps.store.handoffRunToProjectMessages(params.runId, ownerId);
      return reply.status(200).send(handoff);
    } catch (error) {
      const code = error instanceof Error ? error.message : "RESEARCH_PROJECT_HANDOFF_FAILED";
      return reply.status(httpStatusForResearchError(code)).send({
        error: { code, message: "Не удалось передать отчёт исследования в проект." }
      });
    }
  });

  app.post("/api/v1/research/runs/:runId/answer", async (request, reply) => {
    noCache(reply);
    try {
      const { ownerId } = requireOwnerIdentity(request, identityFor);
      const params = (request.params ?? {}) as { runId: string };
      const body = (request.body ?? {}) as { question?: string };
      const question = String(body.question ?? "").trim();
      if (!question) {
        return reply.status(400).send({
          error: { code: "RESEARCH_QUESTION_REQUIRED", message: "Вопрос обязателен." }
        });
      }
      const answer = deps.store.answerGroundedQuestionFromRun(
        params.runId,
        ownerId,
        question
      );
      return reply.status(200).send(answer);
    } catch (error) {
      const code = error instanceof Error ? error.message : "RESEARCH_ANSWER_FAILED";
      return reply.status(httpStatusForResearchError(code)).send({
        error: { code, message: "Не удалось сформировать ответ по доказательствам." }
      });
    }
  });

  app.post("/api/v1/research/runs/:runId/promote-to-memory", async (request, reply) => {
    noCache(reply);
    try {
      const { ownerId } = requireOwnerIdentity(request, identityFor);
      const params = (request.params ?? {}) as { runId: string };
      const promoted = deps.store.promoteRunClaimsToContextMemory(
        params.runId,
        ownerId
      );
      return reply.status(200).send(promoted);
    } catch (error) {
      const code = error instanceof Error ? error.message : "RESEARCH_MEMORY_PROMOTE_FAILED";
      return reply.status(httpStatusForResearchError(code)).send({
        error: { code, message: "Не удалось сохранить выводы исследования в память проекта." }
      });
    }
  });

  app.get("/api/v1/research/runs/:runId/diff/:otherRunId", async (request, reply) => {
    noCache(reply);
    try {
      const { ownerId } = requireOwnerIdentity(request, identityFor);
      const params = (request.params ?? {}) as { runId: string; otherRunId: string };
      const diff = deps.store.diffRuns(params.runId, params.otherRunId, ownerId);
      return reply.status(200).send(diff);
    } catch (error) {
      const code = error instanceof Error ? error.message : "RESEARCH_DIFF_FAILED";
      return reply.status(httpStatusForResearchError(code)).send({
        error: { code, message: "Не удалось сравнить исследовательские задачи." }
      });
    }
  });

  app.get("/api/v1/research/runs/:runId/bundle", async (request, reply) => {
    noCache(reply);
    try {
      const { ownerId } = requireOwnerIdentity(request, identityFor);
      const params = (request.params ?? {}) as { runId: string };
      const bundle = deps.store.exportVerifiableBundle(params.runId, ownerId);
      return reply.status(200).send(bundle);
    } catch (error) {
      const code = error instanceof Error ? error.message : "RESEARCH_BUNDLE_EXPORT_FAILED";
      return reply.status(httpStatusForResearchError(code)).send({
        error: { code, message: "Не удалось экспортировать пакет доказательств исследования." }
      });
    }
  });

  app.get("/api/v1/research/runs/:runId/citation-graph", async (request, reply) => {
    noCache(reply);
    try {
      const { ownerId } = requireOwnerIdentity(request, identityFor);
      const params = (request.params ?? {}) as { runId: string };
      const graph = deps.store.buildRunCitationGraph(params.runId, ownerId);
      return reply.status(200).send(graph);
    } catch (error) {
      const code =
        error instanceof Error ? error.message : "RESEARCH_CITATION_GRAPH_FAILED";
      return reply.status(httpStatusForResearchError(code)).send({
        error: {
          code,
          message: "Не удалось построить граф цитирования и авторитетности источников."
        }
      });
    }
  });

  app.get("/api/v1/research/runs/:runId/audit-trail", async (request, reply) => {
    noCache(reply);
    try {
      const { ownerId } = requireOwnerIdentity(request, identityFor);
      const params = (request.params ?? {}) as { runId: string };
      const audit = deps.store.getRunCryptographicAuditTrail(params.runId, ownerId);
      return reply.status(200).send(audit);
    } catch (error) {
      const code =
        error instanceof Error ? error.message : "RESEARCH_AUDIT_TRAIL_FAILED";
      return reply.status(httpStatusForResearchError(code)).send({
        error: {
          code,
          message: "Не удалось проверить криптографическую цепочку аудита исследования."
        }
      });
    }
  });

  app.post("/api/v1/research/evidence/check-seen", async (request, reply) => {
    noCache(reply);
    try {
      const { ownerId } = requireOwnerIdentity(request, identityFor);
      const body = (request.body ?? {}) as {
        urls?: string[];
        page_versions?: Array<{ url: string; page_version: string }>;
        quotes?: string[];
      };
      const result = deps.store.checkEvidenceSeen(ownerId, {
        urls: body.urls,
        pageVersions: Array.isArray(body.page_versions)
          ? body.page_versions.map((pv) => ({
              url: String(pv.url ?? ""),
              pageVersion: String(pv.page_version ?? "")
            }))
          : undefined,
        quotes: body.quotes
      });
      return reply.status(200).send(result);
    } catch (error) {
      const code =
        error instanceof Error ? error.message : "RESEARCH_CHECK_SEEN_FAILED";
      return reply.status(httpStatusForResearchError(code)).send({
        error: {
          code,
          message: "Не удалось проверить наличие доказательств в фильтре дедупликации."
        }
      });
    }
  });

  app.get("/api/v1/research/evidence/search", async (request, reply) => {
    noCache(reply);
    try {
      const { ownerId } = requireOwnerIdentity(request, identityFor);
      const q = (request.query ?? {}) as {
        phrase?: string;
        max_slop?: string | number;
        must_terms?: string | string[];
        should_terms?: string | string[];
        must_not_terms?: string | string[];
        project_id?: string;
        category?: "confirmed" | "conflicting";
      };
      const parseList = (v?: string | string[]): string[] | undefined => {
        if (!v) return undefined;
        if (Array.isArray(v)) return v.map((s) => String(s).trim()).filter(Boolean);
        return String(v)
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
      };
      const res = deps.store.searchOwnerEvidence(ownerId, {
        phrase: q.phrase,
        maxSlop: q.max_slop !== undefined ? Number(q.max_slop) : undefined,
        mustTerms: parseList(q.must_terms),
        shouldTerms: parseList(q.should_terms),
        mustNotTerms: parseList(q.must_not_terms),
        projectId: q.project_id ?? null,
        category: q.category
      });
      return reply.status(200).send(res);
    } catch (error) {
      const code =
        error instanceof Error ? error.message : "RESEARCH_EVIDENCE_SEARCH_FAILED";
      return reply.status(httpStatusForResearchError(code)).send({
        error: {
          code,
          message: "Не удалось выполнить поиск по индексу доказательств исследования."
        }
      });
    }
  });

  app.post("/api/v1/research/workflow-step", async (request, reply) => {
    noCache(reply);
    try {
      const { ownerId } = requireOwnerIdentity(request, identityFor);
      const body = (request.body ?? {}) as {
        project_id?: string | null;
        workflow_run_id?: string;
        step_id?: string;
        query?: string;
        expected_targets?: Array<{ subject: string; criterion: string }>;
        budgets?: Partial<ResearchBudgetLimits>;
        include_project_documents?: boolean;
        promote_confirmed_to_memory?: boolean;
      };
      const workflowRunId = String(body.workflow_run_id ?? "").trim();
      const stepId = String(body.step_id ?? "").trim();
      const query = String(body.query ?? "").trim();
      if (!workflowRunId || !stepId || !query) {
        return reply.status(400).send({
          error: {
            code: "RESEARCH_WORKFLOW_STEP_PARAMS_REQUIRED",
            message: "Параметры workflow_run_id, step_id и query обязательны."
          }
        });
      }
      const result = await coordinator.executeWorkflowResearchStep({
        ownerId,
        projectId: body.project_id ?? null,
        workflowRunId,
        stepId,
        query,
        expectedTargets: body.expected_targets,
        budgets: body.budgets,
        includeProjectDocuments: body.include_project_documents,
        promoteConfirmedToMemory: body.promote_confirmed_to_memory
      });
      return reply.status(200).send(result);
    } catch (error) {
      const code =
        error instanceof Error ? error.message : "RESEARCH_WORKFLOW_STEP_FAILED";
      return reply.status(httpStatusForResearchError(code)).send({
        error: {
          code,
          message: "Не удалось выполнить исследовательский шаг сценария (workflow)."
        }
      });
    }
  });

  app.post("/api/v1/research/runs/import-bundle", async (request, reply) => {
    noCache(reply);
    try {
      const { ownerId } = requireOwnerIdentity(request, identityFor);
      const body = (request.body ?? {}) as {
        project_id?: string | null;
        bundle?: VerifiableResearchBundle;
      };
      if (!body.bundle) {
        return reply.status(400).send({
          error: { code: "RESEARCH_BUNDLE_REQUIRED", message: "Пакет исследования обязателен." }
        });
      }
      const imported = deps.store.importVerifiableBundle(
        ownerId,
        body.project_id ?? null,
        body.bundle
      );
      return reply.status(200).send(imported);
    } catch (error) {
      const code = error instanceof Error ? error.message : "RESEARCH_BUNDLE_IMPORT_FAILED";
      return reply.status(httpStatusForResearchError(code)).send({
        error: { code, message: "Не удалось импортировать пакет доказательств исследования." }
      });
    }
  });

  return coordinator;
}
