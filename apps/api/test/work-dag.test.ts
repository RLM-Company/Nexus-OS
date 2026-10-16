import { loadServerConfig } from "@cosmora/config";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ModelRequest, WorkDag, WorkDagNodeInput, WorkOwnerBudget } from "@cosmora/contracts";
import {
  OwnerSkillStore,
  EmergencyStopStore,
  ManagerWorkStore,
  openDatabase,
  PolicyStore,
  ProjectStore,
  runMigrations
} from "@cosmora/db";
import {
  GatewayRunError,
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

describe("executable durable Work DAG", () => {
  it("cancels one unstarted step, freezes its identity across edits and preserves other plans and results", async () => {
    const f = await fixture();
    let graph = await f.execute(f.create(), "independent");
    const result = structuredClone(graph.nodes[2]);
    const snapshot = f.store.skills.forPlan(graph.id, owner);
    let other = f.dag.create(f.project.id, owner, owner, {
      client_request_id: "other-plan",
      title: "Other plan",
      nodes
    });
    other = arm(f, other);
    graph = arm(f, graph);
    const calls = f.calls.length;
    graph = f.dag.control(graph.id, owner, {
      version: graph.version,
      action: "cancel_step",
      node_id: "brief"
    });
    expect(graph.execution).toMatchObject({ status: "stopped", reason: "STEP_CANCELLED_BY_OWNER" });
    expect(graph.nodes.map((n) => n.status)).toEqual(["cancelled", "blocked", "completed"]);
    expect(graph.nodes[1]?.blocked_reason).toBe("DEPENDENCIES:brief");
    expect(graph.nodes[2]).toEqual(result);
    expect(f.store.skills.forPlan(graph.id, owner)).toEqual(snapshot);
    expect(f.dag.get(other.id, owner)).toEqual(other);
    expect(f.store.dag.projectMode(f.project.id, owner)).toBe("active");
    expect(f.calls).toHaveLength(calls);
    expect(
      f.dag.control(graph.id, owner, {
        version: graph.version,
        action: "cancel_step",
        node_id: "brief"
      })
    ).toEqual(graph);
    expect(() =>
      f.dag.control(graph.id, owner, {
        version: graph.version,
        action: "retry",
        node_id: "brief",
        acknowledge_cost: true
      })
    ).toThrow("EXPLICIT_RETRY_REQUIRED");
    expect(() =>
      f.dag.control(graph.id, owner, {
        version: graph.version,
        action: "run",
        node_id: "brief"
      })
    ).toThrow("STEP_NOT_READY");
    expect(() =>
      f.dag.edit(
        graph.id,
        owner,
        graph.version,
        nodes.map((n) => (n.id === "brief" ? { ...n, goal: "Revive cancelled work" } : n))
      )
    ).toThrow("STEP_ALREADY_STARTED");
    graph = f.dag.edit(
      graph.id,
      owner,
      graph.version,
      nodes.map((n) => (n.id === "document" ? { ...n, depends_on: [] } : n))
    );
    expect(graph.nodes[0]?.status).toBe("cancelled");
    expect(graph.nodes[1]?.status).toBe("pending");
    expect(graph.nodes[2]).toEqual(result);
    graph = await f.execute(graph, "document");
    expect(graph.nodes[1]?.status).toBe("completed");
    expect(f.dag.get(other.id, owner)?.execution?.status).toBe("running");
  });
  it("cancels a queued step while the project is paused without resuming or invoking a model", async () => {
    const f = await fixture();
    let graph = f.create();
    graph = f.dag.control(graph.id, owner, {
      version: graph.version,
      action: "run",
      node_id: "brief"
    });
    const workId = graph.nodes[0]!.attempts[0]!.work_id;
    graph = f.dag.control(graph.id, owner, { version: graph.version, action: "pause" });
    graph = f.dag.control(graph.id, owner, {
      version: graph.version,
      action: "cancel_step",
      node_id: "brief"
    });
    expect(graph.mode).toBe("paused");
    expect(graph.nodes[0]?.status).toBe("cancelled");
    expect(f.store.get(workId, owner)?.status).toBe("cancelled");
    await f.coordinator.execute(workId, owner);
    expect(f.calls).toHaveLength(0);
    graph = f.dag.control(graph.id, owner, { version: graph.version, action: "resume" });
    expect(graph.nodes[0]?.status).toBe("cancelled");
    expect(graph.nodes[2]?.status).toBe("pending");
  });
  it("cancels an approval wait without approving or dispatching another stage", async () => {
    const f = await fixture({
      output: (r) =>
        r.task_type === "manager_work_plan"
          ? {
              summary: "Needs approval",
              instructions: "Create file",
              complexity: "complex",
              needs_critic: true,
              requires_external_actions: false
            }
          : undefined
    });
    let graph = await autoTick(f, arm(f, f.create()).id);
    expect(graph.nodes[0]?.blocked_reason).toBe("AWAITING_APPROVAL");
    const workId = graph.nodes[0]!.attempts[0]!.work_id;
    graph = f.dag.control(graph.id, owner, {
      version: graph.version,
      action: "cancel_step",
      node_id: "brief"
    });
    f.dag.advance();
    await f.coordinator.execute(workId, owner);
    expect(f.calls).toHaveLength(1);
    expect(f.store.get(workId, owner)).toMatchObject({ status: "cancelled", approved: false });
    expect(graph.nodes[0]?.result?.plan_summary).toBe("Needs approval");
    expect(graph.nodes[2]?.attempts).toHaveLength(0);
  });
  it("aborts only the selected inflight child and fences late results while retaining uncertain spend", async () => {
    let begin!: () => void, finish!: () => void;
    const began = new Promise<void>((resolve) => {
      begin = resolve;
    });
    const late = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const uncertain: string[] = [];
    let observedSignal: AbortSignal | undefined;
    const f = await fixture({
      ownerBudget: {
        reserve: () => "cancelled-hold",
        completeReservation: () => {
          throw new Error("late result must not settle as success");
        },
        uncertainReservation: (id) => {
          uncertain.push(id);
        },
        releaseBeforeDispatch: () => {
          throw new Error("dispatched hold must remain counted");
        }
      },
      onCall: async (_request, signal) => {
        observedSignal = signal;
        begin();
        await late;
      }
    });
    let graph = arm(f, f.create());
    f.dag.advance();
    graph = f.dag.get(graph.id, owner)!;
    const workId = graph.nodes[0]!.attempts[0]!.work_id;
    const executing = f.coordinator.execute(workId, owner);
    await began;
    try {
      graph = f.dag.control(graph.id, owner, {
        version: graph.version,
        action: "cancel_step",
        node_id: "brief"
      });
      expect(observedSignal?.aborted).toBe(true);
      expect(f.store.get(workId, owner)?.status).toBe("cancelled");
      expect(() =>
        f.dag.archive(graph.id, owner, {
          expected_version: graph.version,
          archived: true
        })
      ).toThrow("PLAN_HAS_UNFINISHED_WORK");
      f.dag.advance();
      expect(f.dag.get(graph.id, owner)?.nodes[2]?.attempts).toHaveLength(0);
    } finally {
      finish();
      await executing;
    }
    expect(uncertain).toEqual(["cancelled-hold"]);
    expect(f.store.get(workId, owner)?.owner_budget_hold_id).toBe("cancelled-hold");
    expect(f.store.runtime.artifacts(f.project.id, owner)).toEqual([]);
    expect(f.dag.get(graph.id, owner)?.nodes[0]?.status).toBe("cancelled");
    await f.coordinator.execute(workId, owner);
    expect(f.calls).toHaveLength(1);
    graph = f.dag.archive(graph.id, owner, { expected_version: graph.version, archived: true });
    expect(graph.archived_at).toBeDefined();
    expect(f.store.get(workId, owner)?.owner_budget_hold_id).toBe("cancelled-hold");
    expect(f.store.get(workId, owner)?.inflight_run_id).toBeTruthy();
  });
  it("recovers canonical child cancellation if the graph checkpoint fails and does not schedule a replacement", async () => {
    const f = await fixture();
    let graph = arm(f, f.create());
    f.dag.advance();
    graph = f.dag.get(graph.id, owner)!;
    const workId = graph.nodes[0]!.attempts[0]!.work_id;
    f.db.sqlite.exec(
      "CREATE TRIGGER reject_step_cancel BEFORE INSERT ON work_dag_checkpoints BEGIN SELECT RAISE(ABORT, 'fixture_checkpoint_failure'); END"
    );
    expect(() =>
      f.dag.control(graph.id, owner, {
        version: graph.version,
        action: "cancel_step",
        node_id: "brief"
      })
    ).toThrow("fixture_checkpoint_failure");
    expect(f.store.get(workId, owner)?.status).toBe("cancelled");
    f.db.sqlite.exec("DROP TRIGGER reject_step_cancel");
    f.dag.advance();
    graph = f.dag.get(graph.id, owner)!;
    expect(graph.nodes[0]?.status).toBe("cancelled");
    expect(graph.execution?.status).toBe("failed");
    expect(graph.nodes[2]?.attempts).toHaveLength(0);
    expect(f.calls).toHaveLength(0);
  });
  it("protects step cancellation with owner scope, version, terminal/archive and privacy checks", async () => {
    const f = await fixture();
    let graph = await f.execute(f.create(), "independent");
    const app = buildApp({
      config: f.config,
      database: f.db,
      projectStore: f.projects,
      managerWorkStore: f.store,
      managerWorkCoordinator: f.coordinator
    });
    try {
      const url = `/api/v1/projects/${f.project.id}/work-dags/${graph.id}/control`;
      const cancel = (node_id: string, version = graph.version, path = url) =>
        app.inject({
          method: "POST",
          url: path,
          payload: { action: "cancel_step", version, node_id }
        });
      expect((await cancel("independent")).json()).toEqual({ error: "TERMINAL_STEP" });
      expect((await cancel("missing")).json()).toEqual({ error: "STEP_NOT_FOUND" });
      expect((await cancel("brief", 1)).json()).toEqual({ error: "STALE_DAG" });
      const foreign = f.projects.createProject("Foreign", "foreign", "foreign-owner").project;
      expect(
        (await cancel("brief", graph.version, url.replace(f.project.id, foreign.id))).statusCode
      ).toBe(404);
      expect(() =>
        f.dag.control(graph.id, "foreign-owner", {
          version: graph.version,
          action: "cancel_step",
          node_id: "brief"
        })
      ).toThrow("DAG_NOT_FOUND");
      graph = f.dag.archive(graph.id, owner, { expected_version: graph.version, archived: true });
      expect((await cancel("brief")).json()).toEqual({ error: "PLAN_ARCHIVED" });
      graph = f.dag.archive(graph.id, owner, { expected_version: graph.version, archived: false });
      f.db.sqlite
        .prepare("INSERT INTO work_owner_fences(owner_id, epoch, fenced) VALUES (?, 1, 1)")
        .run(owner);
      expect((await cancel("brief")).statusCode).toBe(409);
      expect(f.store.dag.get(graph.id, owner)?.nodes[0]?.status).toBe("pending");
    } finally {
      await app.close();
    }
  });
  it("retains unstarted cancellation on reopen and creates only fresh steps in an explicit copy", async () => {
    const directory = mkdtempSync(join(tmpdir(), "dag-step-cancel-"));
    cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
    const path = join(directory, "cancel.db");
    const f = await fixture({ path });
    let graph = f.create();
    graph = f.dag.control(graph.id, owner, {
      version: graph.version,
      action: "cancel_step",
      node_id: "brief"
    });
    f.close();
    const reopened = await fixture({ path });
    reopened.dag.recoverAutomation();
    reopened.dag.advance();
    expect(reopened.dag.get(graph.id, owner)?.nodes[0]?.status).toBe("cancelled");
    const copy = reopened.dag.clone(graph.project_id, graph.id, owner, owner, {
      client_request_id: "fresh-copy",
      expected_version: graph.version,
      title: "Fresh",
      skills: "source"
    });
    expect(copy.nodes.map((n) => n.status)).toEqual(["pending", "blocked", "pending"]);
    expect(copy.nodes.every((n) => !n.attempts.length)).toBe(true);
    expect(reopened.calls).toHaveLength(0);
  });
  it("renames a running plan with CAS without changing tasks, instructions or execution authorization", async () => {
    const f = await fixture();
    let graph = f.create();
    graph = f.dag.control(graph.id, owner, {
      version: graph.version,
      action: "run_plan",
      acknowledge_cost: true,
      max_model_requests: 9
    });
    const before = structuredClone(graph),
      snapshot = f.store.skills.forPlan(graph.id, owner);
    const app = buildApp({
      config: f.config,
      database: f.db,
      projectStore: f.projects,
      managerWorkStore: f.store,
      managerWorkCoordinator: f.coordinator
    });
    try {
      const url = `/api/v1/projects/${f.project.id}/work-dags/${graph.id}/title`;
      const put = (payload: unknown, path = url) =>
        app.inject({ method: "PUT", url: path, payload: payload as Record<string, unknown> });
      for (const title of ["   ", "x".repeat(161), 5])
        expect((await put({ expected_version: graph.version, title })).statusCode).toBe(400);
      expect(
        (await put({ expected_version: graph.version, title: "New", nodes: [] })).statusCode
      ).toBe(400);
      const foreign = f.projects.createProject("Foreign", "foreign", "foreign-owner").project;
      expect(
        (
          await put(
            { expected_version: graph.version, title: "New" },
            url.replace(f.project.id, foreign.id)
          )
        ).statusCode
      ).toBe(404);
      const renamed = await put({
        expected_version: graph.version,
        title: "<script>Новый план</script>"
      });
      expect(renamed.statusCode).toBe(200);
      graph = renamed.json<WorkDag>();
      expect(graph.title).toBe("<script>Новый план</script>");
      expect(graph.nodes).toEqual(before.nodes);
      expect(graph.execution).toEqual(before.execution);
      expect(f.store.skills.forPlan(graph.id, owner)).toEqual(snapshot);
      expect(
        (await put({ expected_version: before.version, title: "Stale overwrite" })).json()
      ).toEqual({ error: "STALE_DAG" });
      expect(
        (await put({ expected_version: graph.version, title: graph.title })).json<WorkDag>().version
      ).toBe(graph.version);
      graph = f.dag.control(graph.id, owner, { version: graph.version, action: "stop_plan" });
      graph = f.dag.archive(graph.id, owner, { expected_version: graph.version, archived: true });
      expect(
        (await put({ expected_version: graph.version, title: "Archived overwrite" })).json()
      ).toEqual({ error: "PLAN_ARCHIVED" });
      expect(f.calls).toHaveLength(0);
    } finally {
      await app.close();
    }
  });
  it("archives completed results, preserves snapshots and provenance, restores without spending", async () => {
    const f = await fixture();
    let graph = f.create();
    graph = await f.execute(graph, "brief");
    const original = f.dag.results(graph.id, owner);
    const snapshot = f.store.skills.forPlan(graph.id, owner);
    const beforeCalls = f.calls.length;
    graph = f.dag.archive(graph.id, owner, { expected_version: graph.version, archived: true });
    expect(graph.archived_at).toEqual(expect.any(String));
    expect(f.store.dag.active().map((g) => g.id)).not.toContain(graph.id);
    expect(f.dag.list(f.project.id, owner)).toHaveLength(1);
    expect(f.dag.results(graph.id, owner)).toEqual(original);
    expect(f.store.skills.forPlan(graph.id, owner)).toEqual(snapshot);
    expect(f.dag.package(graph.id, owner, f.project.id)).not.toHaveProperty("archived_at");
    const version = graph.version;
    f.dag.reconcileAll();
    f.dag.recoverAutomation();
    f.dag.advance();
    expect(f.dag.get(graph.id, owner)?.version).toBe(version);
    expect(f.calls).toHaveLength(beforeCalls);
    for (const action of [
      "run",
      "retry",
      "pause",
      "resume",
      "cancel",
      "run_plan",
      "approve_step"
    ] as const)
      expect(() =>
        f.dag.control(graph.id, owner, { version, action, node_id: "document" })
      ).toThrow("PLAN_ARCHIVED");
    expect(() => f.dag.edit(graph.id, owner, version, nodes)).toThrow("PLAN_ARCHIVED");
    const copy = f.dag.clone(f.project.id, graph.id, owner, owner, {
      client_request_id: "archived-copy",
      expected_version: version,
      title: "Copy",
      skills: "source"
    });
    expect(copy.archived_at).toBeUndefined();
    expect(copy.nodes.every((n) => !n.attempts.length)).toBe(true);
    graph = f.dag.archive(graph.id, owner, { expected_version: version, archived: false });
    expect(graph.archived_at).toBeUndefined();
    f.dag.advance();
    expect(f.calls).toHaveLength(beforeCalls);
    expect(f.dag.results(graph.id, owner)).toEqual(original);
    expect(graph.nodes[1]?.status).toBe("pending");
  });
  it("rejects armed automation and unfinished children even when paused", async () => {
    const f = await fixture();
    let graph = f.create();
    graph = f.dag.control(graph.id, owner, {
      version: graph.version,
      action: "run_plan",
      acknowledge_cost: true,
      max_model_requests: 9
    });
    expect(() =>
      f.dag.archive(graph.id, owner, { expected_version: graph.version, archived: true })
    ).toThrow("AUTO_PLAN_ACTIVE");
    graph = f.dag.control(graph.id, owner, { version: graph.version, action: "stop_plan" });
    graph = f.dag.control(graph.id, owner, {
      version: graph.version,
      action: "run",
      node_id: "brief"
    });
    expect(() =>
      f.dag.archive(graph.id, owner, { expected_version: graph.version, archived: true })
    ).toThrow("PLAN_HAS_UNFINISHED_WORK");
    graph = f.dag.control(graph.id, owner, { version: graph.version, action: "pause" });
    expect(() =>
      f.dag.archive(graph.id, owner, { expected_version: graph.version, archived: true })
    ).toThrow("PLAN_HAS_UNFINISHED_WORK");
    expect(f.store.dag.get(graph.id, owner)?.archived_at).toBeUndefined();
    expect(f.calls).toHaveLength(0);
  });
  it("keeps archived plans frozen across project controls and restores the current project mode without rearming", async () => {
    const f = await fixture();
    let graph = f.create();
    graph = f.dag.control(graph.id, owner, {
      version: graph.version,
      action: "run_plan",
      acknowledge_cost: true,
      max_model_requests: 9
    });
    graph = f.dag.control(graph.id, owner, { version: graph.version, action: "pause" });
    graph = f.dag.archive(graph.id, owner, { expected_version: graph.version, archived: true });
    const frozen = structuredClone(graph);
    let other = f.dag.create(f.project.id, owner, owner, {
      client_request_id: "other",
      title: "Other",
      nodes
    });
    other = f.dag.control(other.id, owner, { version: other.version, action: "resume" });
    f.dag.advance();
    expect(f.dag.get(graph.id, owner)).toEqual(frozen);
    graph = f.dag.archive(graph.id, owner, { expected_version: graph.version, archived: false });
    expect(graph.mode).toBe("active");
    expect(graph.execution).toMatchObject({ status: "stopped", reason: "RESTORED_REQUIRES_START" });
    f.dag.advance();
    expect(f.store.list(f.project.id, owner)).toEqual([]);
    graph = f.dag.archive(graph.id, owner, { expected_version: graph.version, archived: true });
    f.dag.control(other.id, owner, { version: other.version, action: "cancel" });
    graph = f.dag.archive(graph.id, owner, { expected_version: graph.version, archived: false });
    expect(graph.mode).toBe("cancelled");
    expect(graph.nodes.every((n) => n.status === "cancelled")).toBe(true);
    expect(f.calls).toHaveLength(0);
  });
  it("checks archive scope, strict payloads, stale versions and owner fences through HTTP", async () => {
    const f = await fixture();
    const graph = f.create();
    const app = buildApp({
      config: f.config,
      database: f.db,
      projectStore: f.projects,
      managerWorkStore: f.store,
      managerWorkCoordinator: f.coordinator
    });
    try {
      const url = `/api/v1/projects/${f.project.id}/work-dags/${graph.id}/archive`;
      const put = (payload: unknown, path = url) =>
        app.inject({ method: "PUT", url: path, payload: payload as Record<string, unknown> });
      expect(
        (await put({ expected_version: graph.version, archived: true, mode: "active" })).statusCode
      ).toBe(400);
      expect((await put({ expected_version: graph.version, archived: "true" })).statusCode).toBe(
        400
      );
      const foreign = f.projects.createProject("Foreign", "foreign", "foreign-owner").project;
      expect(
        (
          await put(
            { expected_version: graph.version, archived: true },
            url.replace(f.project.id, foreign.id)
          )
        ).statusCode
      ).toBe(404);
      expect(() =>
        f.dag.archive(graph.id, "foreign-owner", { expected_version: 1, archived: true })
      ).toThrow("DAG_NOT_FOUND");
      const archived = await put({ expected_version: graph.version, archived: true });
      expect(archived.statusCode).toBe(200);
      const version = archived.json<WorkDag>().version;
      expect((await put({ expected_version: graph.version, archived: false })).json()).toEqual({
        error: "STALE_DAG"
      });
      expect(
        (await put({ expected_version: version, archived: true })).json<WorkDag>().version
      ).toBe(version);
      f.db.sqlite
        .prepare(
          "INSERT INTO work_owner_fences(owner_id, epoch, fenced) VALUES (?, 1, 1) ON CONFLICT(owner_id) DO UPDATE SET fenced=1"
        )
        .run(owner);
      expect((await put({ expected_version: version, archived: false })).statusCode).toBe(409);
      expect(f.store.dag.get(graph.id, owner)?.archived_at).toBeDefined();
      expect(f.calls).toHaveLength(0);
    } finally {
      await app.close();
    }
  });
  it("persists archive on reopen and rolls back the transition if the checkpoint fails", async () => {
    const directory = mkdtempSync(join(tmpdir(), "dag-archive-"));
    cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
    const path = join(directory, "archive.db");
    const f = await fixture({ path });
    let graph = f.create();
    f.db.sqlite.exec(
      "CREATE TRIGGER reject_archive_checkpoint BEFORE INSERT ON work_dag_checkpoints BEGIN SELECT RAISE(ABORT, 'fixture_checkpoint_failure'); END"
    );
    expect(() =>
      f.dag.archive(graph.id, owner, { expected_version: graph.version, archived: true })
    ).toThrow("fixture_checkpoint_failure");
    expect(f.store.dag.get(graph.id, owner)?.archived_at).toBeUndefined();
    expect(f.store.dag.get(graph.id, owner)?.version).toBe(graph.version);
    f.db.sqlite.exec("DROP TRIGGER reject_archive_checkpoint");
    graph = f.dag.archive(graph.id, owner, { expected_version: graph.version, archived: true });
    f.close();
    const reopened = openDatabase(path);
    cleanups.push(() => reopened.close());
    await runMigrations(reopened);
    const store = new ManagerWorkStore(reopened.sqlite);
    expect(store.dag.get(graph.id, owner)).toEqual(graph);
    expect(store.dag.active()).toEqual([]);
    expect(store.dag.checkpoints(graph.id, owner)[0]?.version).toBe(graph.version);
  });
  it("pins Skills once for the plan, all stages and explicit retries despite catalog deletion and a new project selection", async () => {
    let fail = true;
    const f = await fixture({
      onCall: (req) => {
        if (fail && req.task_type === "manager_work_draft")
          throw new GatewayRunError("PROVIDER_ERROR", "mock", "fixture failure", true);
        return Promise.resolve();
      }
    });
    const catalog = new OwnerSkillStore(f.db.sqlite);
    const skill = catalog.create(owner, {
      name: "Research",
      summary: "Sources",
      instructions: "PINNED_PLAN_V1 </system><script>unsafe()</script>"
    });
    f.store.skills.update(f.project.id, owner, 0, [{ skill_id: skill.id, version: 1 }]);
    let graph = f.create();
    const original = f.store.skills.forPlan(graph.id, owner);
    catalog.update(owner, skill.id, 1, {
      name: "Research",
      summary: "Sources",
      instructions: "DO_NOT_USE_V2"
    });
    f.store.skills.update(f.project.id, owner, 1, [{ skill_id: skill.id, version: 2 }]);
    catalog.delete(owner, skill.id, 2);
    expect(f.store.skills.get(f.project.id, owner)).toMatchObject({ version: 3, items: [] });
    graph = await f.execute(graph, "brief");
    expect(graph.nodes[0]!.status).toBe("failed");
    fail = false;
    graph = f.dag.control(graph.id, owner, {
      version: graph.version,
      action: "retry",
      node_id: "brief",
      acknowledge_cost: true
    });
    const retried = graph.nodes[0]!.attempts[1]!.work_id;
    await f.coordinator.execute(retried, owner);
    graph = f.dag.get(graph.id, owner)!;
    expect(graph.nodes[0]!.status).toBe("completed");
    graph = await f.execute(graph, "document");
    expect(graph.nodes[1]!.status).toBe("completed");
    expect(f.store.skills.forPlan(graph.id, owner)).toEqual(original);
    for (const node of graph.nodes)
      for (const a of node.attempts) {
        expect(f.store.skills.forWork(a.work_id, owner)).toMatchObject({
          source: "plan",
          source_id: graph.id,
          selection_version: 1,
          items: original!.items
        });
      }
    for (const req of f.calls) {
      expect(req.messages[0]!.content).not.toContain("PINNED_PLAN_V1");
      const data = JSON.parse(req.messages[1]!.content) as {
        personal_skills: { instructions: string }[];
      };
      expect(data.personal_skills[0]!.instructions).toContain("PINNED_PLAN_V1");
      expect(req.messages[1]!.content).not.toContain("DO_NOT_USE_V2");
      expect(req).not.toHaveProperty("tools");
    }
    const later = f.store.create(f.project.id, owner, owner, {
      client_request_id: "new-empty",
      goal: "new",
      worker_role: "analyst",
      max_model_requests: 3,
      max_input_tokens: 32000,
      max_output_tokens: 6000
    })!;
    expect(f.store.skills.forWork(later.id, owner)?.items).toEqual([]);
    expect(f.create().id).toBe(graph.id);
    expect(f.calls).toHaveLength(6);
  });

  const arm = (f: Awaited<ReturnType<typeof fixture>>, graph: WorkDag, limit = 9) =>
    f.dag.control(graph.id, owner, {
      version: f.dag.get(graph.id, owner)!.version,
      action: "run_plan",
      acknowledge_cost: true,
      max_model_requests: limit
    });
  async function autoTick(f: Awaited<ReturnType<typeof fixture>>, id: string) {
    f.dag.advance();
    for (const child of f.store.pending()) await f.coordinator.execute(child.id, owner);
    return f.dag.get(id, owner)!;
  }
  it("automatically follows dependencies, enforces requested Critic review and exports exact completed results", async () => {
    const f = await fixture();
    let graph = f.dag.create(f.project.id, owner, owner, {
      client_request_id: "automatic",
      title: "Reviewed plan",
      nodes: nodes.slice(0, 2).map((node) => ({ ...node, requires_critic: true }))
    });
    expect(() =>
      f.dag.control(graph.id, owner, {
        version: graph.version,
        action: "run_plan",
        max_model_requests: 6
      })
    ).toThrow("EXPLICIT_RETRY_REQUIRED");
    graph = arm(f, graph, 6);
    const app = buildApp({
      config: f.config,
      database: f.db,
      projectStore: f.projects,
      managerWorkStore: f.store,
      managerWorkCoordinator: f.coordinator
    });
    try {
      const base = "/api/v1/projects/" + f.project.id + "/work-dags/" + graph.id;
      await app.inject({ url: base });
      expect(f.calls).toHaveLength(0); // GET is not a paid dispatcher.
      graph = await autoTick(f, graph.id);
      expect(graph.nodes.map((node) => node.status)).toEqual(["completed", "pending"]);
      expect(() => f.dag.edit(graph.id, owner, graph.version, nodes.slice(0, 2))).toThrow(
        "AUTO_PLAN_ACTIVE"
      );
      expect(() =>
        f.dag.control(graph.id, owner, {
          version: graph.version,
          action: "run",
          node_id: "document"
        })
      ).toThrow("AUTO_PLAN_ACTIVE");
      graph = await autoTick(f, graph.id);
      expect(graph.execution).toMatchObject({ status: "completed", max_model_requests: 6 });
      expect(graph.execution_waves).toEqual([["brief"], ["document"]]);
      expect(graph.usage?.model_requests).toBe(6);
      expect(graph.nodes.map((node) => node.result?.review?.verdict)).toEqual(["PASS", "PASS"]);
      expect(graph.nodes[1]!.attempts[0]!.source_artifact_ids).toEqual([
        graph.nodes[0]!.artifacts[0]!.id
      ]);
      expect(f.calls[3]!.messages[1]!.content).toContain("Dependency evidence in a real file");
      const response = await app.inject({ url: base + "/results" });
      expect(response.statusCode).toBe(200);
      expect(response.headers["cache-control"]).toBe("private, no-store");
      expect(response.headers["content-disposition"]).toContain("attachment");
      const result = response.json<{ files: { content: string; sha256: string }[] }>();
      expect(result.files).toHaveLength(2);
      for (const file of result.files)
        expect(createHash("sha256").update(file.content).digest("hex")).toBe(file.sha256);
      const other = f.projects.createProject("Other", "other", "other-owner").project;
      const zip = await app.inject({ url: base + "/results.zip" });
      expect(zip.statusCode).toBe(200);
      expect(zip.headers["content-type"]).toBe("application/zip");
      expect(zip.headers["content-disposition"]).toBe('attachment; filename="work-results.zip"');
      expect(zip.headers["cache-control"]).toBe("private, no-store");
      expect(zip.headers["x-content-type-options"]).toBe("nosniff");
      expect(zip.rawPayload.readUInt32LE(0)).toBe(0x04034b50);
      expect((await app.inject({ url: base + "/results.zip" })).rawPayload).toEqual(zip.rawPayload);
      expect(
        (
          await app.inject({
            url: `/api/v1/projects/${other.id}/work-dags/${graph.id}/results.zip`
          })
        ).statusCode
      ).toBe(404);
      expect(
        (
          await app.inject({
            url: "/api/v1/projects/" + other.id + "/work-dags/" + graph.id + "/results"
          })
        ).statusCode
      ).toBe(404);
      await autoTick(f, graph.id);
      expect(f.calls).toHaveLength(6);
      f.db.sqlite
        .prepare("UPDATE work_artifact_versions SET content = 'corrupt' WHERE id = ?")
        .run(graph.nodes[0]!.artifacts[0]!.id);
      expect((await app.inject({ url: base + "/results" })).statusCode).toBe(409);
      const brokenZip = await app.inject({ url: base + "/results.zip" });
      expect(brokenZip.statusCode).toBe(409);
      expect(brokenZip.headers["content-type"]).toContain("application/json");
      expect(brokenZip.json()).toEqual({ error: "DEPENDENCY_ARTIFACT_MISSING" });
    } finally {
      await app.close();
    }
  });
  it("stops before a new child exceeds the total budget and counts earlier attempts after explicit continuation", async () => {
    const f = await fixture();
    let graph = arm(f, f.create(), 3);
    graph = await autoTick(f, graph.id);
    graph = await autoTick(f, graph.id);
    expect(graph.execution).toMatchObject({ status: "stopped", reason: "PLAN_REQUEST_LIMIT" });
    expect(f.calls).toHaveLength(2);
    expect(graph.nodes.flatMap((node) => node.attempts)).toHaveLength(1);
    expect(() => arm(f, graph, 3)).toThrow("PLAN_REQUEST_LIMIT");
    graph = arm(f, graph, 9);
    graph = await autoTick(f, graph.id);
    graph = await autoTick(f, graph.id);
    expect(graph.execution?.status).toBe("completed");
    expect(graph.usage?.model_requests).toBe(6);
    expect(graph.nodes.map((node) => node.attempts.length)).toEqual([1, 1, 1]);
  });
  it("never retries a failed model step or starts an independent step behind it", async () => {
    let fail = true;
    const f = await fixture({
      onCall: () => {
        if (fail) throw new GatewayRunError("PROVIDER_ERROR", "mock", "fixture", true);
        return Promise.resolve();
      }
    });
    let graph = arm(f, f.create());
    graph = await autoTick(f, graph.id);
    for (let i = 0; i < 4; i++) graph = await autoTick(f, graph.id);
    expect(graph.execution).toMatchObject({ status: "failed", reason: "STEP_FAILED" });
    expect(f.calls).toHaveLength(1);
    expect(graph.nodes[2]!.attempts).toHaveLength(0);
    fail = false;
    graph = f.dag.control(graph.id, owner, {
      version: graph.version,
      action: "retry",
      node_id: "brief",
      acknowledge_cost: true
    });
    await f.coordinator.execute(graph.nodes[0]!.attempts[1]!.work_id, owner);
    graph = arm(f, f.dag.get(graph.id, owner)!);
    graph = await autoTick(f, graph.id);
    graph = await autoTick(f, graph.id);
    expect(graph.execution?.status).toBe("completed");
    expect(graph.usage?.model_requests).toBe(7);
    expect(graph.nodes.map((node) => node.attempts.length)).toEqual([2, 1, 1]);
  });
  it("waits for explicit complex-plan approval without repeating planning or waiving Critic", async () => {
    const f = await fixture({
      output: (request) =>
        request.task_type === "manager_work_plan"
          ? {
              summary: "Review required",
              instructions: "Create result.md",
              complexity: "complex",
              needs_critic: false,
              requires_external_actions: false
            }
          : undefined
    });
    let graph = arm(f, f.create());
    graph = await autoTick(f, graph.id);
    graph = await autoTick(f, graph.id);
    expect(graph.execution).toMatchObject({ status: "waiting", reason: "AWAITING_APPROVAL" });
    expect(f.calls).toHaveLength(1);
    graph = f.dag.control(graph.id, owner, {
      version: graph.version,
      action: "approve_step",
      node_id: "brief"
    });
    await f.coordinator.execute(graph.nodes[0]!.attempts[0]!.work_id, owner);
    graph = f.dag.get(graph.id, owner)!;
    expect(graph.nodes[0]!.result?.review?.verdict).toBe("PASS");
    expect(f.calls.map((request) => request.task_type)).toEqual([
      "manager_work_plan",
      "manager_work_draft",
      "manager_work_review"
    ]);
  });
  it("stops autostart, respects project pause/cancel and preserves files", async () => {
    const f = await fixture();
    let graph = arm(f, f.create());
    graph = f.dag.control(graph.id, owner, { version: graph.version, action: "stop_plan" });
    graph = await autoTick(f, graph.id);
    expect(f.calls).toHaveLength(0);
    graph = arm(f, graph);
    graph = f.dag.control(graph.id, owner, { version: graph.version, action: "pause" });
    graph = await autoTick(f, graph.id);
    expect(f.calls).toHaveLength(0);
    graph = f.dag.control(graph.id, owner, { version: graph.version, action: "resume" });
    graph = await autoTick(f, graph.id);
    const artifact = graph.nodes[0]!.artifacts[0]!;
    graph = f.dag.control(graph.id, owner, { version: graph.version, action: "cancel" });
    graph = await autoTick(f, graph.id);
    expect(graph.execution).toMatchObject({ status: "stopped", reason: "PROJECT_CANCELLED" });
    expect(f.calls).toHaveLength(2);
    expect(f.store.runtime.artifact(f.project.id, owner, artifact.id)?.metadata.sha256).toBe(
      artifact.sha256
    );
  });
  it("requires explicit continuation after restart and never repeats a completed step", async () => {
    const f = await fixture();
    let graph = await autoTick(f, arm(f, f.create()).id);
    const completed = graph.nodes[0]!.attempts[0]!.work_id;
    const restarted = new ManagerWorkCoordinator(f.deps);
    restarted.dag.recoverAutomation();
    restarted.dag.advance();
    graph = restarted.dag.get(graph.id, owner)!;
    expect(graph.execution).toMatchObject({ status: "paused", reason: "RESTART_REQUIRES_RESUME" });
    expect(f.calls).toHaveLength(2);
    graph = restarted.dag.control(graph.id, owner, {
      version: graph.version,
      action: "run_plan",
      max_model_requests: 9,
      acknowledge_cost: true
    });
    restarted.dag.advance();
    for (const child of f.store.pending()) await restarted.execute(child.id, owner);
    expect(f.calls).toHaveLength(4);
    expect(restarted.dag.get(graph.id, owner)!.nodes[0]!.attempts[0]!.work_id).toBe(completed);
  });
  it("invalidates autostart consent when an unstarted goal is edited while paused", async () => {
    const f = await fixture();
    let graph = arm(f, f.create());
    graph = f.dag.control(graph.id, owner, { version: graph.version, action: "pause" });
    graph = f.dag.edit(
      graph.id,
      owner,
      graph.version,
      nodes.map((node) => ({ ...node, goal: node.goal + " updated" }))
    );
    graph = f.dag.control(graph.id, owner, { version: graph.version, action: "resume" });
    graph = await autoTick(f, graph.id);
    expect(graph.execution).toMatchObject({ status: "stopped", reason: "PLAN_EDITED" });
    expect(f.calls).toHaveLength(0);
    graph = await autoTick(f, arm(f, graph).id);
    expect(graph.nodes[0]!.status).toBe("completed");
  });
  it("requires a clear emergency/privacy gate before arming and before scheduling", async () => {
    const f = await fixture();
    let graph = f.create();
    f.deps.emergency.activateProcess("test stop");
    expect(() => arm(f, graph)).toThrow("EMERGENCY_STOP");
    expect(f.calls).toHaveLength(0);
    const fresh = await fixture();
    graph = arm(fresh, fresh.create());
    const token = await fresh.coordinator.quiesce(owner);
    fresh.dag.advance();
    fresh.coordinator.releaseQuiescence(token);
    graph = fresh.dag.get(graph.id, owner)!;
    expect(graph.execution).toMatchObject({ status: "paused", reason: "OWNER_QUIESCED" });
    fresh.dag.advance();
    expect(fresh.calls).toHaveLength(0);
  });
  it("detects cycles/missing nodes before creating a work or spending, and keeps HTTP scope", async () => {
    const f = await fixture();
    const app = buildApp({
      config: f.config,
      database: f.db,
      projectStore: f.projects,
      managerWorkStore: f.store,
      managerWorkCoordinator: f.coordinator
    });
    try {
      const base = "/api/v1/projects/" + f.project.id + "/work-dags";
      const bad = await app.inject({
        method: "POST",
        url: base,
        payload: {
          client_request_id: "cyclic",
          title: "Cycle",
          nodes: [nodes[0], { ...nodes[1]!, depends_on: ["document"] }]
        }
      });
      expect(bad.statusCode).toBe(409);
      expect(bad.json()).toEqual({ error: "DAG_CYCLE" });
      expect(f.store.list(f.project.id, owner)).toEqual([]);
      expect(f.calls).toEqual([]);
      expect(() =>
        f.dag.create(f.project.id, owner, owner, {
          client_request_id: "missing",
          title: "Missing",
          nodes: [{ ...nodes[0]!, depends_on: ["absent"] }]
        })
      ).toThrow("DAG_DEPENDENCY_MISSING");
      const good = await app.inject({
        method: "POST",
        url: base,
        payload: { client_request_id: "valid", title: "Plan", nodes }
      });
      expect(good.statusCode).toBe(201);
      const g = good.json<WorkDag>();
      expect((await app.inject({ url: base + "/" + g.id + "/checkpoints" })).json()).toMatchObject({
        items: [{ version: 1 }]
      });
      const other = f.projects.createProject("Other", "other", "other-owner").project;
      expect(
        (await app.inject({ url: "/api/v1/projects/" + other.id + "/work-dags/" + g.id }))
          .statusCode
      ).toBe(404);
      expect(
        (
          await app.inject({
            method: "POST",
            url: base + "/" + g.id + "/control",
            payload: { version: 1, action: "run", node_id: "document" }
          })
        ).statusCode
      ).toBe(409);
      const launched = await app.inject({
        method: "POST",
        url: base + "/" + g.id + "/control",
        payload: { version: 1, action: "run", node_id: "brief" }
      });
      expect(launched.statusCode).toBe(200);
      const work = launched.json<WorkDag>().nodes[0]!.attempts[0]!.work_id;
      await f.coordinator.execute(work, owner);
      const completed = (await app.inject({ url: base + "/" + g.id })).json<WorkDag>();
      const artifact = completed.nodes[0]!.artifacts[0]!;
      const download = await app.inject({
        url: "/api/v1/projects/" + f.project.id + "/work-artifacts/" + artifact.id + "/download"
      });
      expect(download.statusCode).toBe(200);
      expect(download.body).toContain("Dependency evidence");
    } finally {
      await app.close();
    }
  });

  it("edits unstarted steps, excludes started changes, passes real versioned dependency evidence", async () => {
    const f = await fixture();
    let g = f.create();
    expect(g.nodes[1]).toMatchObject({ status: "blocked", blocked_reason: "DEPENDENCIES:brief" });
    g = f.dag.edit(
      g.id,
      owner,
      g.version,
      nodes.map((n) => (n.id === "document" ? { ...n, goal: "Use exact evidence" } : n))
    );
    expect(() => f.dag.edit(g.id, owner, 1, nodes)).toThrow("STALE_DAG");
    g = await f.execute(g, "brief");
    expect(g.nodes.map((n) => n.status)).toEqual(["completed", "pending", "pending"]);
    expect(() =>
      f.dag.edit(
        g.id,
        owner,
        g.version,
        nodes.map((n) => (n.id === "brief" ? { ...n, title: "Changed started" } : n))
      )
    ).toThrow("STEP_ALREADY_STARTED");
    g = await f.execute(g, "document");
    const a = g.nodes[0]!.artifacts[0]!,
      b = g.nodes[1]!.artifacts[0]!;
    expect(a.version).toBe(1);
    expect(b.version).toBe(2);
    expect(b.work_id).not.toBe(a.work_id);
    expect(a.sha256).toHaveLength(64);
    expect(g.nodes[1]!.attempts[0]!.source_artifact_ids).toEqual([a.id]);
    expect(f.calls[2]!.messages[1]!.content).toContain("Dependency evidence in a real file");
    expect(g.nodes[1]!.result?.sources).toHaveLength(2);
    expect(g.nodes[1]!.result?.sources[0]).toMatchObject({
      provider: "mock",
      model: "manager-b0.1"
    });
    expect(() =>
      f.dag.control(g.id, owner, { version: g.version, action: "run", node_id: "brief" })
    ).toThrow("STEP_NOT_READY");
    expect(f.calls).toHaveLength(4);
  });

  it("never retries automatically; only a selected failed step gets a new bounded attempt", async () => {
    let fail = true;
    const f = await fixture({
      onCall: (r) => {
        const goal = JSON.parse(r.messages[1]!.content) as { goal: string };
        if (goal.goal === nodes[0]!.goal && fail)
          throw new GatewayRunError("PROVIDER_ERROR", "mock", "fixture failure", true);
        return Promise.resolve();
      }
    });
    let g = f.create();
    g = await f.execute(g, "independent");
    const successfulId = g.nodes[2]!.attempts[0]!.work_id;
    g = await f.execute(g, "brief");
    expect(g.nodes[0]!.status).toBe("failed");
    expect(g.nodes[1]!.status).toBe("blocked");
    expect(f.calls).toHaveLength(3);
    f.dag.reconcileAll();
    expect(f.calls).toHaveLength(3);
    expect(() =>
      f.dag.control(g.id, owner, { version: g.version, action: "retry", node_id: "brief" })
    ).toThrow("EXPLICIT_RETRY_REQUIRED");
    expect(() =>
      f.dag.control(g.id, owner, {
        version: g.version,
        action: "retry",
        node_id: "independent",
        acknowledge_cost: true
      })
    ).toThrow("EXPLICIT_RETRY_REQUIRED");
    fail = false;
    g = f.dag.control(g.id, owner, {
      version: g.version,
      action: "retry",
      node_id: "brief",
      acknowledge_cost: true
    });
    await f.coordinator.execute(g.nodes[0]!.attempts[1]!.work_id, owner);
    g = f.dag.get(g.id, owner)!;
    expect(g.nodes[0]!.status).toBe("completed");
    expect(g.nodes[0]!.attempts).toHaveLength(2);
    expect(g.nodes[2]!.attempts[0]!.work_id).toBe(successfulId);
    expect(g.nodes[2]!.attempts).toHaveLength(1);
    expect(f.calls).toHaveLength(5);
  });

  it("persists project pause/cancel and resumes at a completed stage boundary", async () => {
    let pause = () => undefined;
    const f = await fixture({
      onCall: () => {
        pause();
        return Promise.resolve();
      }
    });
    let g = f.create();
    pause = () => {
      const latest = f.dag.get(g.id, owner)!;
      f.dag.control(g.id, owner, { version: latest.version, action: "pause" });
      pause = () => undefined;
    };
    g = await f.execute(g, "brief");
    expect(g.mode).toBe("paused");
    expect(g.nodes[0]).toMatchObject({ status: "blocked", blocked_reason: "PAUSED" });
    expect(f.calls).toHaveLength(1);
    expect(f.create().id).toBe(g.id); // request replay remains idempotent
    g = f.dag.control(g.id, owner, { version: g.version, action: "resume" });
    await f.coordinator.execute(g.nodes[0]!.attempts[0]!.work_id, owner);
    g = f.dag.get(g.id, owner)!;
    expect(f.calls).toHaveLength(2);
    expect(g.nodes[0]!.status).toBe("completed");
    g = f.dag.control(g.id, owner, { version: g.version, action: "cancel" });
    expect(g.nodes.map((n) => n.status)).toEqual(["completed", "cancelled", "cancelled"]);
    expect(f.store.dag.projectMode(f.project.id, owner)).toBe("cancelled");
    expect(() => f.dag.control(g.id, owner, { version: g.version, action: "resume" })).toThrow(
      "PROJECT_CANCELLED"
    );
  });

  it("reopens a disk graph without reissuing completed actions and requires explicit uncertain retry", async () => {
    const directory = mkdtempSync(join(tmpdir(), "kosmora-dag-"));
    cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
    const f = await fixture({ path: join(directory, "dag.db") });
    let g = await f.execute(f.create(), "brief");
    g = f.dag.control(g.id, owner, { version: g.version, action: "run", node_id: "document" });
    const interrupted = f.store.get(g.nodes[1]!.attempts[0]!.work_id, owner)!;
    f.store.save({ ...interrupted, status: "running", inflight_run_id: "uncertain-provider" });
    f.close();
    const reopened = openDatabase(join(directory, "dag.db"));
    cleanups.push(() => reopened.close());
    await runMigrations(reopened);
    const store = new ManagerWorkStore(reopened.sqlite);
    const coordinator = new ManagerWorkCoordinator({
      ...f.deps,
      store,
      projects: new ProjectStore(reopened.sqlite),
      policy: new PolicyStore(reopened.sqlite),
      emergency: new EmergencyStopStore(reopened.sqlite),
      ownerBudget: new AccountStore(reopened.sqlite)
    });
    store.recover();
    coordinator.dag.reconcileAll();
    g = coordinator.dag.get(g.id, owner)!;
    expect(g.nodes[0]!.status).toBe("completed");
    expect(g.nodes[1]).toMatchObject({ status: "failed", blocked_reason: "RECOVERY_REQUIRED" });
    await coordinator.execute(interrupted.id, owner);
    expect(f.calls).toHaveLength(2);
    g = coordinator.dag.control(g.id, owner, {
      version: g.version,
      action: "retry",
      node_id: "document",
      acknowledge_cost: true
    });
    await coordinator.execute(g.nodes[1]!.attempts[1]!.work_id, owner);
    expect(coordinator.dag.get(g.id, owner)!.nodes[1]!.status).toBe("completed");
    expect(f.calls).toHaveLength(4);
  });

  it("keeps a crash-before-binding child dormant, even during a project resume", async () => {
    const f = await fixture();
    let g = f.create();
    const orphan = f.store.create(
      f.project.id,
      owner,
      owner,
      {
        client_request_id: "orphan",
        goal: "Orphan",
        worker_role: "analyst",
        max_model_requests: 3,
        max_input_tokens: 32000,
        max_output_tokens: 6000
      },
      true,
      { graph_id: g.id, node_id: "brief", attempt: 1, bound: false }
    )!;
    g = f.dag.control(g.id, owner, { version: g.version, action: "pause" });
    f.dag.control(g.id, owner, { version: g.version, action: "resume" });
    expect(f.store.get(orphan.id, owner)!.status).toBe("paused");
    expect(() => f.coordinator.control(orphan.id, owner, orphan.version, "resume")).toThrow(
      "DAG_NOT_BOUND"
    );
    await f.coordinator.execute(orphan.id, owner);
    expect(f.calls).toHaveLength(0);
  });

  it("reserves owner budget before dispatch and reconciles only after canonical usage is committed", async () => {
    const holds = new Map<string, string>(),
      reconciled: string[] = [];
    const budget: WorkOwnerBudget = {
      reserve: (o, run, attempt, max, kind, chat, provider, model) => {
        expect(o).toBe(owner);
        expect(attempt).toBeGreaterThanOrEqual(0);
        expect(max).toBeGreaterThan(100);
        expect(kind).toBe("main");
        expect(chat).toBe(f.project.id);
        expect(provider).toBe("mock");
        expect(model).toBe("manager-b0.1");
        const id = "hold-" + run;
        holds.set(id, run);
        return id;
      },
      completeReservation: (id, kind, input, output) => {
        expect(kind).toBe("main");
        expect(input).toBe(100);
        expect(output).toBe(80);
        expect(f.projects.getRun(holds.get(id)!, owner)?.status).toBe("succeeded");
        holds.delete(id);
        reconciled.push(id);
      },
      uncertainReservation: () => {
        throw new Error("unexpected uncertainty");
      },
      releaseBeforeDispatch: () => {
        throw new Error("unexpected local release");
      }
    };
    const f = await fixture({
      ownerBudget: budget,
      onCall: () => {
        expect(holds.size).toBe(1);
        return Promise.resolve();
      }
    });
    const g = await f.execute(f.create(), "brief");
    expect(g.nodes[0]!.status).toBe("completed");
    expect(reconciled).toHaveLength(2);
    expect(holds.size).toBe(0);
    expect(f.store.holds()).toEqual([]);
  });

  it("stops before dispatch when owner reservation is refused", async () => {
    const f = await fixture({
      ownerBudget: {
        reserve: () => {
          throw new Error("quota");
        },
        completeReservation: () => undefined,
        uncertainReservation: () => undefined,
        releaseBeforeDispatch: () => undefined
      }
    });
    const g = await f.execute(f.create(), "brief");
    expect(f.calls).toHaveLength(0);
    expect(g.nodes[0]).toMatchObject({ status: "failed", blocked_reason: "OWNER_BUDGET_REFUSED" });
  });

  it("global privacy snapshots freeze writes, terminally reconcile only after release and require explicit retry", async () => {
    let begin!: () => void, finish!: () => void;
    const began = new Promise<void>((resolve) => {
      begin = resolve;
    });
    const late = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const f = await fixture({
      onCall: async () => {
        begin();
        await late;
      }
    });
    let graph = f.create();
    graph = f.dag.control(graph.id, owner, {
      version: graph.version,
      action: "run",
      node_id: "brief"
    });
    const workId = graph.nodes[0]!.attempts[0]!.work_id;
    const executing = f.coordinator.execute(workId, owner).catch(() => undefined);
    await began;
    const before = f.store.runtime.checkpoints(f.project.id, owner, workId).length;
    const at = new Date().toISOString();
    f.db.sqlite
      .prepare(
        "INSERT INTO kosmora_owner_data_lifecycle(owner_id,epoch,state,operation_id,started_at,updated_at) VALUES (?,1,'quiescing','snapshot',?,?)"
      )
      .run(owner, at, at);
    const drain = f.coordinator.quiesceOwner(owner);
    expect(() => f.store.save(f.store.get(workId, owner)!)).toThrow("OWNER_QUIESCED");
    expect(() =>
      f.dag.create(f.project.id, owner, owner, { client_request_id: "late", title: "Late", nodes })
    ).toThrow("OWNER_QUIESCED");
    expect(() => f.coordinator.resumeOwner(owner)).toThrow("OWNER_NOT_SETTLED");
    finish();
    await drain;
    await executing;
    expect(f.store.get(workId, owner)!.status).toBe("running");
    expect(f.store.runtime.checkpoints(f.project.id, owner, workId)).toHaveLength(before);
    expect(() => f.coordinator.resumeOwner(owner)).toThrow("OWNER_DATA_FENCED");
    f.db.sqlite
      .prepare(
        "UPDATE kosmora_owner_data_lifecycle SET state='active' WHERE owner_id=? AND epoch=1"
      )
      .run(owner);
    f.coordinator.resumeOwner(owner);
    expect(f.store.get(workId, owner)).toMatchObject({
      status: "failed",
      error_code: "OWNER_PRIVACY_INTERRUPTED"
    });
    expect(f.store.runtime.checkpoints(f.project.id, owner, workId)).toHaveLength(before + 1);
    expect(f.store.pending()).toEqual([]);
    await f.coordinator.execute(workId, owner);
    expect(f.calls).toHaveLength(1);
    expect(
      f.db.sqlite.prepare("SELECT status FROM kosmora_usage_holds WHERE owner_id=?").get(owner)
    ).toMatchObject({ status: "uncertain" });
    graph = await f.execute(graph, "independent");
    expect(graph.nodes.find((node) => node.id === "independent")?.status).toBe("completed");
    expect(f.calls).toHaveLength(3);
    graph = f.dag.control(graph.id, owner, {
      version: graph.version,
      action: "retry",
      node_id: "brief",
      acknowledge_cost: true
    });
    await f.coordinator.execute(graph.nodes[0]!.attempts.at(-1)!.work_id, owner);
    expect(f.dag.get(graph.id, owner)!.nodes[0]!.status).toBe("completed");
    expect(f.calls).toHaveLength(5);
  });

  it("quiesce drains even a late provider, retains uncertain holds and fences every late write", async () => {
    let begin!: () => void, finish!: () => void;
    const began = new Promise<void>((resolve) => {
      begin = resolve;
    });
    const late = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const uncertain: string[] = [];
    const f = await fixture({
      ownerBudget: {
        reserve: () => "uncertain-hold",
        completeReservation: () => {
          throw new Error("must not release uncertain hold");
        },
        uncertainReservation: (id) => {
          uncertain.push(id);
        },
        releaseBeforeDispatch: () => {
          throw new Error("dispatched uncertainty must remain counted");
        }
      },
      onCall: async () => {
        begin();
        await late;
      }
    });
    let g = f.create();
    g = f.dag.control(g.id, owner, { version: g.version, action: "run", node_id: "brief" });
    const workId = g.nodes[0]!.attempts[0]!.work_id;
    const executing = f.coordinator.execute(workId, owner);
    await began;
    let settled = false;
    const drain = f.coordinator.quiesce(owner).then((token) => {
      settled = true;
      return token;
    });
    expect(() => f.store.save(f.store.get(workId, owner)!)).toThrow("OWNER_QUIESCED");
    expect(() => f.store.dag.save(g, "Late write")).toThrow("OWNER_QUIESCED");
    expect(settled).toBe(false);
    expect(() =>
      f.coordinator.releaseQuiescence({ owner_id: owner, epoch: 1, settled: true })
    ).toThrow("OWNER_NOT_SETTLED");
    finish();
    const token = await drain;
    await executing;
    expect(token).toMatchObject({ owner_id: owner, settled: true });
    expect(uncertain).toEqual(["uncertain-hold"]);
    expect(f.store.get(workId, owner)!.status).toBe("cancelled");
    expect(f.store.runtime.artifacts(f.project.id, owner)).toEqual([]);
    const checkpointCount = f.store.runtime.checkpoints(f.project.id, owner, workId).length;
    await f.coordinator.execute(workId, owner).catch(() => undefined);
    expect(f.store.runtime.checkpoints(f.project.id, owner, workId)).toHaveLength(checkpointCount);
    expect(f.dag.get(g.id, owner)!.mode).toBe("paused");
    f.coordinator.releaseQuiescence(token);
    expect(() => f.coordinator.releaseQuiescence(token)).toThrow("OWNER_NOT_SETTLED");
    expect(
      f.dag.create(f.project.id, owner, owner, {
        client_request_id: "after-export",
        title: "Fresh plan",
        nodes
      }).mode
    ).toBe("active");
  });
  it("keeps Manager approval explicit and resumes without repeating its plan", async () => {
    const f = await fixture({
      output: (request) =>
        request.task_type === "manager_work_plan"
          ? {
              summary: "Risky plan",
              instructions: "Create file",
              complexity: "complex",
              needs_critic: true,
              requires_external_actions: false
            }
          : request.task_type === "manager_work_review"
            ? { verdict: "PASS", reason: "Verified contents" }
            : { files: [{ name: "result.md", content: "Complete file" }] }
    });
    let g = await f.execute(f.create(), "brief");
    expect(g.nodes[0]).toMatchObject({ status: "blocked", blocked_reason: "AWAITING_APPROVAL" });
    expect(g.nodes[0]!.result?.plan_summary).toBe("Risky plan");
    expect(f.calls).toHaveLength(1);
    g = f.dag.control(g.id, owner, {
      version: g.version,
      action: "approve_step",
      node_id: "brief"
    });
    await f.coordinator.execute(g.nodes[0]!.attempts[0]!.work_id, owner);
    g = f.dag.get(g.id, owner)!;
    expect(g.nodes[0]!.status).toBe("completed");
    expect(g.nodes[0]!.result?.review?.verdict).toBe("PASS");
    expect(f.calls).toHaveLength(3);
  });

  it("does not silently truncate dependency files beyond the bounded context", async () => {
    const f = await fixture({
      output: (request) =>
        request.task_type === "manager_work_draft"
          ? { files: [{ name: "result.md", content: "x".repeat(25000) }] }
          : undefined
    });
    const g = await f.execute(f.create(), "brief");
    expect(() =>
      f.dag.control(g.id, owner, { version: g.version, action: "run", node_id: "document" })
    ).toThrow("DEPENDENCY_CONTEXT_LIMIT");
    expect(f.calls).toHaveLength(2);
    expect(g.nodes[1]!.attempts).toHaveLength(0);
  });

  it("executes only one action at a time and leaves another ready launch queued", async () => {
    let begin!: () => void, finish!: () => void;
    const began = new Promise<void>((resolve) => {
      begin = resolve;
    });
    const late = new Promise<void>((resolve) => {
      finish = resolve;
    });
    let first = true;
    const f = await fixture({
      onCall: async () => {
        if (first) {
          first = false;
          begin();
          await late;
        }
      }
    });
    let g = f.create();
    g = f.dag.control(g.id, owner, { version: g.version, action: "run", node_id: "brief" });
    const a = g.nodes[0]!.attempts[0]!.work_id;
    g = f.dag.control(g.id, owner, { version: g.version, action: "run", node_id: "independent" });
    const b = g.nodes[2]!.attempts[0]!.work_id;
    const executing = f.coordinator.execute(a, owner);
    await began;
    await f.coordinator.execute(b, owner);
    expect(f.calls).toHaveLength(1);
    expect(f.store.get(b, owner)!.status).toBe("queued");
    finish();
    await executing;
    await f.coordinator.execute(b, owner);
    expect(f.calls).toHaveLength(4);
    expect(f.dag.get(g.id, owner)!.nodes[2]!.status).toBe("completed");
  });
  it("recovers publication committed before the final status without invoking actions again", async () => {
    const f = await fixture();
    let g = f.create();
    g = f.dag.control(g.id, owner, { version: g.version, action: "run", node_id: "brief" });
    const work = f.store.get(g.nodes[0]!.attempts[0]!.work_id, owner)!;
    const draft = { files: [{ name: "result.md", content: "Already published" }] };
    const running = f.store.save({
      ...work,
      status: "running",
      stage: "publish",
      draft,
      plan: {
        summary: "Plan",
        instructions: "Save file",
        complexity: "simple",
        needs_critic: false,
        requires_external_actions: false
      }
    });
    f.store.publish(running.id, owner, draft);
    expect(f.store.recover()).toBe(1);
    g = f.dag.get(g.id, owner)!;
    expect(g.nodes[0]!.status).toBe("completed");
    expect(g.nodes[0]!.artifacts[0]!.version).toBe(1);
    await f.coordinator.execute(running.id, owner);
    expect(f.calls).toHaveLength(0);
    expect(f.store.file(running.id, owner, "result.md")).toBe("Already published");
  });
  it("allows editing an unstarted step after a crash left a prepared orphan", async () => {
    const f = await fixture();
    let g = f.create();
    const node = g.nodes[0]!;
    const key =
      "dag:" +
      g.id +
      ":" +
      createHash("sha256")
        .update(JSON.stringify({ id: node.id, goal: node.goal, depends_on: node.depends_on }))
        .digest("hex")
        .slice(0, 16) +
      ":1";
    const orphan = f.store.create(
      g.project_id,
      owner,
      owner,
      {
        client_request_id: key,
        goal: node.goal,
        worker_role: "analyst",
        max_model_requests: 3,
        max_input_tokens: 32000,
        max_output_tokens: 6000
      },
      true,
      { graph_id: g.id, node_id: node.id, attempt: 1, bound: false }
    )!;
    g = f.dag.edit(
      g.id,
      owner,
      g.version,
      nodes.map((n) => (n.id === node.id ? { ...n, goal: "Updated goal" } : n))
    );
    g = await f.execute(g, "brief");
    expect(g.nodes[0]!.status).toBe("completed");
    expect(g.nodes[0]!.attempts[0]!.work_id).not.toBe(orphan.id);
    expect(f.store.get(orphan.id, owner)!.status).toBe("paused");
    expect(f.calls).toHaveLength(2);
  });
});
