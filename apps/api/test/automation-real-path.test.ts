import { afterEach, describe, expect, it } from "vitest";
import {
  AutomationStore,
  EmergencyStopStore,
  ManagerWorkStore,
  openDatabase,
  PolicyStore,
  ProjectStore,
  runMigrations,
  StarsMissionStore
} from "@cosmora/db";
import {
  ModelGateway,
  ModelRegistry,
  ModelRouter,
  type ModelProviderAdapter,
  type ProviderStreamEvent
} from "@cosmora/model-gateway";
import { loadServerConfig } from "@cosmora/config";
import { buildModelRuntime, loadModelRegistryDocument } from "../src/model-runtime.js";
import { ManagerWorkCoordinator } from "../src/manager-work-coordinator.js";
import { buildApp } from "../src/app.js";
import { AccountStore } from "../src/account-settings/account-store.js";
import type { ModelRequest, WorkflowDefinitionInput } from "@cosmora/contracts";

const owner = "local-owner";
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

const procedure = (): WorkflowDefinitionInput => ({
  name: "Отчёт из разрешённых файлов",
  description: "Create a checked report from an allowed source",
  parameters: [{ id: "topic", label: "Тема", type: "text", required: true }],
  nodes: [
    {
      id: "report",
      title: "Подготовить отчёт",
      goal: "Create report.md about {{topic}}. Use only supplied project files.",
      depends_on: []
    }
  ],
  requirements: ["work.files.create"],
  expected_results: ["report.md"],
  conditions: [
    {
      id: "source",
      description: "Only supplied project materials may be used",
      kind: "result_check"
    }
  ]
});

async function realFixture() {
  const db = openDatabase(":memory:");
  cleanups.push(() => db.close());
  await runMigrations(db);
  const accountStore = new AccountStore(db.sqlite);
  accountStore.migrate();
  const store = new ManagerWorkStore(db.sqlite);
  const projects = new ProjectStore(db.sqlite);
  const policy = new PolicyStore(db.sqlite);
  const emergency = new EmergencyStopStore(db.sqlite);
  const automationStore = new AutomationStore(db.sqlite);
  const stars = new StarsMissionStore(db.sqlite);
  const project = projects.createProject("Procedure", "client-procedure", owner).project;
  policy.ensureProfile(project.id);
  policy.updateProfile({
    projectId: project.id,
    baseLevel: "A2",
    overrides: [],
    expectedVersion: 1
  });
  const calls: ModelRequest[] = [];
  const adapter: ModelProviderAdapter = {
    id: "mock",
    modelId: "manager-b0.1",
    async *stream(request, signal): AsyncGenerator<ProviderStreamEvent> {
      calls.push(request);
      await Promise.resolve();
      void signal;
      yield {
        type: "text.delta",
        delta: JSON.stringify(
          request.task_type === "manager_work_plan"
            ? {
                summary: "Create the report",
                instructions: "Create report.md",
                complexity: "simple",
                needs_critic: false,
                requires_external_actions: false
              }
            : request.task_type === "manager_work_review"
              ? { verdict: "PASS", reason: "Fixture review" }
              : { files: [{ name: "report.md", content: "# Report\nTrusted result" }] }
        )
      };
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
    ownerBudget: accountStore
  });
  const app = buildApp({
    config,
    database: db,
    projectStore: projects,
    managerWorkStore: store,
    managerWorkCoordinator: coordinator,
    automationStore,
    starsMissionStore: stars,
    modelContextWindowTokens: 128000
  });
  cleanups.push(() => void app.close());
  const base = `/api/v1/projects/${project.id}`;
  const definition = store.workflows.create(project.id, owner, procedure(), "procedure-1");
  return { db, app, store, coordinator, automationStore, stars, project, definition, base, calls };
}

describe("Real production path for repeatable procedures", () => {
  it("saves a procedure version, runs it manually through the real Work DAG and verifies the result", async () => {
    const f = await realFixture();
    const trigger = await f.app.inject({
      method: "POST",
      url: "/api/v1/automation/triggers",
      payload: {
        client_request_id: "manual-procedure",
        project_id: f.project.id,
        workflow_id: f.definition.id,
        definition_version: 1,
        kind: "manual",
        inputs: { topic: "Trusted topic" }
      }
    });
    expect(trigger.statusCode).toBe(201);
    const triggerId = trigger.json<{ id: string }>().id;
    const run = f.automationStore.enqueue(
      owner,
      f.project.id,
      f.automationStore.getTrigger(owner, triggerId)!,
      owner
    );
    expect(f.automationStore.getRun(owner, run.id)?.status).toBe("queued");
    // The route uses a stub-free coordinator; the resulting DAG is real.
    const started = await f.app.inject({
      method: "POST",
      url: `/api/v1/automation/runs/${run.id}/control`,
      payload: { expected_version: run.version, action: "run" }
    });
    expect(started.statusCode).toBe(200);
    const dagId = started.json<{ dagId: string | null }>().dagId;
    expect(dagId).toBeTruthy();
    const graph = f.store.dag.get(dagId!, owner)!;
    expect(graph.project_id).toBe(f.project.id);
    expect(graph.nodes).toHaveLength(1);
    // Execute the single node with the real manager executor and a mock gateway.
    const queued = f.coordinator.dag.control(graph.id, owner, {
      version: graph.version,
      action: "run",
      node_id: graph.nodes[0]!.id
    });
    const workId = queued.nodes[0]!.attempts.at(-1)!.work_id;
    await f.coordinator.execute(workId, owner);
    // Verify a real published artifact with byte checks.
    const bundle = f.coordinator.dag.results(graph.id, owner);
    expect(bundle.files.some((file) => file.name === "report.md" && file.published)).toBe(true);
    // Reconcile moves the run to succeeded only after published byte-verified results.
    const reconciled = await f.app.inject({
      method: "GET",
      url: `/api/v1/automation/runs/${run.id}/reconcile`
    });
    expect(reconciled.statusCode).toBe(200);
    expect(reconciled.json<{ status: string }>().status).toBe("succeeded");
    // Changing the saved procedure does not change the already-bound run snapshot.
    f.store.workflows.edit(f.project.id, owner, f.definition.id, 1, {
      ...procedure(),
      name: "Changed procedure"
    });
    const persisted = f.automationStore.getRun(owner, run.id)!;
    expect(persisted.definition_version).toBe(1);
    expect(persisted.dag_id).toBe(dagId);
  });
});
