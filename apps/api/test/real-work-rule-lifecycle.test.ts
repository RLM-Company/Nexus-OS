import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadServerConfig } from "@cosmora/config";
/* eslint-disable @typescript-eslint/require-await -- Deterministic local provider adapter. */
import type { ModelRequest, WorkDagNodeInput } from "@cosmora/contracts";
import type { ModelProviderAdapter } from "@cosmora/model-gateway";
import {
  EmergencyStopStore,
  ManagerWorkStore,
  openDatabase,
  PolicyStore,
  ProjectCorrectionRuleStore,
  ProjectStore,
  runMigrations
} from "@cosmora/db";
import {
  ModelGateway,
  ModelRegistry,
  ModelRouter,
  type ProviderStreamEvent
} from "@cosmora/model-gateway";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { ManagerWorkCoordinator } from "../src/manager-work-coordinator.js";
import { buildModelRuntime, loadModelRegistryDocument } from "../src/model-runtime.js";
import { registerProjectCorrectionRuleRoutes } from "../src/project-correction-rule-routes.js";
import { AccountStore } from "../src/account-settings/account-store.js";
import { registerWorkDagRoutes } from "../src/work-dag-routes.js";

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});
const owner = "local-owner";
const node: WorkDagNodeInput[] = [
  { id: "compare", title: "Supplier comparison", goal: "Create comparison.txt", depends_on: [] }
];
const sourceRows = ["Поставщик;Цена;Доставка", "Север;250 ₽;5 дней", "Юг;220 ₽;11 дней"].join("\n");

/** Real Work API execution with a local mock provider adapter (no paid calls). */
async function realWorkFixture() {
  const db = openDatabase(":memory:");
  cleanups.push(() => db.close());
  await runMigrations(db);
  const accountStore = new AccountStore(db.sqlite);
  accountStore.migrate();
  const store = new ManagerWorkStore(db.sqlite, { maxConcurrentWork: 1 });
  const projects = new ProjectStore(db.sqlite);
  const policy = new PolicyStore(db.sqlite);
  const emergency = new EmergencyStopStore(db.sqlite);
  const project = projects.createProject("Rules Work", "rules-work-real", owner).project;
  policy.ensureProfile(project.id);
  policy.updateProfile({
    projectId: project.id,
    baseLevel: "A2",
    overrides: [],
    expectedVersion: 1
  });
  const adapter: ModelProviderAdapter = {
    id: "mock",
    modelId: "manager-b0.1",
    async *stream(request: ModelRequest): AsyncGenerator<ProviderStreamEvent> {
      const file =
        request.task_type === "manager_work_plan"
          ? {
              summary: "Create supplier comparison",
              instructions: "Create comparison.txt",
              complexity: "simple",
              needs_critic: false,
              requires_external_actions: false
            }
          : request.task_type === "manager_work_review"
            ? { verdict: "PASS", reason: "Fixture content review" }
            : { files: [{ name: "comparison.txt", content: sourceRows }] };
      yield { type: "text.delta", delta: JSON.stringify(file) };
      yield {
        type: "response.completed",
        provider: "mock",
        model: "manager-b0.1",
        finishReason: "stop",
        usage: { inputTokens: 100, outputTokens: 80 }
      };
    }
  };
  const config = loadServerConfig({ NODE_ENV: "test" });
  const runtime = await buildModelRuntime(config);
  const gateway = new ModelGateway(
    [adapter],
    new ModelRouter(new ModelRegistry(loadModelRegistryDocument("config/model-registry.v1.json"))),
    [],
    {
      maxAttemptsPerRoute: 5,
      now: () => Date.now(),
      retryBaseDelayMs: 1,
      retryMaxDelayMs: 1,
      circuitFailureThreshold: 10,
      circuitOpenMs: 1000
    }
  );
  const coordinator = new ManagerWorkCoordinator({
    store,
    projects,
    policy,
    emergency,
    gateway,
    manager: runtime.manager,
    ownerBudget: accountStore,
    maxConcurrentWork: 1
  });
  const graph = coordinator.dag.create(project.id, owner, owner, {
    client_request_id: "real-work-rules",
    title: "Supplier comparison",
    nodes: node
  });
  const queued = coordinator.dag.control(graph.id, owner, {
    version: graph.version,
    action: "run",
    node_id: "compare"
  });
  const childId = queued.nodes.find((n) => n.id === "compare")!.attempts.at(-1)!.work_id;
  await coordinator.execute(childId, owner);
  const done = coordinator.dag.get(graph.id, owner)!;
  expect(done.nodes[0]!.status).toBe("completed");

  const app = Fastify();
  cleanups.push(() => void app.close());
  const identity = {
    owner_id: owner,
    actor_id: owner,
    actor_kind: "owner",
    assurance: "local",
    session_id: "test",
    authenticated_at: "2026-11-25T00:00:00.000Z"
  } as const;
  const ruleStore = new ProjectCorrectionRuleStore(db.sqlite);
  registerWorkDagRoutes({
    app,
    projects,
    coordinator: coordinator.dag,
    identityFor: () => identity as never
  });
  registerProjectCorrectionRuleRoutes({
    app,
    store: ruleStore,
    identityFor: () => identity as never,
    workResults: (ownerId, dagId) => coordinator.dag.results(dagId, ownerId)
  });
  return { app, project, ruleStore, dagId: graph.id };
}
const post = (app: FastifyInstance, url: string, body: unknown) =>
  app.inject({
    method: "POST",
    url,
    payload: JSON.stringify(body),
    headers: { "content-type": "application/json" }
  });
const runDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "docs/team/operation-2026-11-25/correction-rules/work-runs"
);
const writeRun = (name: string, report: Applied) => {
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, `${name}.txt`), report.content, "utf8");
  writeFileSync(
    join(runDir, `${name}.json`),
    JSON.stringify(
      {
        applied_rule_versions: report.applied_rule_versions,
        rule_statuses: report.rule_statuses
      },
      null,
      2
    ) + "\n",
    "utf8"
  );
};
type Applied = {
  content: string;
  applied_rule_versions: Array<{ id: string; version: number; effect: string }>;
  rule_statuses: Array<{ status: string }>;
};

describe("real Work API run with accepted correction rules", () => {
  it("exports no-rule, with-rule and after-disable files from one real work result", async () => {
    const { app, project, ruleStore, dagId } = await realWorkFixture();
    const base = `/api/v1/projects/${project.id}/correction-rules`;
    const applyUrl = `${base}/work-apply`;
    const noRule = (await post(app, applyUrl, { dag_id: dagId })).json<Applied>();
    expect(noRule.content).toContain("Север: 250 ₽ (доставка 5 дней)");
    expect(noRule.applied_rule_versions).toEqual([]);
    writeRun("work-1-no-rule", noRule);

    const correction = "В сравнении поставщиков всегда показывай доставку отдельной строкой";
    await post(app, `${base}/accept`, { client_request_id: "real-1", correction });
    const withRule = (await post(app, applyUrl, { dag_id: dagId })).json<Applied>();
    expect(withRule.content).toContain("Доставка: 5 дней");
    expect(withRule.applied_rule_versions[0]).toMatchObject({
      version: 1,
      effect: "delivery_separate_line"
    });
    writeRun("work-2-rule-accepted", withRule);

    const rule = ruleStore.active(project.id, owner)[0]!;
    await post(app, `${base}/${rule.id}/disable`, { expected_version: 1 });
    const disabled = (await post(app, applyUrl, { dag_id: dagId })).json<Applied>();
    expect(disabled.content).toContain("Север: 250 ₽ (доставка 5 дней)");
    expect(disabled.applied_rule_versions).toEqual([]);
    writeRun("work-3-rule-disabled", disabled);
  }, 60_000);
});
