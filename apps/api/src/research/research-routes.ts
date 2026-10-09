import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { Type } from "typebox";
import { evaluatePolicy } from "@cosmora/policy-engine";
import { RESEARCH_LIMITS, researchHtml, researchMarkdown, type ResearchRun } from "@cosmora/core";
import type { IdentityContext } from "@cosmora/contracts";
import type { ProjectStore, PolicyStore, EmergencyStopStore } from "@cosmora/db";
import type { WebSearch } from "../web-search.js";
import type { ResearchStore } from "./research-store.js";
import { ResearchCoordinator } from "./research-coordinator.js";
import { ResearchPageReader } from "./page-reader.js";

export function registerResearchRoutes(options: {
  app: FastifyInstance;
  store: ResearchStore;
  search: WebSearch;
  projects: ProjectStore;
  policy: PolicyStore;
  emergency?: EmergencyStopStore;
  identityFor: (request: FastifyRequest) => IdentityContext;
  reader?: ResearchPageReader;
}): ResearchCoordinator {
  const { app, store, search, projects, policy, identityFor } = options;
  const authorized = (run: ResearchRun): boolean => {
    if (!projects.getProject(run.project_id, run.owner_id)) return false;
    const profile = policy.ensureProfile(run.project_id);
    if (!profile) return false;
    const evaluatedAt = new Date().toISOString();
    const intent = {
      operation_id: run.id,
      project_id: run.project_id,
      actor_id: run.actor_id,
      capability_ids: ["context.web.read" as const],
      object_ids: [run.project_id],
      purpose: "research.v1",
      idempotency_key: run.id
    };
    const verdict = evaluatePolicy(
      {
        intent,
        profile,
        permissionContracts: policy.listActivePermissions(
          run.project_id,
          run.actor_id,
          evaluatedAt,
          run.id
        )
      },
      { evaluatedAt }
    );
    return verdict.verdict === "ALLOW" || verdict.verdict === "ALLOW_WITH_LIMITS";
  };
  const coordinator = new ResearchCoordinator(
    store,
    search,
    options.reader ?? new ResearchPageReader(),
    options.emergency,
    Date.now,
    authorized
  );
  const idParams = Type.Object(
    { id: Type.String({ format: "uuid" }) },
    { additionalProperties: false }
  );
  type Params = { id: string };
  const owned = (request: FastifyRequest<{ Params: Params }>) =>
    store.get(request.params.id, identityFor(request).owner_id);
  const notFound = { error: { code: "RESEARCH_NOT_FOUND", message: "Исследование не найдено" } };

  app.get("/api/v1/research/status", () => ({
    available: search.configured,
    limits: RESEARCH_LIMITS,
    model_usage: "none"
  }));
  app.get("/api/v1/research", (request) => ({ items: store.list(identityFor(request).owner_id) }));
  app.post<{ Body: { project_id: string; question: string } }>(
    "/api/v1/research",
    {
      schema: {
        body: Type.Object(
          {
            project_id: Type.String({ minLength: 1, maxLength: 128 }),
            question: Type.String({ minLength: 8, maxLength: 240 })
          },
          { additionalProperties: false }
        )
      }
    },
    (request, reply) => {
      const { owner_id, actor_id } = identityFor(request);
      if (!projects.getProject(request.body.project_id, owner_id))
        return reply.code(404).send({ error: { code: "PROJECT_NOT_FOUND" } });
      if (!search.configured)
        return reply.code(503).send({ error: { code: "SEARCH_UNAVAILABLE" } });
      if (
        options.emergency?.getProcessStop() ||
        options.emergency?.getProjectStop(request.body.project_id, owner_id)
      )
        return reply.code(423).send({ error: { code: "EMERGENCY_STOP" } });
      const question = request.body.question.trim();
      if (question.length < 8) return reply.code(400).send({ error: { code: "VALIDATION_ERROR" } });
      // Policy check before creating durable state or making any external read.
      const candidate: ResearchRun = {
        id: randomUUID(),
        owner_id,
        actor_id,
        project_id: request.body.project_id,
        question,
        status: "queued",
        stage: "",
        candidates: [],
        next_index: 0,
        sources: [],
        attempts: 0,
        error_code: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      if (!authorized(candidate))
        return reply.code(403).send({
          error: {
            code: "WEB_READ_DENIED",
            message: "Для исследования требуется разрешённый веб-доступ проекта (A1+)"
          }
        });
      let run: ResearchRun;
      try {
        run = store.create(owner_id, actor_id, request.body.project_id, question, candidate.id);
      } catch {
        return reply.code(429).send({ error: { code: "RESEARCH_LIMIT" } });
      }
      if (!coordinator.launch(run)) {
        store.update(run.id, owner_id, ["queued"], (value) => {
          value.status = "paused";
          value.stage = "Очередь занята — запустите продолжение позже";
        });
      }
      return reply.code(201).send(store.get(run.id, owner_id));
    }
  );
  app.get<{ Params: Params }>(
    "/api/v1/research/:id",
    { schema: { params: idParams } },
    (request, reply) => owned(request) ?? reply.code(404).send(notFound)
  );
  app.delete<{ Params: Params }>(
    "/api/v1/research/:id",
    { schema: { params: idParams } },
    (request, reply) => {
      const run = owned(request);
      if (!run) return reply.code(404).send(notFound);
      if (!store.delete(run.id, run.owner_id))
        return reply.code(409).send({ error: { code: "INVALID_STATE" } });
      return { deleted: true };
    }
  );
  app.post<{ Params: Params }>(
    "/api/v1/research/:id/pause",
    { schema: { params: idParams } },
    (request, reply) => {
      const run = owned(request);
      if (!run) return reply.code(404).send(notFound);
      return (
        coordinator.pause(run.id, run.owner_id) ??
        reply.code(409).send({ error: { code: "INVALID_STATE" } })
      );
    }
  );
  app.post<{ Params: Params }>(
    "/api/v1/research/:id/cancel",
    { schema: { params: idParams } },
    (request, reply) => {
      const run = owned(request);
      if (!run) return reply.code(404).send(notFound);
      return (
        coordinator.cancel(run.id, run.owner_id) ??
        reply.code(409).send({ error: { code: "INVALID_STATE" } })
      );
    }
  );
  app.post<{ Params: Params }>(
    "/api/v1/research/:id/resume",
    { schema: { params: idParams } },
    (request, reply) => {
      const run = owned(request);
      if (!run) return reply.code(404).send(notFound);
      if (run.status !== "paused")
        return reply.code(409).send({ error: { code: "INVALID_STATE" } });
      if (!authorized(run)) return reply.code(403).send({ error: { code: "WEB_READ_DENIED" } });
      if (!coordinator.launch(run))
        return reply.code(429).send({ error: { code: "RESEARCH_BUSY_OR_STOPPED" } });
      return store.get(run.id, run.owner_id);
    }
  );
  app.get<{ Params: Params }>(
    "/api/v1/research/:id/artifacts",
    { schema: { params: idParams } },
    (request, reply) => {
      const run = owned(request);
      if (!run) return reply.code(404).send(notFound);
      return {
        items: (["md", "html"] as const).map((format) => ({
          artifact_id: `research:${run.id}:${format}`,
          kind: "research_report",
          source_run_id: run.id,
          version: run.updated_at,
          media_type: format === "md" ? "text/markdown" : "text/html",
          download_url: `/api/v1/research/${run.id}/export/${format}`,
          sources: run.sources.map((source) => ({ url: source.url, status: source.status }))
        }))
      };
    }
  );
  app.get<{ Params: Params & { format: "md" | "html" } }>(
    "/api/v1/research/:id/export/:format",
    {
      schema: {
        params: Type.Object(
          {
            id: Type.String({ format: "uuid" }),
            format: Type.Union([Type.Literal("md"), Type.Literal("html")])
          },
          { additionalProperties: false }
        )
      }
    },
    (request, reply) => {
      const run = store.get(request.params.id, identityFor(request).owner_id);
      if (!run) return reply.code(404).send(notFound);
      const isHtml = request.params.format === "html";
      const body = isHtml ? researchHtml(run) : researchMarkdown(run);
      return reply
        .header(
          "Content-Type",
          isHtml ? "text/html; charset=utf-8" : "text/markdown; charset=utf-8"
        )
        .header(
          "Content-Disposition",
          `attachment; filename="kosmora-research-${run.id}.${isHtml ? "html" : "md"}"`
        )
        .header(
          "Content-Security-Policy",
          "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"
        )
        .header("X-Content-Type-Options", "nosniff")
        .header("Cache-Control", "private, no-store")
        .send(body);
    }
  );
  return coordinator;
}
