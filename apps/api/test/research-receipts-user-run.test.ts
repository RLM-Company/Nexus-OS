/* eslint-disable @typescript-eslint/require-await -- IO is replaced only at fixture boundaries. */
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import type { IdentityContext } from "@cosmora/contracts";
import type { ResearchRun } from "@cosmora/core";
import { loadServerConfig } from "@cosmora/config";
import {
  openDatabase,
  PolicyStore,
  ProjectSourceStore,
  ProjectStore,
  runMigrations
} from "@cosmora/db";
import type { ModelGateway, ModelGatewayStreamEvent } from "@cosmora/model-gateway";
import { expect, it } from "vitest";
import { registerProjectSourceRoutes } from "../src/project-source-routes.js";
import { ResearchPageReader } from "../src/research/page-reader.js";
import { registerResearchRoutes } from "../src/research/research-routes.js";
import { ResearchStore } from "../src/research/research-store.js";
import { buildModelRuntime } from "../src/model-runtime.js";

it("keeps conflicting evidence and follows up after restart and source exclusion", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nexus-research-receipts-"));
  const path = join(dir, "fixture.sqlite");
  const owner = "research-owner",
    project = "research-project";
  const url = "https://example.org/alpha";
  const mirror = "https://mirror.example.net/alpha";
  const conflict = "https://comparison.example.com/alpha";
  const initialQuestion = "Сколько стоит тариф Alpha?";
  const revisedQuestion = "Сколько стоит тариф Alpha в официальном архиве?";
  let currentOwner = owner;
  const { manager } = await buildModelRuntime(loadServerConfig({ NODE_ENV: "test" }));
  const inspected: string[] = [];
  let citation = "S1",
    modelCalls = 0;
  let db = openDatabase(path);
  await runMigrations(db);
  db.sqlite.exec(readFileSync(new URL("../src/research/migration.sql", import.meta.url), "utf8"));
  const projects = new ProjectStore(db.sqlite);
  projects.createEmptyProject(project, "Тариф Alpha", owner, "ACTIVE");
  const policy = new PolicyStore(db.sqlite);
  policy.ensureProfile(project);
  policy.updateProfile({ projectId: project, baseLevel: "A2", overrides: [], expectedVersion: 1 });
  const identityFor = (): IdentityContext => ({
    owner_id: currentOwner,
    actor_id: currentOwner,
    actor_kind: "owner",
    session_id: "fixture",
    assurance: "local",
    authenticated_at: "2026-11-26T00:00:00.000Z",
    expires_at: "9999-12-31T00:00:00.000Z"
  });
  const route = {
    attempt: 0,
    registry_version: "test",
    provider_id: "fixture",
    model_id: "fixture",
    estimated_input_tokens: 100,
    max_output_tokens: 100,
    estimated_cost: { amount: 0, currency: "USD" as const }
  };
  const gateway = {
    assertRoute: () => {},
    async *stream(request: {
      messages: { content: string }[];
    }): AsyncGenerator<ModelGatewayStreamEvent> {
      modelCalls++;
      const excerpts = (
        JSON.parse(request.messages[1]!.content) as {
          excerpts: { source_id: string }[];
        }
      ).excerpts;
      const compared = excerpts.some(({ source_id }) => source_id === "S3");
      expect(excerpts.some(({ source_id }) => source_id === "S2")).toBe(false);
      yield { type: "route.selected", route };
      yield {
        type: "text.delta",
        delta: JSON.stringify({
          summary: [
            {
              text: compared
                ? "Цена тарифа Alpha спорная."
                : "В архиве тариф Alpha стоит 50 рублей.",
              citations: [{ source_id: citation, excerpt_id: "E1" }]
            }
          ],
          disagreements: compared
            ? [
                {
                  text: "Тариф Alpha: в архиве 50 рублей, в сравнении 5000 рублей.",
                  citations: [
                    { source_id: "S1", excerpt_id: "E1" },
                    { source_id: "S3", excerpt_id: "E1" }
                  ]
                }
              ]
            : [],
          gaps: []
        })
      };
      yield {
        type: "response.completed",
        route,
        provider: "fixture",
        model: "fixture",
        finishReason: "stop",
        usage: { inputTokens: 10, outputTokens: 10 },
        calculatedCost: { amount: 0, currency: "USD" }
      };
    }
  } as unknown as ModelGateway;
  function makeApp() {
    const app = Fastify();
    const sources = new ProjectSourceStore(db.sqlite);
    registerProjectSourceRoutes(app, sources, identityFor);
    const coordinator = registerResearchRoutes({
      app,
      store: new ResearchStore(db.sqlite),
      projects: new ProjectStore(db.sqlite),
      policy: new PolicyStore(db.sqlite),
      identityFor,
      gateway,
      manager,
      ownerBudget: {
        createRun: () => {},
        reserve: () => {},
        settle: () => "committed",
        uncertain: () => {},
        failBeforeDispatch: () => {}
      },
      excludedSourceIds: () =>
        new Set(sources.exclusions(project, owner).items.map((row) => row.source_id)),
      search: {
        configured: true,
        search: async (question) => ({
          query: question,
          searched_at: new Date().toISOString(),
          items: [url, mirror, conflict].map((url) => ({ title: "Тарифы", url, snippet: "" }))
        })
      },
      reader: new ResearchPageReader({
        resolver: async () => [{ address: "93.184.216.34", family: 4 }],
        transport: async (address) => {
          if (address.pathname === "/robots.txt") return { status: 404, body: "", contentType: "" };
          inspected.push(address.toString());
          return {
            status: 200,
            contentType: "text/html",
            body:
              address.href === conflict
                ? "<p>Сравнение: тариф Alpha стоит 5000 рублей в месяц по условиям сравнения.</p>"
                : "<p>Тариф Alpha стоит 50 рублей в месяц. Сведения проверены по открытому архиву условий тарифа.</p>"
          };
        }
      })
    });
    app.addHook("onClose", () => coordinator.stop());
    return app;
  }
  let app = makeApp();
  const get = async (id: string) => {
    const response = await app.inject({ url: "/api/v1/research/" + id });
    expect(response.statusCode).toBe(200);
    return response.json<ResearchRun>();
  };
  async function launch(payload: Partial<ResearchRun> & { client_request_id?: string } = {}) {
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/research",
      payload: { project_id: project, question: initialQuestion, synthesize: true, ...payload }
    });
    expect(created.statusCode, created.body).toBe(201);
    const { id } = created.json<ResearchRun>();
    await expect.poll(async () => (await get(id)).status).toMatch(/^(completed|failed|paused)$/);
    return get(id);
  }
  try {
    const run = await launch();
    expect(run.status, JSON.stringify(run)).toBe("completed");
    expect(run.receipts).toHaveLength(3);
    expect(run.sources[1]).toMatchObject({
      status: "duplicate",
      duplicate_of: "S1",
      content_digest: run.sources[0]!.content_digest
    });
    expect(run.answer?.disagreements[0]?.citations.map(({ source_id }) => source_id)).toEqual([
      "S1",
      "S3"
    ]);
    const originUrl = `/api/v1/research/${run.id}/source-origin`;
    const note = "Прайс опубликован владельцем тарифа";
    const mark = (source_index: number, role: "primary" | "independent", note: string) =>
      app.inject({ method: "PUT", url: originUrl, payload: { source_index, role, note } });
    expect((await mark(1, "independent", note)).statusCode).toBe(409);
    expect((await mark(0, "primary", " ")).statusCode).toBe(400);
    expect((await mark(0, "primary", note)).json<ResearchRun>().sources[0]?.origin).toEqual({
      role: "primary",
      note
    });
    currentOwner = "different-owner";
    expect((await mark(0, "independent", "Чужая отметка")).statusCode).toBe(404);
    currentOwner = owner;
    for (const format of ["md", "html"]) {
      const report = await app.inject({ url: `/api/v1/research/${run.id}/export/${format}` });
      expect(report.statusCode).toBe(200);
      expect(report.body).toContain("5000 рублей");
      expect(report.body).toContain("совпадает со снимком S1");
      expect(report.body).toContain(note);
      expect(report.body).toContain(run.sources[0]!.content_digest!);
    }
    const receipt = run.receipts![0]!;
    const hash = (text: string) => createHash("sha256").update(text).digest("hex");
    expect(receipt).toMatchObject({
      url,
      source_id: "S1",
      excerpt_id: "E1",
      project_source_id: hash(url),
      checked_at: run.sources[0]!.checked_at,
      content_digest: run.sources[0]!.content_digest,
      quote: run.sources[0]!.passages[0],
      excerpt_sha256: hash(run.sources[0]!.passages[0]!)
    });
    citation = "S9";
    const invalid = await launch();
    expect(invalid.model?.error_code).toBe("SYNTHESIS_INVALID_CITATION");
    expect(invalid.receipts).toBeUndefined();
    await app.close();
    db.close();
    db = openDatabase(path);
    app = makeApp();
    expect((await get(run.id)).receipts).toEqual(run.receipts);
    expect((await get(run.id)).sources[0]?.origin?.note).toBe(note);
    const settings = "/api/v1/projects/" + project + "/sources/exclusions";
    const current = await app.inject({ url: settings });
    const update = await app.inject({
      method: "PUT",
      url: settings,
      payload: {
        expected_version: current.json<{ version: number }>().version,
        exclusions: [
          {
            source_kind: "research_page",
            source_id: hash(conflict),
            excluded_at: new Date().toISOString(),
            reason: "fixture"
          }
        ]
      }
    });
    expect(update.statusCode, update.body).toBe(200);
    citation = "S1";
    const refinement = {
      question: revisedQuestion,
      parent_run_id: run.id,
      client_request_id: "refined-alpha"
    };
    const revised = await launch(refinement);
    expect(revised).toMatchObject({
      status: "completed",
      parent_run_id: run.id,
      question: revisedQuestion
    });
    expect(revised.sources.map(({ url }) => url)).toEqual([url, mirror]);
    expect(revised.receipts?.map(({ url }) => url)).toEqual([url]);
    expect(revised.answer?.disagreements).toEqual([]);
    expect(inspected).toEqual([url, mirror, conflict, url, mirror, conflict, url, mirror]);
    expect(modelCalls).toBe(3);
    const request = {
      method: "POST" as const,
      url: "/api/v1/research",
      payload: { project_id: project, synthesize: true, ...refinement }
    };
    const replay = await app.inject(request);
    expect(replay.statusCode).toBe(200);
    expect(replay.json<ResearchRun>().id).toBe(revised.id);
    expect(
      (
        await app.inject({
          ...request,
          payload: { ...request.payload, parent_run_id: invalid.id }
        })
      ).statusCode
    ).toBe(409);
    currentOwner = "different-owner";
    expect((await app.inject({ url: `/api/v1/research/${revised.id}` })).statusCode).toBe(404);
    const otherProject = "other-project";
    new ProjectStore(db.sqlite).createEmptyProject(otherProject, "Other", currentOwner, "ACTIVE");
    expect(
      (
        await app.inject({
          ...request,
          payload: { ...request.payload, project_id: otherProject }
        })
      ).statusCode
    ).toBe(404);
    currentOwner = owner;
    expect((await get(run.id)).receipts).toEqual(run.receipts);
  } finally {
    await app.close();
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
