import { loadServerConfig } from "@cosmora/config";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
