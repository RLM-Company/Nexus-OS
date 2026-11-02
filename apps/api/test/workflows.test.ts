import { loadServerConfig } from "@cosmora/config";
import type { ModelRequest, WorkDag, WorkDagNodeInput, WorkOwnerBudget } from "@cosmora/contracts";
import {
  EmergencyStopStore,
  ManagerWorkStore,
  openDatabase,
  PolicyStore,
  ProjectStore,
  runMigrations
} from "@cosmora/db";
import {
  ModelGateway,
  ModelRegistry,
  ModelRouter,
  type ModelProviderAdapter,
  type ProviderStreamEvent
} from "@cosmora/model-gateway";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { ManagerWorkCoordinator } from "../src/manager-work-coordinator.js";
import { buildModelRuntime, loadModelRegistryDocument } from "../src/model-runtime.js";
import { AccountStore } from "../src/account-settings/account-store.js";
import type { WorkflowDefinition, WorkflowDefinitionInput, WorkflowRun } from "@cosmora/contracts";
import { WorkPrivacyAdapter } from "../src/account-settings/privacy/integrated-adapters.js";

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});
const owner = "local-owner";
const nodes: WorkDagNodeInput[] = [
  { id: "brief", title: "Brief", goal: "Create an exact brief", depends_on: [] },
  {
    id: "document",
    title: "Document",
    goal: "Use the brief to create the document",
    depends_on: ["brief"]
  },
  { id: "independent", title: "Independent", goal: "Create an independent file", depends_on: [] }
];
async function fixture(
  options: {
    path?: string;
    ownerBudget?: WorkOwnerBudget;
    onCall?: (request: ModelRequest, signal: AbortSignal) => Promise<void>;
    output?: (request: ModelRequest) => unknown;
  } = {}
) {
  const db = openDatabase(options.path ?? ":memory:");
  let closed = false;
  const close = () => {
    if (!closed) {
      closed = true;
      db.close();
    }
  };
  cleanups.push(close);
  await runMigrations(db);
  const accountStore = new AccountStore(db.sqlite);
  accountStore.migrate();
  const store = new ManagerWorkStore(db.sqlite),
    projects = new ProjectStore(db.sqlite),
    policy = new PolicyStore(db.sqlite),
    emergency = new EmergencyStopStore(db.sqlite);
  const project = projects.createProject("DAG", "source").project;
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
      await options.onCall?.(request, signal);
      yield {
        type: "text.delta",
        delta: JSON.stringify(
          options.output?.(request) ??
            (request.task_type === "manager_work_plan"
              ? {
                  summary: "Create complete file",
                  instructions: "Create result.md",
                  complexity: "simple",
                  needs_critic: false,
                  requires_external_actions: false
                }
              : request.task_type === "manager_work_review"
                ? { verdict: "PASS", reason: "Fixture content review" }
                : {
                    files: [
                      { name: "result.md", content: "# Exact\nDependency evidence in a real file" }
                    ]
                  })
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
  const deps = {
    store,
    projects,
    policy,
    emergency,
    gateway,
    manager: runtime.manager,
    ownerBudget: options.ownerBudget ?? accountStore
  };
  const coordinator = new ManagerWorkCoordinator(deps),
    dag = coordinator.dag;
  const create = () =>
    dag.create(project.id, owner, owner, { client_request_id: "plan", title: "My plan", nodes });
  async function execute(graph: WorkDag, node: string) {
    const latest = dag.get(graph.id, owner)!;
    const queued = dag.control(graph.id, owner, {
      version: latest.version,
      action: "run",
      node_id: node
    });
    const child = queued.nodes.find((n) => n.id === node)!.attempts.at(-1)!;
    await coordinator.execute(child.work_id, owner);
    return dag.get(graph.id, owner)!;
  }
  return {
    db,
    close,
    store,
    projects,
    project,
    policy,
    coordinator,
    dag,
    create,
    execute,
    calls,
    deps,
    config
  };
}

const definition = (): WorkflowDefinitionInput => ({
  name: "Repeatable report",
  description: "Real Work DAG",
  parameters: [{ id: "topic", label: "Topic", type: "text", required: true }],
  nodes: [
    { id: "brief", title: "Brief", goal: "Create brief.md about {{topic}}", depends_on: [] },
    {
      id: "report",
      title: "Report",
      goal: "Create report.md from the prior brief about {{topic}}",
      depends_on: ["brief"]
    }
  ],
  requirements: ["work.files.create"],
  expected_results: ["report.md"]
});
async function workflowFixture() {
  const f = await fixture();
  const app = buildApp({
    config: f.config,
    database: f.db,
    projectStore: f.projects,
    managerWorkStore: f.store,
    managerWorkCoordinator: f.coordinator,
    modelContextWindowTokens: 128000
  });
  const base = `/api/v1/projects/${f.project.id}/workflows`;
  return { ...f, app, base };
}
describe("Reusable Koswork scenarios through HTTP and the real Work executor", () => {
  it("saves/replays creation, imports portable definitions and isolates owners without model calls", async () => {
    const f = await workflowFixture();
    try {
      const payload = { client_creation_id: "save-once", definition: definition() };
      const created = await f.app.inject({ method: "POST", url: f.base, payload });
      expect(created.statusCode).toBe(201);
      const d = created.json<WorkflowDefinition>();
      expect(
        (await f.app.inject({ method: "POST", url: f.base, payload })).json<WorkflowDefinition>().id
      ).toBe(d.id);
      expect(
        (
          await f.app.inject({
            method: "POST",
            url: f.base,
            payload: { ...payload, definition: { ...definition(), name: "Changed" } }
          })
        ).statusCode
      ).toBe(409);
      const exported = await f.app.inject(f.base + "/" + d.id + "/package");
      expect(exported.headers["cache-control"]).toContain("no-store");
      expect(
        exported.json<{ format: "kosmora.workflow.v1"; definition: WorkflowDefinitionInput }>()
      ).toEqual({ format: "kosmora.workflow.v1", definition: definition() });
      const imported = await f.app.inject({
        method: "POST",
        url: f.base + "/import",
        payload: {
          client_creation_id: "import-once",
          package: exported.json<{
            format: "kosmora.workflow.v1";
            definition: WorkflowDefinitionInput;
          }>()
        }
      });
      expect(imported.statusCode).toBe(201);
      expect(imported.json<WorkflowDefinition>().id).not.toBe(d.id);
      expect(
        (
          await f.app.inject({
            method: "POST",
            url: f.base + "/import",
            payload: {
              client_creation_id: "import-once",
              package: exported.json<{
                format: "kosmora.workflow.v1";
                definition: WorkflowDefinitionInput;
              }>()
            }
          })
        ).json<WorkflowDefinition>().id
      ).toBe(imported.json<WorkflowDefinition>().id);
      expect(
        (
          await f.app.inject({
            method: "POST",
            url: f.base + "/import",
            payload: {
              client_creation_id: "bad",
              package: {
                ...exported.json<{
                  format: "kosmora.workflow.v1";
                  definition: WorkflowDefinitionInput;
                }>(),
                permissions: { all: true }
              }
            }
          })
        ).statusCode
      ).toBe(400);
      const foreign = f.projects.createProject("Foreign", "other", "foreign-owner").project;
      expect((await f.app.inject(f.base.replace(f.project.id, foreign.id))).statusCode).toBe(404);
      expect(
        (await f.app.inject(f.base)).json<{ items: WorkflowDefinition[] }>().items
      ).toHaveLength(2);
      expect(f.calls).toHaveLength(0);
    } finally {
      await f.app.close();
    }
  });
  it("freezes parameters, project evidence and node budgets, then produces dependent published files", async () => {
    const f = await workflowFixture();
    try {
      f.projects.setMaterials(f.project.id, owner, {
        version: f.projects.getMaterials(f.project.id, owner)!.version,
        instructions: "ORIGINAL PROJECT SOURCE",
        attachments: [{ name: "input.txt", content: "ORIGINAL FACTS" }]
      });
      const d = (
        await f.app.inject({
          method: "POST",
          url: f.base,
          payload: { client_creation_id: "create", definition: definition() }
        })
      ).json<WorkflowDefinition>();
      const input = {
        client_request_id: "run-once-" + "a".repeat(80),
        expected_version: 1,
        inputs: { topic: "Original topic" },
        auto_start: false
      };
      const response = await f.app.inject({
        method: "POST",
        url: f.base + "/" + d.id + "/runs",
        payload: input
      });
      expect(response.statusCode).toBe(201);
      const result = response.json<{ run: WorkflowRun; graph: WorkDag }>();
      expect(f.calls).toHaveLength(0);
      expect(result.graph.workflow_context?.node_budget).toEqual({
        max_input_tokens: 384000,
        max_output_tokens: f.config.managerMaxOutputTokens * 3
      });
      f.projects.setMaterials(f.project.id, owner, {
        version: f.projects.getMaterials(f.project.id, owner)!.version,
        instructions: "CHANGED PROJECT SOURCE",
        attachments: []
      });
      expect(
        (
          await f.app.inject({
            method: "PUT",
            url: f.base + "/" + d.id,
            payload: { expected_version: 1, definition: { ...definition(), name: "Version two" } }
          })
        ).statusCode
      ).toBe(200);
      expect(
        (
          await f.app.inject({
            method: "PUT",
            url: f.base + "/" + d.id,
            payload: { expected_version: 1, definition: { ...definition(), name: "Version two" } }
          })
        ).statusCode
      ).toBe(200);
      expect(
        (await f.app.inject(f.base + "/" + d.id + "/versions")).json<{ items: unknown[] }>().items
      ).toHaveLength(2);
      expect(
        (
          await f.app.inject({ method: "POST", url: f.base + "/" + d.id + "/runs", payload: input })
        ).json<{ run: WorkflowRun }>().run.id
      ).toBe(result.run.id);
      expect(
        (
          await f.app.inject({
            method: "POST",
            url: f.base + "/" + d.id + "/runs",
            payload: { ...input, inputs: { topic: "Changed" } }
          })
        ).statusCode
      ).toBe(409);
      for (const id of ["brief", "report"]) {
        const graph = f.dag.get(result.graph.id, owner)!;
        const queued = f.dag.control(graph.id, owner, {
          version: graph.version,
          action: "run",
          node_id: id
        });
        const child = queued.nodes.find((n) => n.id === id)!.attempts.at(-1)!;
        await f.coordinator.execute(child.work_id, owner);
      }
      const finished = f.dag.get(result.graph.id, owner)!;
      expect(finished.nodes.map((n) => n.status)).toEqual(["completed", "completed"]);
      const prompts = JSON.stringify(f.calls);
      expect(prompts).toContain("ORIGINAL PROJECT SOURCE");
      expect(prompts).toContain("ORIGINAL FACTS");
      expect(prompts).not.toContain("CHANGED PROJECT SOURCE");
      expect(prompts).toContain("Original topic");
      expect(prompts).toContain("Dependency evidence in a real file");
      const download = await f.app.inject(
        `/api/v1/projects/${f.project.id}/work-dags/${finished.id}/results.zip`
      );
      expect(download.statusCode).toBe(200);
      expect(download.rawPayload.subarray(0, 2).toString()).toBe("PK");
      const history = (await f.app.inject(f.base + "/" + d.id + "/runs")).json<{
        items: WorkflowRun[];
      }>();
      expect(history.items).toHaveLength(1);
      expect(history.items[0]!.definition.name).toBe("Repeatable report");
    } finally {
      await f.app.close();
    }
  });
  it("rejects unavailable tools and invalid inputs atomically, exports and deletes owner scenario data", async () => {
    const f = await workflowFixture();
    try {
      const d = (
        await f.app.inject({
          method: "POST",
          url: f.base,
          payload: {
            client_creation_id: "create",
            definition: { ...definition(), requirements: ["desktop.control"] }
          }
        })
      ).json<WorkflowDefinition>();
      const count = () =>
        f.db.sqlite.prepare("SELECT COUNT(*) n FROM work_dags").get() as { n: number };
      const before = count().n;
      const url = f.base + "/" + d.id + "/runs",
        payload = {
          client_request_id: "run",
          expected_version: 1,
          inputs: { topic: "test" },
          auto_start: true
        };
      const unavailable = await f.app.inject({ method: "POST", url, payload });
      expect(unavailable.statusCode).toBe(409);
      expect(unavailable.json()).toEqual({ error: "WORKFLOW_TOOL_UNAVAILABLE" });
      expect(count().n).toBe(before);
      expect(
        (
          await f.app.inject({
            method: "POST",
            url,
            payload: { ...payload, inputs: { wrong: "test" } }
          })
        ).statusCode
      ).toBe(400);
      expect(f.calls).toHaveLength(0);
      const privacy = new WorkPrivacyAdapter(f.db.sqlite, f.coordinator);
      const data = await privacy.export(owner);
      expect(data.records.workflows).toHaveLength(1);
      expect(data.records.workflow_versions).toHaveLength(1);
      f.db.sqlite
        .prepare(
          "INSERT INTO kosmora_owner_data_lifecycle(owner_id,state,epoch,operation_id,started_at,updated_at) VALUES (?,'quiescing',1,'workflow-privacy',datetime('now'),?) ON CONFLICT(owner_id) DO UPDATE SET state='quiescing',epoch=1"
        )
        .run(owner, new Date().toISOString());
      await privacy.quiesce(owner, 1);
      f.db.sqlite
        .prepare(
          "UPDATE kosmora_owner_data_lifecycle SET state='deleting',updated_at=?2 WHERE owner_id=?1"
        )
        .run(owner, new Date().toISOString());
      await privacy.delete(owner, 1);
      expect(f.store.workflows.list(f.project.id, owner)).toHaveLength(0);
      expect(f.db.sqlite.prepare("SELECT COUNT(*) n FROM kosmora_workflow_versions").get()).toEqual(
        { n: 0 }
      );
    } finally {
      await f.app.close();
    }
  });
});
