/* eslint-disable @typescript-eslint/require-await -- IO is replaced only at fixture boundaries. */
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { type IdentityContext } from "@cosmora/contracts";
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

it("persists validated receipts through Research HTTP and excludes a page from the next run", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nexus-research-receipts-"));
  const path = join(dir, "fixture.sqlite");
  const owner = "research-owner",
    project = "research-project";
  const url = "https://example.org/alpha";
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
    owner_id: owner,
    actor_id: owner,
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
    async *stream(): AsyncGenerator<ModelGatewayStreamEvent> {
      modelCalls++;
      yield { type: "route.selected", route };
      yield {
        type: "text.delta",
        delta: JSON.stringify({
          summary: [
            {
              text: "Тариф Alpha стоит 50 рублей.",
              citations: [{ source_id: citation, excerpt_id: "E1" }]
            }
          ],
          disagreements: [],
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
          items: [{ title: "Тарифы", url, snippet: "" }]
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
            body: "<p>Тариф Alpha стоит 50 рублей в месяц. Сведения проверены по открытому архиву условий тарифа.</p>"
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
  async function launch() {
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/research",
      payload: { project_id: project, question: "Сколько стоит тариф Alpha?", synthesize: true }
    });
    expect(created.statusCode, created.body).toBe(201);
    const { id } = created.json<ResearchRun>();
    await expect.poll(async () => (await get(id)).status).toMatch(/^(completed|failed|paused)$/);
    return get(id);
  }
  try {
    const run = await launch();
    expect(run.status, JSON.stringify(run)).toBe("completed");
    expect(run.receipts).toHaveLength(1);
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
            source_id: hash(url),
            excluded_at: new Date().toISOString(),
            reason: "fixture"
          }
        ]
      }
    });
    expect(update.statusCode, update.body).toBe(200);
    const excluded = await launch();
    expect(excluded.error_code).toBe("NO_READABLE_SOURCES");
    expect(inspected).toEqual([url, url]);
    expect(modelCalls).toBe(2);
    expect((await get(run.id)).receipts).toEqual(run.receipts);
  } finally {
    await app.close();
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
