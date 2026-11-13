import { loadServerConfig } from "@cosmora/config";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type {
  CreateManagerWork,
  ModelRequest,
  WorkIntelligenceGraphAdapter
} from "@cosmora/contracts";
import {
  OwnerSkillStore,
  EmergencyStopStore,
  ManagerWorkStore,
  openDatabase,
  PolicyStore,
  ProjectStore,
  runMigrations,
  UsageStore
} from "@cosmora/db";
import {
  GatewayRunError,
  ModelGateway,
  ModelRegistry,
  ModelRouter,
  type ModelProviderAdapter,
  type ProviderStreamEvent
} from "@cosmora/model-gateway";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ManagerService } from "@cosmora/core";
import { buildApp } from "../src/app.js";
import { ManagerWorkCoordinator, type WorkOwnerBudget } from "../src/manager-work-coordinator.js";
import { buildModelRuntime, loadModelRegistryDocument } from "../src/model-runtime.js";
import { AccountStore } from "../src/account-settings/account-store.js";
import { GAME_FIXTURES } from "./fixtures/game-packages.js";
import type { GameGenre } from "@cosmora/contracts/game-package";
import { GAME_SOURCE_FILES } from "./fixtures/game-source.js";

import { admissionBrief, admissionProbe } from "./fixtures/manager-admission.js";

const resources: (() => void)[] = [];
afterEach(() => {
  for (const close of resources.splice(0)) close();
});
const request: CreateManagerWork = {
  client_request_id: "work-1",
  goal: "Create a useful document",
  worker_role: "analyst",
  max_model_requests: 3,
  max_input_tokens: 32000,
  max_output_tokens: 6000
};
const defaultPlan = {
  summary: "Write a document",
  instructions: "Write result.md",
  complexity: "simple",
  needs_critic: false,
  requires_external_actions: false
};

async function fixture(
  options: {
    request?: CreateManagerWork;
    plan?: object;
    draft?: object;
    review?: object;
    retry?: boolean;
    roles?: string[];
    databasePath?: string;
    graph?: WorkIntelligenceGraphAdapter;
    ownerBudget?: WorkOwnerBudget;
    onCall?: (request: ModelRequest, signal: AbortSignal) => Promise<void>;
    chunks?: string[];
    chunksFor?: (request: ModelRequest) => string[] | undefined;
    usage?: Extract<ProviderStreamEvent, { type: "response.completed" }>["usage"];
    wrapOutput?: boolean;
    afterChunk?: (request: ModelRequest, signal: AbortSignal, index: number) => Promise<void>;
    afterCompletion?: (request: ModelRequest) => void | Promise<void>;
    operationTimeoutMs?: number;
    managerContextWindow?: number;
    prepareMemory?: (store: ManagerWorkStore, projectId: string) => void;
  } = {}
) {
  const database = openDatabase(options.databasePath ?? ":memory:");
  let databaseClosed = false;
  const closeDatabase = () => {
    if (!databaseClosed) database.close();
    databaseClosed = true;
  };
  resources.push(closeDatabase);
  await runMigrations(database);
  const accountStore = new AccountStore(database.sqlite);
  const projects = new ProjectStore(database.sqlite),
    policy = new PolicyStore(database.sqlite);
  const store = new ManagerWorkStore(database.sqlite),
    emergency = new EmergencyStopStore(database.sqlite);
  const initial = projects.createProject("test", "source");
  const project = initial.project;
  policy.ensureProfile(project.id);
  policy.updateProfile({
    projectId: project.id,
    baseLevel: "A2",
    overrides: [],
    expectedVersion: 1
  });
  const calls: string[] = [];
  const adapter: ModelProviderAdapter = {
    id: "mock",
    modelId: "manager-b0.1",
    async *stream(req, signal): AsyncGenerator<ProviderStreamEvent> {
      calls.push(req.task_type);
      await options.onCall?.(req, signal);
      if (options.retry) throw new GatewayRunError("PROVIDER_ERROR", "mock", "retry", true);
      const result =
        req.task_type === "manager_work_plan"
          ? (options.plan ?? defaultPlan)
          : req.task_type === "manager_work_draft"
            ? (options.draft ?? {
                files: [{ name: "result.md", content: "# Useful\nComplete document." }]
              })
            : (options.review ?? { verdict: "PASS", reason: "Complete and consistent" });
      const serialized = JSON.stringify(result);
      const chunks = options.chunksFor?.(req) ??
        options.chunks ?? [options.wrapOutput ? `<escape>${serialized}</escape>` : serialized];
      for (const [index, delta] of chunks.entries()) {
        yield { type: "text.delta", delta };
        await options.afterChunk?.(req, signal, index);
      }
      yield {
        type: "response.completed",
        provider: "mock",
        model: "manager-b0.1",
        finishReason: "stop",
        usage: options.usage ?? { inputTokens: 100, outputTokens: 100 }
      };
      await options.afterCompletion?.(req);
    }
  };
  const config = loadServerConfig({ NODE_ENV: "test" });
  const runtime = await buildModelRuntime(config);
  const registry = loadModelRegistryDocument("config/model-registry.v1.json");
  if (options.roles) registry.entries[0]!.roles = options.roles;
  const gateway = new ModelGateway([adapter], new ModelRouter(new ModelRegistry(registry)), [], {
    maxAttemptsPerRoute: 5,
    retryBaseDelayMs: 1,
    retryMaxDelayMs: 1,
    circuitFailureThreshold: 10,
    circuitOpenMs: 1000
  });
  const dependencies = {
    store,
    projects,
    policy,
    emergency,
    gateway,
    manager:
      options.managerContextWindow === undefined
        ? runtime.manager
        : new ManagerService({
            preferredProvider: "mock",
            preferredModelAlias: "manager",
            fallbackAllowed: false,
            contextWindowTokens: options.managerContextWindow
          }),
    ...(options.operationTimeoutMs === undefined
      ? {}
      : { operationTimeoutMs: options.operationTimeoutMs }),
    ...(options.graph ? { graph: options.graph } : {}),
    ownerBudget: options.ownerBudget ?? accountStore
  };
  const coordinator = new ManagerWorkCoordinator(dependencies);
  if (options.prepareMemory) {
    projects.failRun(initial.run.id, "FIXTURE_IDLE");
    options.prepareMemory(store, project.id);
  }
  const work = store.create(project.id, "local-owner", "local-owner", options.request ?? request)!;
  const get = () => store.get(work.id, "local-owner")!;
  return {
    database,
    accountStore,
    closeDatabase,
    projects,
    policy,
    store,
    emergency,
    project,
    initialRun: initial.run,
    calls,
    coordinator,
    work,
    get,
    dependencies,
    config
  };
}

describe("durable Manager work", () => {
  it("verifies both single-file download paths and refuses a missing modern version without model replay", async () => {
    const f = await fixture();
    const app = buildApp({
      config: f.config,
      database: f.database,
      projectStore: f.projects,
      managerWorkStore: f.store,
      managerWorkCoordinator: f.coordinator
    });
    try {
      await f.coordinator.execute(f.work.id, "local-owner");
      const artifact = f.store.runtime.artifacts(f.project.id, "local-owner", f.work.id)[0]!;
      const plain = `/api/v1/projects/${f.project.id}/work/${f.work.id}/files/${artifact.name}`;
      const versioned = `/api/v1/projects/${f.project.id}/work-artifacts/${artifact.id}/download`;
      const original = await app.inject(plain);
      expect(original.statusCode).toBe(200);
      expect(original.headers["cache-control"]).toBe("private, no-store");
      expect((await app.inject(versioned)).body).toBe(original.body);
      const calls = f.calls.length;
      f.database.sqlite
        .prepare("UPDATE manager_work_files SET content='corrupt' WHERE execution_id=?")
        .run(f.work.id);
      const brokenCopy = await app.inject(plain);
      expect(brokenCopy.statusCode).toBe(409);
      expect(brokenCopy.json()).toEqual({ error: "ARTIFACT_INTEGRITY_MISMATCH" });
      expect(brokenCopy.headers["content-disposition"]).toBeUndefined();
      expect(brokenCopy.headers["cache-control"]).toBe("private, no-store");
      expect((await app.inject(versioned)).body).toBe(original.body);
      f.database.sqlite
        .prepare("UPDATE manager_work_files SET content=? WHERE execution_id=?")
        .run(original.body, f.work.id);
      f.database.sqlite
        .prepare("UPDATE work_artifact_versions SET sha256=? WHERE id=?")
        .run("0".repeat(64), artifact.id);
      expect((await app.inject(plain)).statusCode).toBe(409);
      expect((await app.inject(versioned)).statusCode).toBe(404);
      f.database.sqlite.prepare("DELETE FROM work_artifact_versions WHERE id=?").run(artifact.id);
      expect((await app.inject(plain)).statusCode).toBe(409);
      expect(f.get().status).toBe("completed");
      expect(f.calls).toHaveLength(calls);
    } finally {
      await app.close();
    }
  });
  it("executes a healthy owner's task beyond 50 privacy-fenced queue entries without touching them", async () => {
    const f = await fixture();
    for (let i = 0; i < 49; i++)
      f.store.create(f.project.id, "local-owner", "local-owner", {
        ...request,
        client_request_id: `frozen-${i}`
      });
    const healthyOwner = "ready-owner";
    const project = f.projects.createProject("Ready owner", "ready-source", healthyOwner).project;
    f.policy.ensureProfile(project.id);
    f.policy.updateProfile({
      projectId: project.id,
      baseLevel: "A2",
      overrides: [],
      expectedVersion: 1
    });
    const work = f.store.create(project.id, healthyOwner, healthyOwner, request)!;
    f.database.sqlite
      .prepare(
        `INSERT INTO kosmora_owner_data_lifecycle
      (owner_id,state,epoch,operation_id,started_at,updated_at) VALUES (?,'quiescing',1,'queue-test',datetime('now'),datetime('now'))`
      )
      .run("local-owner");
    const frozen = f.store.list(f.project.id, "local-owner");
    expect(frozen).toHaveLength(50);
    try {
      f.coordinator.start();
      await vi.waitFor(() => expect(f.store.get(work.id, healthyOwner)?.status).toBe("completed"), {
        timeout: 5000
      });
      expect(f.store.list(f.project.id, "local-owner")).toEqual(frozen);
      expect(f.store.ownerWritable("local-owner")).toBe(false);
      expect(f.calls).toEqual(["manager_work_plan", "manager_work_draft"]);
    } finally {
      await f.coordinator.stop();
    }
  });
  it.each(["work-fence", "quiescing"] as const)(
    "starts after a crash with a %s owner and executes only another owner's task",
    async (fence) => {
      const f = await fixture();
      const protectedWork = f.store.claim(f.get())!;
      const otherOwner = "healthy-owner";
      const other = f.projects.createProject("Healthy owner", "healthy-start", otherOwner).project;
      f.policy.ensureProfile(other.id);
      f.policy.updateProfile({
        projectId: other.id,
        baseLevel: "A2",
        overrides: [],
        expectedVersion: 1
      });
      const healthy = f.store.create(other.id, otherOwner, otherOwner, request)!;
      if (fence === "work-fence") {
        f.database.sqlite
          .prepare("INSERT INTO work_owner_fences(owner_id,epoch,fenced) VALUES (?,1,1)")
          .run("local-owner");
      } else {
        f.database.sqlite
          .prepare(
            `INSERT INTO kosmora_owner_data_lifecycle
          (owner_id,state,epoch,operation_id,started_at,updated_at) VALUES (?,'quiescing',1,'restart-test',datetime('now'),datetime('now'))`
          )
          .run("local-owner");
      }
      try {
        expect(() => f.coordinator.start()).not.toThrow();
        await vi.waitFor(
          () => expect(f.store.get(healthy.id, otherOwner)?.status).toBe("completed"),
          { timeout: 5000 }
        );
        expect(f.get()).toEqual(protectedWork);
        expect(f.calls).toEqual(["manager_work_plan", "manager_work_draft"]);
        expect(f.store.ownerWritable("local-owner")).toBe(false);
      } finally {
        await f.coordinator.stop();
      }
    }
  );
  const recalled =
    (required = false) =>
    (store: ManagerWorkStore, projectId: string) => {
      for (let index = 0; index < (required ? 1 : 3); index++)
        store.contextMemory.create(
          {
            scope: "project",
            scope_id: projectId,
            kind: required ? "constraint" : "fact",
            title: `document ${index}`,
            content: `document ${index}: ` + "x".repeat(1400),
            pinned: required,
            expires_at: null,
            source: null
          },
          "local-owner"
        );
      store.contextMemory.updateSettings(
        { kind: "project", id: projectId },
        {
          enabled: true,
          use_personal: false,
          source_chat_ids: [],
          project_ids: [],
          expected_version: 0
        },
        "local-owner"
      );
    };
  it("drops only optional recall to finish within the remaining task input budget", async () => {
    const requests: ModelRequest[] = [];
    const f = await fixture({
      request: { ...request, max_input_tokens: 3000 },
      prepareMemory: recalled(),
      onCall: (req) => {
        requests.push(req);
        return Promise.resolve();
      }
    });
    await f.coordinator.execute(f.work.id, "local-owner");
    expect(f.get().status).toBe("completed");
    expect(requests).toHaveLength(2);
    for (const req of requests) {
      const data = JSON.parse(req.messages.find((m) => m.role === "user")!.content) as {
        goal: string;
        recalled_memory?: unknown;
      };
      expect(data.goal).toBe(request.goal);
      expect(data.recalled_memory).toBeUndefined();
      expect(req.routing.estimated_input_tokens).toBeLessThanOrEqual(3000);
    }
    const receipts = f.store.contextMemory.usage(
      { kind: "project", id: f.project.id },
      "local-owner"
    ).items;
    expect(receipts).toHaveLength(2);
    for (const receipt of receipts)
      expect(receipt.snapshot).toMatchObject({
        representation: "none",
        bundle_bytes: 0,
        sources: []
      });
    expect(f.accountStore.summary("local-owner").in_flight_or_uncertain_holds).toBe(0);
  });
  it("fails before dispatch when a mandatory recalled fact cannot fit with the task envelope", async () => {
    const f = await fixture({
      request: { ...request, max_input_tokens: 3000 },
      prepareMemory: recalled(true)
    });
    await f.coordinator.execute(f.work.id, "local-owner");
    expect(f.get()).toMatchObject({
      status: "failed",
      error_code: "WORK_MEMORY_CONTEXT_INCOMPLETE",
      model_requests: 0
    });
    expect(f.calls).toEqual([]);
    expect(f.accountStore.summary("local-owner").total_counted_tokens).toBe(0);
  });
  it("rejects mandatory materials beyond the model window without charging or cutting them", async () => {
    const f = await fixture({ managerContextWindow: 6000 });
    const materials = { instructions: "Owner material " + "x".repeat(9000), attachments: [] };
    f.store.save({ ...f.get(), materials });
    await f.coordinator.execute(f.work.id, "local-owner");
    expect(f.get()).toMatchObject({
      status: "failed",
      error_code: "WORK_CONTEXT_TOO_LARGE",
      model_requests: 0
    });
    expect(f.get().materials).toEqual(materials);
    expect(f.get().events.at(-1)?.message).toContain("Запрос этого этапа не отправлен");
    expect(f.calls).toEqual([]);
    expect(f.accountStore.summary("local-owner").total_counted_tokens).toBe(0);
    const running = f.database.sqlite
      .prepare("SELECT count(*) AS n FROM runs WHERE project_id=? AND id!=? AND status='running'")
      .get(f.project.id, f.initialRun.id);
    expect(running?.n).toBe(0);
  });
  it("keeps a complete draft and refuses an oversized Critic request before dispatch", async () => {
    const content = "A".repeat(16000);
    const f = await fixture({
      managerContextWindow: 12000,
      request: { ...request, max_input_tokens: 300000, require_critic: true },
      plan: { ...defaultPlan, needs_critic: true },
      draft: { files: [{ name: "result.md", content }] }
    });
    await f.coordinator.execute(f.work.id, "local-owner");
    expect(f.get()).toMatchObject({
      status: "failed",
      error_code: "WORK_CONTEXT_TOO_LARGE",
      model_requests: 2
    });
    expect(f.calls).toEqual(["manager_work_plan", "manager_work_draft"]);
    expect(f.get().draft?.files[0]?.content).toBe(content);
    expect(f.get().review).toBeNull();
  });
  it("validates a relay-wrapped plan without granting its requested external actions", async () => {
    const f = await fixture({
      chunks: [
        `<escape>${JSON.stringify({ ...defaultPlan, requires_external_actions: true })}</escape>`
      ]
    });
    await f.coordinator.execute(f.work.id, "local-owner");
    expect(f.get()).toMatchObject({ status: "failed", error_code: "UNSUPPORTED_ACTION" });
    expect(f.calls).toEqual(["manager_work_plan"]);
    expect(f.get().draft).toBeNull();
  });
  it("keeps a wrapped Critic FAIL as a rejection and never publishes its draft", async () => {
    const f = await fixture({
      request: { ...request, require_critic: true },
      wrapOutput: true,
      review: { verdict: "FAIL", reason: "The implementation misses required validation" }
    });
    await f.coordinator.execute(f.work.id, "local-owner");
    expect(f.get()).toMatchObject({
      status: "failed",
      error_code: "CRITIC_REJECTED",
      review: { verdict: "FAIL", reason: "The implementation misses required validation" }
    });
    expect(f.calls).toEqual(["manager_work_plan", "manager_work_draft", "manager_work_review"]);
  });
  it("records each Work memory dispatch before the provider and upgrades it only on completion", async () => {
    const phases: string[] = [];
    const f = await fixture({
      onCall: (req) => {
        const row = f.store.contextMemory
          .usage({ kind: "project", id: f.project.id }, "local-owner")
          .items.find((item) => item.request_id === req.request_id);
        phases.push(row?.phase ?? "missing");
        return Promise.resolve();
      }
    });
    // Configure memory before admitting the task: queued work correctly fences
    // changes to the sources it may use.
    f.coordinator.control(f.work.id, "local-owner", f.work.version, "cancel");
    f.projects.cancelRun(f.initialRun.id, "local-owner");
    const memory = f.store.contextMemory.create(
      {
        scope: "personal",
        scope_id: null,
        kind: "constraint",
        title: "Writing rule",
        content: "Use plain language in the document.",
        pinned: true,
        expires_at: null,
        source: null
      },
      "local-owner"
    );
    const target = { kind: "project" as const, id: f.project.id };
    f.store.contextMemory.updateSettings(
      target,
      {
        enabled: true,
        use_personal: true,
        source_chat_ids: [],
        project_ids: [],
        expected_version: 0
      },
      "local-owner"
    );
    const work = f.store.create(f.project.id, "local-owner", "local-owner", {
      ...request,
      client_request_id: "memory-receipt-work"
    })!;
    await f.coordinator.execute(work.id, "local-owner");
    expect(f.calls).toEqual(["manager_work_plan", "manager_work_draft"]);
    expect(phases).toEqual(["dispatch_boundary", "dispatch_boundary"]);
    const rows = f.store.contextMemory.usage(target, "local-owner").items;
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row).toMatchObject({
        channel: "manager_work",
        phase: "provider_completed",
        attempt: 0,
        snapshot: {
          representation: "exact",
          sources: [expect.objectContaining({ reference: "M:" + memory.id })]
        }
      });
    }
    expect(JSON.stringify(rows)).not.toContain("Use plain language");
  });

  it("does not create a memory dispatch receipt when the project budget rejects Work", async () => {
    const f = await fixture();
    const usage = new UsageStore(f.database.sqlite);
    usage.ensureLimit(f.project.id);
    usage.updateLimit(f.project.id, { expected_version: 1, max_total_tokens: 1, max_cost: null });
    await f.coordinator.execute(f.work.id, "local-owner");
    expect(f.calls).toHaveLength(0);
    expect(
      f.store.contextMemory.usage({ kind: "project", id: f.project.id }, "local-owner").items
    ).toEqual([]);
  });

  it("flushes accepted partial text on cancel, ignores late output and never publishes the recovery prefix", async () => {
    let release!: () => void, observed!: () => void;
    const paused = new Promise<void>((done) => {
      observed = done;
    });
    const gate = new Promise<void>((done) => {
      release = done;
    });
    const first = '{"summary":',
      tail = '"partial draft"';
    let observedVersion = 0;
    const f = await fixture({
      chunks: [first, tail, "LATE OUTPUT"],
      onCall: () => {
        observedVersion = f.get().version;
        return Promise.resolve();
      },
      afterChunk: (_req, _signal, index) => {
        if (index === 1) {
          observed();
          return gate;
        }
        return Promise.resolve();
      }
    });
    const running = f.coordinator.execute(f.work.id, "local-owner");
    await paused;
    expect(f.get().output_checkpoint?.text).toBe(first);
    expect(observedVersion).toBeLessThan(f.get().version);
    f.coordinator.control(f.work.id, "local-owner", observedVersion, "cancel");
    const cancelled = f.get();
    expect(cancelled.output_checkpoint).toMatchObject({
      text: first + tail,
      kind: "unvalidated_model_output",
      stream_completed: false,
      stage: "plan"
    });
    release();
    await running;
    expect(f.get()).toEqual(cancelled);
    expect(f.get().plan).toBeNull();
    expect(f.store.file(f.work.id, "local-owner", "result.md")).toBeNull();
    expect(f.store.get(f.work.id, "other-owner")).toBeNull();
    expect(f.store.create(f.project.id, "local-owner", "local-owner", request)?.id).toBe(f.work.id);
    await f.coordinator.execute(f.work.id, "local-owner");
    expect(f.calls).toHaveLength(1);
    expect(f.accountStore.summary("local-owner").total_counted_tokens).toBeGreaterThan(0);
  });

  it("does not relax control CAS across logical changes or grant approval across recovery writes", async () => {
    let release!: () => void,
      observed!: () => void,
      observedVersion = 0;
    const paused = new Promise<void>((done) => {
      observed = done;
    });
    const gate = new Promise<void>((done) => {
      release = done;
    });
    const f = await fixture({
      chunks: ['{"summary":'],
      onCall: () => {
        observedVersion = f.get().version;
        return Promise.resolve();
      },
      afterChunk: () => {
        observed();
        return gate;
      }
    });
    const running = f.coordinator.execute(f.work.id, "local-owner");
    await paused;
    try {
      expect(() =>
        f.coordinator.control(f.work.id, "local-owner", observedVersion, "approve")
      ).toThrow("STALE_EXECUTION");
      f.coordinator.control(f.work.id, "local-owner", observedVersion, "pause");
      const afterPause = f.get();
      expect(afterPause.pause_requested).toBe(true);
      expect(() =>
        f.coordinator.control(f.work.id, "local-owner", observedVersion, "cancel")
      ).toThrow("STALE_EXECUTION");
      expect(f.get()).toEqual(afterPause);
      f.coordinator.control(f.work.id, "local-owner", afterPause.version, "cancel");
    } finally {
      release();
      await running;
    }
    expect(f.get().status).toBe("cancelled");
    expect(f.calls).toHaveLength(1);
  });

  it("times out a stalled Work, preserves its checkpoint and retains active slots until transport settles", async () => {
    let release!: () => void;
    const gate = new Promise<void>((done) => {
      release = done;
    });
    const f = await fixture({
      operationTimeoutMs: 100,
      chunks: ['{"summary":"unfinished'],
      afterChunk: () => gate
    });
    const second = f.store.create(f.project.id, "local-owner", "local-owner", {
      ...request,
      client_request_id: "second-slot"
    })!;
    const running = f.coordinator.execute(f.work.id, "local-owner");
    const secondRun = f.coordinator.execute(second.id, "local-owner");
    try {
      await vi.waitFor(() =>
        expect(f.get()).toMatchObject({ status: "failed", error_code: "TASK_TIME_BUDGET" })
      );
      expect(f.coordinator.hasActiveExecution(f.work.id)).toBe(true);
      expect(f.coordinator.hasActiveExecution(second.id)).toBe(true);
      expect(f.get().output_checkpoint?.text).toBe('{"summary":"unfinished');
      const third = f.store.create(f.project.id, "local-owner", "local-owner", {
        ...request,
        client_request_id: "next-task"
      })!;
      await f.coordinator.execute(third.id, "local-owner");
      expect(f.store.get(third.id, "local-owner")?.status).toBe("queued");
      expect(f.calls).toHaveLength(2);
    } finally {
      release();
      await Promise.allSettled([running, secondRun]);
    }
    expect(f.get()).toMatchObject({ status: "failed", error_code: "TASK_TIME_BUDGET" });
    expect(f.coordinator.hasActiveExecution(f.work.id)).toBe(false);
  });

  it("does not persist buffered or late output after the owner privacy fence", async () => {
    let release!: () => void, observed!: () => void;
    const paused = new Promise<void>((done) => {
      observed = done;
    });
    const gate = new Promise<void>((done) => {
      release = done;
    });
    const f = await fixture({
      chunks: ["first saved", " buffered", " late"],
      afterChunk: (_req, _signal, index) => {
        if (index === 1) {
          observed();
          return gate;
        }
        return Promise.resolve();
      }
    });
    const running = f.coordinator.execute(f.work.id, "local-owner");
    await paused;
    const before = f.get();
    f.database.sqlite
      .prepare(
        "INSERT INTO kosmora_owner_data_lifecycle(owner_id,state,epoch,operation_id,started_at,updated_at) VALUES(?,'quiescing',1,'checkpoint-test',?,?)"
      )
      .run("local-owner", new Date().toISOString(), new Date().toISOString());
    release();
    await running;
    expect(f.get()).toEqual(before);
    expect(f.get().output_checkpoint?.text).toBe("first saved");
    expect(f.calls).toHaveLength(1);
  });

  it("rejects invalid operation deadlines before accepting execution", async () => {
    const f = await fixture();
    for (const operationTimeoutMs of [0, -1, 1.5, Infinity, 1800001])
      expect(() => new ManagerWorkCoordinator({ ...f.dependencies, operationTimeoutMs })).toThrow(
        /time budget/
      );
  });
  it("accepts the first Work in a prepared draft project and activates it atomically", async () => {
    const f = await fixture();
    const id = crypto.randomUUID();
    f.projects.createEmptyProject(id, "Prepared Work");
    const app = buildApp({
      config: f.config,
      database: f.database,
      projectStore: f.projects,
      managerWorkStore: f.store,
      managerWorkCoordinator: f.coordinator
    });
    try {
      const response = await app.inject({
        method: "POST",
        url: `/api/v1/projects/${id}/work`,
        payload: { ...request, client_request_id: "first-draft-work" }
      });
      expect(response.statusCode, response.body).toBe(201);
      expect(f.projects.getProject(id)?.status).toBe("ACTIVE");
      expect(response.json<{ status: string }>().status).toBe("queued");
      expect(f.calls).toEqual([]);
      // An older draft with no policy must receive the normal default and stop
      // at the existing approval gate, not fail after paying for its plan.
      const work = response.json<{ id: string }>();
      await f.coordinator.execute(work.id, "local-owner");
      expect(f.policy.getProfile(id)?.base_level).toBe("A0");
      expect(f.store.get(work.id, "local-owner")).toMatchObject({
        status: "awaiting_approval",
        error_code: null
      });
      expect(f.calls).toEqual(["manager_work_plan"]);
    } finally {
      await app.close();
      await f.coordinator.stop();
    }
  });

  it("rolls back activation and all accepted Work state when capturing its snapshot fails", async () => {
    const f = await fixture();
    const id = crypto.randomUUID();
    f.projects.createEmptyProject(id, "Untouched draft");
    f.database.sqlite.exec(
      "CREATE TEMP TRIGGER reject_fixture_snapshot BEFORE INSERT ON manager_work_skill_snapshots BEGIN SELECT RAISE(ABORT,'fixture snapshot failed'); END"
    );
    expect(() =>
      f.store.create(id, "local-owner", "local-owner", {
        ...request,
        client_request_id: "failed-snapshot"
      })
    ).toThrow("fixture snapshot failed");
    expect(f.projects.getProject(id)?.status).toBe("DRAFT");
    expect(f.store.list(id, "local-owner")).toEqual([]);
    expect(f.calls).toEqual([]);
    await f.coordinator.stop();
  });

  it("never activates a foreign, archived, failed, cancelled or privacy-fenced project", async () => {
    const f = await fixture();
    for (const status of ["ARCHIVED", "FAILED"] as const) {
      const id = crypto.randomUUID();
      f.projects.createEmptyProject(id, status);
      f.database.sqlite.prepare("UPDATE projects SET status=? WHERE id=?").run(status, id);
      expect(f.store.create(id, "local-owner", "local-owner", request)).toBeNull();
      expect(f.projects.getProject(id)?.status).toBe(status);
    }
    const id = crypto.randomUUID();
    f.projects.createEmptyProject(id, "Private draft");
    expect(f.store.create(id, "another-owner", "another-owner", request)).toBeNull();
    f.database.sqlite
      .prepare(
        "INSERT INTO work_project_controls(project_id,owner_id,mode) VALUES(?,?,'cancelled')"
      )
      .run(id, "local-owner");
    expect(() => f.store.create(id, "local-owner", "local-owner", request)).toThrow(
      "PROJECT_CANCELLED"
    );
    f.database.sqlite.prepare("DELETE FROM work_project_controls WHERE project_id=?").run(id);
    f.store.fenceOwner("local-owner");
    expect(() => f.store.create(id, "local-owner", "local-owner", request)).toThrow(
      "OWNER_QUIESCED"
    );
    expect(f.projects.getProject(id)?.status).toBe("DRAFT");
    expect(f.calls).toEqual([]);
    await f.coordinator.stop();
  });

  it.each([
    { message: "Provider returned HTTP 503", diagnostic: "HTTP_503" },
    { message: "untrusted upstream body with SECRET_SENTINEL", diagnostic: undefined }
  ])(
    "records only allowlisted provider diagnostics without retries",
    async ({ message, diagnostic }) => {
      const f = await fixture({
        onCall: () => Promise.reject(new GatewayRunError("PROVIDER_ERROR", "mock", message, true))
      });
      await f.coordinator.execute(f.work.id, "local-owner");
      expect(f.get()).toMatchObject({
        status: "failed",
        model_requests: 1,
        error_code: "PROVIDER_ERROR"
      });
      const events = f
        .get()
        .events.map((event) => event.message)
        .join("\n");
      if (diagnostic) expect(events).toContain(diagnostic);
      else expect(events).not.toContain("Диагностика модели:");
      expect(events).not.toContain("SECRET_SENTINEL");
      expect(f.calls).toHaveLength(1);
      await f.coordinator.stop();
    }
  );
  it("accepts game source projects over HTTP and preserves all three code artifacts", async () => {
    const limits: number[] = [];
    const timeouts: number[] = [];
    const f = await fixture({
      draft: { files: GAME_SOURCE_FILES },
      onCall: (request) => {
        limits.push(request.constraints.max_output_tokens);
        timeouts.push(request.constraints.timeout_ms);
        return Promise.resolve();
      }
    });
    const app = buildApp({
      config: f.config,
      database: f.database,
      projectStore: f.projects,
      managerWorkStore: f.store,
      managerWorkCoordinator: f.coordinator
    });
    try {
      const response = await app.inject({
        method: "POST",
        url: `/api/v1/projects/${f.project.id}/work`,
        payload: {
          ...request,
          client_request_id: "source-http",
          output_contract: { kind: "game_project" }
        }
      });
      expect(response.statusCode, response.body).toBe(201);
      const work = response.json<{ id: string; request: CreateManagerWork }>();
      expect(work.request.output_contract).toEqual({ kind: "game_project" });
      await f.coordinator.execute(work.id, "local-owner");
      expect(f.store.get(work.id, "local-owner")).toMatchObject({
        status: "completed",
        model_requests: 2,
        draft: { files: GAME_SOURCE_FILES }
      });
      expect(f.store.runtime.artifacts(f.project.id, "local-owner", work.id)).toHaveLength(3);
      expect(f.accountStore.summary("local-owner").total_counted_tokens).toBe(400);
      expect(limits).toEqual([1200, 4800]);
      expect(timeouts).toEqual([60000, 180000]);
    } finally {
      await app.close();
      await f.coordinator.stop();
    }
  });
  it("retains output budget for a required game source review", async () => {
    const limits: number[] = [];
    const f = await fixture({
      request: { ...request, output_contract: { kind: "game_project" } },
      plan: { ...defaultPlan, needs_critic: true },
      draft: { files: GAME_SOURCE_FILES },
      onCall: (request) => {
        limits.push(request.constraints.max_output_tokens);
        return Promise.resolve();
      }
    });
    await f.coordinator.execute(f.work.id, "local-owner");
    expect(f.get()).toMatchObject({
      status: "completed",
      model_requests: 3,
      review: { verdict: "PASS" }
    });
    expect(limits).toEqual([1200, 3600, 1200]);
    expect(limits.reduce((sum, value) => sum + value, 0)).toBe(6000);
    await f.coordinator.stop();
  });
  it("rejects incomplete source projects without publishing or retrying", async () => {
    const f = await fixture({
      request: { ...request, output_contract: { kind: "game_project" } },
      draft: { files: GAME_SOURCE_FILES.slice(1) }
    });
    await f.coordinator.execute(f.work.id, "local-owner");
    expect(f.get()).toMatchObject({
      status: "failed",
      error_code: "INVALID_GAME_PROJECT_RESULT",
      model_requests: 2
    });
    expect(f.store.runtime.artifacts(f.project.id, "local-owner", f.work.id)).toHaveLength(0);
    expect(f.calls).toHaveLength(2);
    await f.coordinator.stop();
  });
  it("accepts each game discriminator through HTTP without mutating its fields", async () => {
    const f = await fixture();
    const app = buildApp({
      config: f.config,
      database: f.database,
      projectStore: f.projects,
      managerWorkStore: f.store,
      managerWorkCoordinator: f.coordinator
    });
    try {
      const url = `/api/v1/projects/${f.project.id}/work`;
      for (const genre of ["arcade", "memory", "quiz"] as GameGenre[]) {
        const payload = {
          ...request,
          client_request_id: `http-${genre}`,
          output_contract: { kind: "game", genre }
        };
        const response = await app.inject({ method: "POST", url, payload });
        expect(response.statusCode, response.body).toBe(201);
        expect(
          response.json<{ request: { output_contract: unknown } }>().request.output_contract
        ).toEqual({ kind: "game", genre });
      }
      expect(
        (
          await app.inject({
            method: "POST",
            url,
            payload: {
              ...request,
              client_request_id: "bad-genre",
              output_contract: { kind: "game", genre: "fps" }
            }
          })
        ).statusCode
      ).toBe(400);
      expect(f.calls).toHaveLength(0);
    } finally {
      await app.close();
      await f.coordinator.stop();
    }
  });
  it.each(["arcade", "memory", "quiz"] as GameGenre[])(
    "creates validated %s game data with existing policy and accounting",
    async (genre) => {
      const content = JSON.stringify(GAME_FIXTURES[genre]);
      const f = await fixture({
        request: { ...request, output_contract: { kind: "game", genre } },
        draft: { files: [{ name: "game.json", content }] }
      });
      await f.coordinator.execute(f.work.id, "local-owner");
      expect(f.get()).toMatchObject({
        status: "completed",
        model_requests: 2,
        draft: { files: [{ name: "game.json", content }] }
      });
      expect(f.store.runtime.artifacts(f.project.id, "local-owner", f.work.id)).toHaveLength(1);
      expect(f.accountStore.summary("local-owner").total_counted_tokens).toBe(400);
      await f.coordinator.stop();
    }
  );
  it.each([
    { ...GAME_FIXTURES.memory, script: "fetch('/private')" },
    { ...GAME_FIXTURES.memory, pairs: ["A", "a", "B", "C"] },
    GAME_FIXTURES.quiz
  ])(
    "rejects invalid game data or a genre mismatch without publication or a paid retry",
    async (game) => {
      const f = await fixture({
        request: { ...request, output_contract: { kind: "game", genre: "memory" } },
        draft: { files: [{ name: "game.json", content: JSON.stringify(game) }] }
      });
      await f.coordinator.execute(f.work.id, "local-owner");
      expect(f.get()).toMatchObject({
        status: "failed",
        error_code: "INVALID_GAME_RESULT",
        model_requests: 2
      });
      expect(f.store.runtime.artifacts(f.project.id, "local-owner", f.work.id)).toHaveLength(0);
      expect(f.calls).toHaveLength(2);
      await f.coordinator.stop();
    }
  );
  it("creates a website through the real Work route, validates HTML and keeps canonical accounting", async () => {
    const html =
      "<!doctype html><html lang='ru'><head><style>body{color:#222}</style></head><body><h1>Студия</h1><p>Проекты и контакты</p></body></html>";
    const f = await fixture({
      draft: { files: [{ name: "index.html", content: html }] },
      onCall: async (req) => {
        await Promise.resolve();
        const system = req.messages[0]!.content;
        expect(system).toContain("index.html");
        if (req.task_type === "manager_work_plan") expect(system).toContain('"complexity"');
      }
    });
    const app = buildApp({
      config: f.config,
      database: f.database,
      projectStore: f.projects,
      managerWorkStore: f.store,
      managerWorkCoordinator: f.coordinator
    });
    try {
      const payload = {
        ...request,
        client_request_id: "website-route",
        goal: "Страница студии",
        output_contract: { kind: "website" }
      };
      const url = `/api/v1/projects/${f.project.id}/work`;
      const created = await app.inject({ method: "POST", url, payload });
      expect(created.statusCode, created.body).toBe(201);
      const id = created.json<{ id: string }>().id;
      await f.coordinator.execute(id, "local-owner");
      expect(f.store.get(id, "local-owner")).toMatchObject({
        status: "completed",
        model_requests: 2
      });
      expect(f.calls).toEqual(["manager_work_plan", "manager_work_draft"]);
      expect((await app.inject({ method: "POST", url, payload })).json<{ id: string }>().id).toBe(
        id
      );
      const file = await app.inject({ url: `${url}/${id}/files/index.html` });
      expect(file.body).toBe(html);
      expect(file.headers["content-disposition"]).toContain("attachment");
      expect(f.accountStore.summary("local-owner").total_counted_tokens).toBe(400);
    } finally {
      await app.close();
      await f.coordinator.stop();
    }
  });
  it.each([
    [{ name: "result.md", content: "Not a site" }],
    [{ name: "index.html", content: "<html><body>Truncated" }],
    [{ name: "index.html", content: "<html><body><script>alert(1)</script></body></html>" }]
  ])(
    "rejects malformed website outputs without publishing or paid retries: %j",
    async (...files) => {
      const f = await fixture({
        request: { ...request, output_contract: { kind: "website" } },
        draft: { files }
      });
      await f.coordinator.execute(f.work.id, "local-owner");
      expect(f.get()).toMatchObject({
        status: "failed",
        error_code: "INVALID_WEBSITE_RESULT",
        model_requests: 2
      });
      expect(f.store.runtime.artifacts(f.project.id, "local-owner", f.work.id)).toHaveLength(0);
      expect(f.calls).toHaveLength(2);
      await f.coordinator.stop();
    }
  );
  it("accounts accepted Skill text before dispatch and refuses input that exceeds the existing task ceiling", async () => {
    const f = await fixture();
    const skill = new OwnerSkillStore(f.database.sqlite).create("local-owner", {
      name: "Detailed",
      summary: "Long context",
      instructions: "x".repeat(6500)
    });
    f.store.skills.update(f.project.id, "local-owner", 0, [{ skill_id: skill.id, version: 1 }]);
    const limited = f.store.create(f.project.id, "local-owner", "local-owner", {
      ...request,
      client_request_id: "skill-budget",
      max_input_tokens: 1000
    })!;
    await f.coordinator.execute(limited.id, "local-owner");
    expect(f.store.get(limited.id, "local-owner")).toMatchObject({
      status: "failed",
      error_code: "EXECUTION_BUDGET_EXCEEDED",
      model_requests: 0
    });
    expect(f.calls).toEqual([]);
    expect(f.accountStore.summary("local-owner").total_counted_tokens).toBe(0);
  });

  it("applies the real owner account ceiling to Work and deduplicates its canonical project usage", async () => {
    const limited = await fixture();
    limited.accountStore.update("local-owner", {
      ...limited.accountStore.get("local-owner"),
      expected_version: 0,
      max_total_tokens: 1
    });
    await limited.coordinator.execute(limited.work.id, "local-owner");
    expect(limited.calls).toHaveLength(0);
    expect(limited.get().error_code).toBe("USAGE_LIMIT_EXCEEDED");
    expect(limited.accountStore.summary("local-owner").total_counted_tokens).toBe(0);
    const completed = await fixture();
    await completed.coordinator.execute(completed.work.id, "local-owner");
    expect(completed.get().status).toBe("completed");
    expect(completed.calls).toHaveLength(2);
    expect(completed.accountStore.summary("local-owner")).toMatchObject({
      model_tokens_or_upper_bound: 400,
      total_counted_tokens: 400,
      in_flight_or_uncertain_holds: 0
    });
  });
  it("reserves owner quota before dispatch and reconciles only after the canonical project ledger commits", async () => {
    const events: string[] = [];
    const ownerBudget: WorkOwnerBudget = {
      reserve(owner, runId, attempt, tokens, kind, projectId, provider, model) {
        expect(owner).toBe("local-owner");
        expect(projectId).toBe(f.project.id);
        expect(attempt).toBe(0);
        expect(tokens).toBeGreaterThan(0);
        expect([kind, provider, model]).toEqual(["main", "mock", "manager-b0.1"]);
        events.push("reserve");
        return runId;
      },
      completeReservation(runId, kind, input, output) {
        expect(kind).toBe("main");
        expect([input, output]).toEqual([100, 100]);
        expect(f.projects.getRun(runId)?.status).toBe("succeeded");
        expect(f.projects.getModelUsageForRun(runId)[0]?.status).toBe("committed");
        events.push("commit");
      },
      uncertainReservation() {
        events.push("uncertain");
      },
      releaseBeforeDispatch() {
        events.push("release");
      }
    };
    const f = await fixture({
      ownerBudget,
      onCall: () => {
        events.push("dispatch");
        return Promise.resolve();
      }
    });
    await f.coordinator.execute(f.work.id, "local-owner");
    expect(f.get().status).toBe("completed");
    expect(events).toEqual(["reserve", "dispatch", "commit", "reserve", "dispatch", "commit"]);
  });

  it("fails closed on owner quota and releases holds only on a proven project-budget rejection before dispatch", async () => {
    const events: string[] = [];
    const quotaError = Object.assign(new Error("Owner quota exceeded"), {
      code: "USAGE_LIMIT_EXCEEDED"
    });
    const rejectOwner: WorkOwnerBudget = {
      reserve() {
        throw quotaError;
      },
      completeReservation() {
        events.push("commit");
      },
      uncertainReservation() {
        events.push("uncertain");
      },
      releaseBeforeDispatch() {
        events.push("release");
      }
    };
    const first = await fixture({ ownerBudget: rejectOwner });
    await first.coordinator.execute(first.work.id, "local-owner");
    expect(first.calls).toEqual([]);
    expect(first.get()).toMatchObject({
      status: "failed",
      error_code: "USAGE_LIMIT_EXCEEDED",
      model_requests: 0
    });
    expect(events).toEqual([]);
    const reserveOwner: WorkOwnerBudget = {
      ...rejectOwner,
      reserve() {
        events.push("reserve");
        return "hold";
      }
    };
    const second = await fixture({ ownerBudget: reserveOwner });
    const usage = new UsageStore(second.database.sqlite);
    usage.ensureLimit(second.project.id);
    usage.updateLimit(second.project.id, {
      expected_version: 1,
      max_total_tokens: 1,
      max_cost: null
    });
    await second.coordinator.execute(second.work.id, "local-owner");
    expect(second.calls).toEqual([]);
    expect(events).toEqual(["reserve", "release"]);
  });

  it("retains an uncertain owner hold after provider failure without automatic paid retries", async () => {
    const events: string[] = [];
    const ownerBudget: WorkOwnerBudget = {
      reserve() {
        events.push("reserve");
        return "hold";
      },
      completeReservation() {
        events.push("commit");
      },
      uncertainReservation() {
        events.push("uncertain");
      },
      releaseBeforeDispatch() {
        events.push("release");
      }
    };
    const f = await fixture({ ownerBudget, retry: true });
    await f.coordinator.execute(f.work.id, "local-owner");
    expect(f.calls).toHaveLength(1);
    expect(f.get().error_code).toBe("PROVIDER_ERROR");
    expect(events).toEqual(["reserve", "uncertain"]);
  });

  it("retains an uncertain owner hold on cancellation of a dispatched request", async () => {
    const events: string[] = [];
    let called!: () => void;
    const started = new Promise<void>((resolve) => {
      called = resolve;
    });
    const ownerBudget: WorkOwnerBudget = {
      reserve() {
        events.push("reserve");
        return "hold";
      },
      completeReservation() {
        events.push("commit");
      },
      uncertainReservation() {
        events.push("uncertain");
      },
      releaseBeforeDispatch() {
        events.push("release");
      }
    };
    const f = await fixture({
      ownerBudget,
      onCall: (_request, signal) =>
        new Promise<void>((_resolve, reject) => {
          called();
          signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        })
    });
    f.coordinator.start();
    await started;
    f.coordinator.control(f.work.id, "local-owner", f.get().version, "cancel");
    await f.coordinator.stop();
    expect(f.get().status).toBe("cancelled");
    expect(f.calls).toHaveLength(1);
    expect(events).toEqual(["reserve", "uncertain"]);
  });
  it("reopens a disk checkpoint through the API, waits for resume and does not replay the completed plan", async () => {
    const directory = mkdtempSync(join(tmpdir(), "kosmora-api-recovery-"));
    const path = join(directory, "state.db");
    const first = await fixture({
      databasePath: path,
      onCall: (modelRequest) => {
        if (modelRequest.task_type === "manager_work_plan")
          first.coordinator.control(first.work.id, "local-owner", first.get().version, "pause");
        return Promise.resolve();
      }
    });
    let reopened: Awaited<ReturnType<typeof fixture>> | undefined;
    let app: ReturnType<typeof buildApp> | undefined;
    try {
      const entry = first.store.memory.create(first.project.id, "local-owner", {
        title: "Persistent requirement",
        content: "Keep the owner context",
        source: { kind: "owner", reference: "Owner" },
        pinned: true
      })!;
      await first.coordinator.execute(first.work.id, "local-owner");
      expect(first.get()).toMatchObject({ status: "paused", stage: "draft", model_requests: 1 });
      // Seed only the safe running boundary that an abrupt process exit can leave.
      // A real in-flight request is tested separately and must never be replayed.
      first.store.save({ ...first.get(), status: "running", pause_requested: false });
      first.closeDatabase();
      reopened = await fixture({ databasePath: path });
      reopened.coordinator.start();
      app = buildApp({
        config: reopened.config,
        database: reopened.database,
        projectStore: reopened.projects,
        managerWorkStore: reopened.store,
        managerWorkCoordinator: reopened.coordinator
      });
      const base = "/api/v1/projects/" + reopened.project.id;
      const state = await app.inject({ url: base + "/work/" + reopened.work.id });
      expect(state.json()).toMatchObject({ status: "paused", stage: "draft", model_requests: 1 });
      expect(reopened.calls).toHaveLength(0);
      const memory = await app.inject({ url: base + "/memory/" + entry.id });
      expect(memory.json()).toMatchObject({ content: "Keep the owner context", pinned: true });
      const resumed = await app.inject({
        method: "POST",
        url: base + "/work/" + reopened.work.id + "/control",
        payload: { version: reopened.get().version, action: "resume" }
      });
      expect(resumed.statusCode).toBe(200);
      await vi.waitFor(() => expect(reopened!.get().status).toBe("completed"), { timeout: 3000 });
      expect(reopened.calls).toEqual(["manager_work_draft"]);
      const history = await app.inject({ url: base + "/work/" + reopened.work.id + "/runtime" });
      expect(history.json<{ checkpoints: unknown[] }>().checkpoints.length).toBeGreaterThan(3);
    } finally {
      await reopened?.coordinator.stop();
      await app?.close();
      reopened?.closeDatabase();
      first.closeDatabase();
      const temporaryParent = dirname(resolve(directory));
      expect(temporaryParent).toBe(resolve(tmpdir()));
      rmSync(directory, { recursive: true });
    }
  });
  it("injects scoped memory as data, excludes forgotten entries at the next checkpoint and never writes model memory", async () => {
    const received: string[] = [];
    const f = await fixture({
      onCall: (req) => {
        received.push(req.messages.at(-1)!.content);
        return Promise.resolve();
      }
    });
    const entry = f.store.memory.create(f.project.id, "local-owner", {
      title: "Requirement",
      content: "Use Russian",
      pinned: true,
      source: { kind: "owner", reference: "Owner" }
    })!;
    const work = f.store.create(f.project.id, "local-owner", "local-owner", {
      ...request,
      client_request_id: "with-memory"
    })!;
    f.coordinator.control(work.id, "local-owner", work.version, "pause");
    f.store.memory.control(f.project.id, "local-owner", entry.id, 1, "forget");
    const paused = f.store.get(work.id, "local-owner")!;
    f.coordinator.control(work.id, "local-owner", paused.version, "resume");
    await f.coordinator.execute(work.id, "local-owner");
    expect(received).toHaveLength(2);
    expect(received.every((text) => !text.includes("Use Russian"))).toBe(true);
    expect(f.store.get(work.id, "local-owner")?.memory_snapshot?.items[0]?.content).toBe(
      "Use Russian"
    );
    expect(f.store.memory.list(f.project.id, "local-owner")).toEqual([]);
  });

  it("provides a real versioned artifact download and runtime history through the API", async () => {
    const f = await fixture();
    await f.coordinator.execute(f.work.id, "local-owner");
    const second = f.store.create(f.project.id, "local-owner", "local-owner", {
      ...request,
      client_request_id: "version-two"
    })!;
    await f.coordinator.execute(second.id, "local-owner");
    const app = buildApp({
      config: f.config,
      database: f.database,
      projectStore: f.projects,
      managerWorkStore: f.store,
      managerWorkCoordinator: f.coordinator
    });
    try {
      const base = "/api/v1/projects/" + f.project.id;
      const response = await app.inject({ url: base + "/work/" + second.id + "/runtime" });
      expect(response.statusCode).toBe(200);
      const detail = response.json<{
        progress: { completed: number; total: number };
        artifacts: { id: string; version: number }[];
        checkpoints: unknown[];
      }>();
      expect(detail.progress).toMatchObject({ completed: 4, total: 4 });
      expect(detail.checkpoints.length).toBeGreaterThan(3);
      expect(detail.artifacts[0]?.version).toBe(2);
      const file = await app.inject({
        url: base + "/work-artifacts/" + detail.artifacts[0]!.id + "/download"
      });
      expect(file.statusCode).toBe(200);
      expect(file.body).toContain("Complete document.");
      expect(file.headers["x-content-type-options"]).toBe("nosniff");
      const other = f.projects.createProject("other", "other", "local-owner").project;
      expect(
        (
          await app.inject({
            url:
              "/api/v1/projects/" +
              other.id +
              "/work-artifacts/" +
              detail.artifacts[0]!.id +
              "/download"
          })
        ).statusCode
      ).toBe(404);
    } finally {
      await app.close();
    }
  });

  it("implements owner-scoped memory CRUD, conflict handling, pin and forget over HTTP", async () => {
    const f = await fixture();
    const app = buildApp({
      config: f.config,
      database: f.database,
      projectStore: f.projects,
      managerWorkStore: f.store,
      managerWorkCoordinator: f.coordinator
    });
    try {
      const base = "/api/v1/projects/" + f.project.id + "/memory";
      const input = {
        title: "Criterion",
        content: "Complete useful file",
        pinned: false,
        source: { kind: "reference", reference: "Owner brief" }
      };
      const created = await app.inject({ method: "POST", url: base, payload: input });
      expect(created.statusCode).toBe(201);
      const entry = created.json<{ id: string }>();
      expect(
        (
          await app.inject({
            method: "PUT",
            url: base + "/" + entry.id,
            payload: { ...input, content: "Updated", version: 1 }
          })
        ).statusCode
      ).toBe(200);
      expect(
        (
          await app.inject({
            method: "PUT",
            url: base + "/" + entry.id,
            payload: { ...input, version: 1 }
          })
        ).statusCode
      ).toBe(409);
      expect(
        (
          await app.inject({
            method: "POST",
            url: base + "/" + entry.id + "/control",
            payload: { version: 2, action: "pin" }
          })
        ).json()
      ).toMatchObject({ pinned: true, version: 3 });
      const other = f.projects.createProject("other", "other", "local-owner").project;
      expect(
        (await app.inject({ url: "/api/v1/projects/" + other.id + "/memory/" + entry.id }))
          .statusCode
      ).toBe(404);
      expect(
        (
          await app.inject({
            method: "POST",
            url: base + "/" + entry.id + "/control",
            payload: { version: 3, action: "forget" }
          })
        ).statusCode
      ).toBe(200);
      expect((await app.inject({ url: base + "/" + entry.id })).statusCode).toBe(404);
      expect((await app.inject({ url: base })).json()).toEqual({ items: [] });
    } finally {
      await app.close();
    }
  });

  it("connects an optional graph adapter and refuses another project's context before spending", async () => {
    const graph: WorkIntelligenceGraphAdapter = {
      contract_version: "kosmora-work-v1",
      read: () => Promise.resolve({ project_id: "wrong-project", entries: [] })
    };
    const f = await fixture({ graph });
    await f.coordinator.execute(f.work.id, "local-owner");
    expect(f.calls).toHaveLength(0);
    expect(f.get().error_code).toBe("GRAPH_UNAVAILABLE");
  });

  it("does not draft when a required Critic cannot fit the request budget", async () => {
    const f = await fixture({ plan: { ...defaultPlan, needs_critic: true } });
    const work = f.store.create(f.project.id, "local-owner", "local-owner", {
      ...request,
      client_request_id: "two-calls",
      max_model_requests: 2
    })!;
    await f.coordinator.execute(work.id, "local-owner");
    expect(f.calls).toHaveLength(1);
    expect(f.store.get(work.id, "local-owner")).toMatchObject({
      error_code: "EXECUTION_BUDGET_EXCEEDED",
      status: "failed"
    });
  });

  it("rejects broken JSON files instead of publishing a structurally valid wrapper", async () => {
    const f = await fixture({ draft: { files: [{ name: "result.json", content: "{broken}" }] } });
    await f.coordinator.execute(f.work.id, "local-owner");
    expect(f.get().error_code).toBe("INVALID_ARTIFACT_CONTENT");
    expect(f.store.runtime.artifacts(f.project.id, "local-owner")).toEqual([]);
  });

  it("refuses a stage whose persisted dependencies were not completed", async () => {
    const f = await fixture();
    const work = f.get();
    work.stage = "draft";
    f.store.save(work);
    await f.coordinator.execute(f.work.id, "local-owner");
    expect(f.calls).toHaveLength(0);
    expect(f.get().error_code).toBe("INVALID_WORK_GRAPH");
  });

  it("saves the executable dependency graph with every durable coordinator checkpoint", async () => {
    const f = await fixture();
    await f.coordinator.execute(f.work.id, "local-owner");
    expect(f.get().task_graph).toMatchObject({
      completed: 4,
      total: 4,
      waiting_decision: null,
      restores_permissions: false
    });
    expect(f.get().task_graph?.tasks[3]?.depends_on).toEqual([f.work.id + ":draft"]);
  });

  it("rejects an unavailable worker role before paying for a plan", async () => {
    const f = await fixture({ roles: ["manager"] });
    await f.coordinator.execute(f.work.id, "local-owner");
    expect(f.get().error_code).toBe("ROUTE_UNAVAILABLE");
    expect(f.calls).toHaveLength(0);
  });

  it("reopens a disk checkpoint and continues without repeating a completed model request", async () => {
    const directory = mkdtempSync(join(tmpdir(), "cosmora-work-"));
    const databasePath = join(directory, "work.db");
    const f = await fixture({ databasePath, plan: { ...defaultPlan, complexity: "complex" } });
    await f.coordinator.execute(f.work.id, "local-owner");
    expect(f.get().status).toBe("awaiting_approval");
    resources.pop()?.();
    const reopened = openDatabase(databasePath);
    resources.push(() => {
      reopened.close();
      rmSync(directory, { recursive: true, force: true });
    });
    await runMigrations(reopened);
    const store = new ManagerWorkStore(reopened.sqlite);
    const coordinator = new ManagerWorkCoordinator({
      ...f.dependencies,
      store,
      projects: new ProjectStore(reopened.sqlite),
      policy: new PolicyStore(reopened.sqlite),
      emergency: new EmergencyStopStore(reopened.sqlite),
      ownerBudget: new AccountStore(reopened.sqlite)
    });
    const restored = store.get(f.work.id, "local-owner")!;
    coordinator.control(restored.id, "local-owner", restored.version, "approve");
    await coordinator.execute(restored.id, "local-owner");
    expect(store.get(restored.id, "local-owner")?.status).toBe("completed");
    expect(f.calls).toEqual(["manager_work_plan", "manager_work_draft", "manager_work_review"]);
    expect(new AccountStore(reopened.sqlite).summary("local-owner").total_counted_tokens).toBe(600);
  });
  it("produces useful downloadable files through policy and replays without more requests", async () => {
    const f = await fixture();
    await f.coordinator.execute(f.work.id, "local-owner");
    expect(f.get()).toMatchObject({ status: "completed", stage: "done", model_requests: 2 });
    expect(f.store.file(f.work.id, "local-owner", "result.md")).toContain("Complete document.");
    expect(f.store.file(f.work.id, "other-owner", "result.md")).toBeNull();
    expect(
      f.policy.getOperation(f.project.id, "manager-work:" + f.work.id + ":policy:2")?.status
    ).toBe("SUCCEEDED");
    expect(f.store.create(f.project.id, "local-owner", "local-owner", request)?.id).toBe(f.work.id);
    await new ManagerWorkCoordinator(f.dependencies).execute(f.work.id, "local-owner");
    expect(f.calls).toHaveLength(2);
  });

  it("requires approval for a complex A2 plan and refuses stale approval", async () => {
    const f = await fixture({ plan: { ...defaultPlan, complexity: "complex" } });
    await f.coordinator.execute(f.work.id, "local-owner");
    expect(f.get().status).toBe("awaiting_approval");
    expect(f.calls).toHaveLength(1);
    expect(() => f.coordinator.control(f.work.id, "local-owner", 1, "approve")).toThrow(
      "STALE_EXECUTION"
    );
    f.coordinator.control(f.work.id, "local-owner", f.get().version, "approve");
    await f.coordinator.execute(f.work.id, "local-owner");
    expect(f.get().status).toBe("completed");
    expect(f.calls).toEqual(["manager_work_plan", "manager_work_draft", "manager_work_review"]);
  });

  it.each(["PASS", "FAIL"])("applies risk-selected critic verdict %s", async (verdict) => {
    const f = await fixture({
      plan: { ...defaultPlan, needs_critic: true },
      review: { verdict, reason: "Review finding" }
    });
    await f.coordinator.execute(f.work.id, "local-owner");
    expect(f.calls).toEqual(["manager_work_plan", "manager_work_draft", "manager_work_review"]);
    expect(f.get().status).toBe(verdict === "PASS" ? "completed" : "failed");
    expect(f.store.file(f.work.id, "local-owner", "result.md") !== null).toBe(verdict === "PASS");
  });

  it.each([
    { files: [{ name: "../escape.md", content: "bad" }] },
    { files: [{ name: "result.md", content: "   " }] },
    {
      files: [
        { name: "Result.md", content: "a" },
        { name: "result.md", content: "b" }
      ]
    }
  ])("rejects unsafe or ambiguous file output before tool execution (%#)", async (draft) => {
    const f = await fixture({ draft });
    await f.coordinator.execute(f.work.id, "local-owner");
    expect(f.get()).toMatchObject({ status: "failed", error_code: "INVALID_MODEL_OUTPUT" });
    expect(
      f.policy.getOperation(f.project.id, "manager-work:" + f.work.id + ":policy:2")
    ).toBeNull();
  });

  it("stops after one failed provider call even when Gateway is configured for five attempts", async () => {
    const f = await fixture({ retry: true });
    await f.coordinator.execute(f.work.id, "local-owner");
    expect(f.calls).toHaveLength(1);
    expect(f.get()).toMatchObject({ model_requests: 1, error_code: "PROVIDER_ERROR" });
  });

  it("enforces project usage limits before dispatch", async () => {
    const f = await fixture();
    const usage = new UsageStore(f.database.sqlite);
    usage.ensureLimit(f.project.id);
    usage.updateLimit(f.project.id, { expected_version: 1, max_total_tokens: 1, max_cost: null });
    await f.coordinator.execute(f.work.id, "local-owner");
    expect(f.calls).toHaveLength(0);
    expect(f.get().status).toBe("failed");
  });

  it("honors emergency stop and does not dispatch", async () => {
    const f = await fixture();
    f.emergency.activateProcess("stop");
    await f.coordinator.execute(f.work.id, "local-owner");
    expect(f.calls).toHaveLength(0);
    expect(f.get().error_code).toBe("EMERGENCY_STOP");
  });

  it("cancels an inflight request and retains its uncertain usage", async () => {
    let called!: () => void;
    const started = new Promise<void>((resolve) => {
      called = resolve;
    });
    const f = await fixture({
      onCall: (_request, signal) =>
        new Promise<void>((_resolve, reject) => {
          called();
          signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        })
    });
    f.coordinator.start();
    await started;
    f.coordinator.control(f.work.id, "local-owner", f.get().version, "cancel");
    await f.coordinator.stop();
    expect(f.get().status).toBe("cancelled");
    expect(
      new UsageStore(f.database.sqlite).getProjectSummary(f.project.id)?.tokens.reserved_upper_bound
    ).toBeGreaterThan(0);
    expect(f.calls).toHaveLength(1);
  });

  it("pauses at a durable boundary and resumes without repeating the plan", async () => {
    const f = await fixture({
      onCall: (req) => {
        if (req.task_type === "manager_work_plan") pause();
        return Promise.resolve();
      }
    });
    const pause = () => f.coordinator.control(f.work.id, "local-owner", f.get().version, "pause");
    await f.coordinator.execute(f.work.id, "local-owner");
    expect(f.get()).toMatchObject({ status: "paused", stage: "draft", inflight_run_id: null });
    f.coordinator.control(f.work.id, "local-owner", f.get().version, "resume");
    await new ManagerWorkCoordinator(f.dependencies).execute(f.work.id, "local-owner");
    expect(f.get().status).toBe("completed");
    expect(f.calls).toHaveLength(2);
  });

  it("recovers uncertain in-flight work without reissuing a provider request", async () => {
    const f = await fixture();
    const work = f.get();
    work.status = "running";
    work.inflight_run_id = "uncertain";
    f.store.save(work);
    expect(f.store.recover()).toBe(1);
    expect(f.get()).toMatchObject({ status: "failed", error_code: "RECOVERY_REQUIRED" });
    await f.coordinator.execute(f.work.id, "local-owner");
    expect(f.calls).toHaveLength(0);
  });

  it("does not bypass a revoked workspace capability", async () => {
    const f = await fixture();
    f.policy.updateProfile({
      projectId: f.project.id,
      baseLevel: "A0",
      overrides: [],
      expectedVersion: 2
    });
    await f.coordinator.execute(f.work.id, "local-owner");
    f.coordinator.control(f.work.id, "local-owner", f.get().version, "approve");
    await f.coordinator.execute(f.work.id, "local-owner");
    expect(f.get()).toMatchObject({ status: "blocked", error_code: "DENIED" });
    expect(f.store.file(f.work.id, "local-owner", "result.md")).toBeNull();
    f.policy.updateProfile({
      projectId: f.project.id,
      baseLevel: "A2",
      overrides: [],
      expectedVersion: 3
    });
    f.coordinator.control(f.work.id, "local-owner", f.get().version, "resume");
    await f.coordinator.execute(f.work.id, "local-owner");
    expect(f.get().status).toBe("completed");
    expect(f.calls).toHaveLength(2);
  });

  it("waits for a scoped one-time confirmation and resumes without regenerating files", async () => {
    const f = await fixture({
      onCall: (req) => {
        if (req.task_type === "manager_work_draft") {
          const profile = f.policy.getProfile(f.project.id)!;
          const digest = createHash("sha256")
            .update(
              JSON.stringify({
                files: [{ name: "result.md", content: "# Useful\nComplete document." }]
              })
            )
            .digest("hex");
          f.policy.updateProfile({
            projectId: f.project.id,
            baseLevel: "A2",
            expectedVersion: profile.version,
            overrides: [
              {
                override_id: "confirm-files",
                capability_id: "workspace.write",
                mode: "CONFIRM",
                object_ids: [f.work.id + "/result.md"],
                purpose: "Publish work files " + digest,
                valid_until: null,
                remaining_uses: 1
              }
            ]
          });
        }
        return Promise.resolve();
      }
    });
    await f.coordinator.execute(f.work.id, "local-owner");
    expect(f.get()).toMatchObject({ status: "blocked", error_code: "WAITING_CONFIRMATION" });
    const confirmation = f.policy.getConfirmation(f.get().confirmation_id!)!;
    expect(
      f.policy.decideConfirmation({
        confirmationId: confirmation.confirmation_id,
        challengeNonce: confirmation.challenge_nonce,
        decision: "approve",
        decidedBy: "local-owner",
        approvalMethod: "session"
      }).status
    ).toBe("APPROVED");
    f.coordinator.control(f.work.id, "local-owner", f.get().version, "resume");
    await f.coordinator.execute(f.work.id, "local-owner");
    expect(f.get().status).toBe("completed");
    expect(f.calls).toHaveLength(2);
  });

  it("keeps API controls owner/project scoped and downloads inert attachments", async () => {
    const f = await fixture();
    const app = buildApp({
      config: f.config,
      database: f.database,
      projectStore: f.projects,
      managerWorkStore: f.store,
      managerWorkCoordinator: f.coordinator
    });
    try {
      const other = f.projects.createProject("other", "other-source", "other-owner").project;
      const path = "/api/v1/projects/" + f.project.id + "/work/" + f.work.id;
      expect(
        (await app.inject({ url: "/api/v1/projects/" + other.id + "/work/" + f.work.id }))
          .statusCode
      ).toBe(404);
      expect((await app.inject({ url: path + "/files/result.md" })).statusCode).toBe(404);
      await f.coordinator.execute(f.work.id, "local-owner");
      const file = await app.inject({ url: path + "/files/result.md" });
      expect(file.statusCode).toBe(200);
      expect(file.headers["content-disposition"]).toContain("attachment");
      expect(file.headers["content-type"]).toContain("text/plain");
      expect(
        (
          await app.inject({
            method: "POST",
            url: path + "/control",
            payload: { version: f.get().version, action: "resume" }
          })
        ).statusCode
      ).toBe(409);
    } finally {
      await app.close();
    }
  });
  it.each(["missing", "changed"])(
    "refuses owner acceptance when a published file is %s",
    async (damage) => {
      const f = await fixture();
      await f.coordinator.execute(f.work.id, "local-owner");
      expect(f.get().status).toBe("completed");
      if (damage === "missing")
        f.database.sqlite
          .prepare("DELETE FROM manager_work_files WHERE execution_id = ?")
          .run(f.work.id);
      else
        f.database.sqlite
          .prepare("UPDATE manager_work_files SET content = 'damaged' WHERE execution_id = ?")
          .run(f.work.id);
      const before = f.get();
      const app = buildApp({
        config: f.config,
        database: f.database,
        projectStore: f.projects,
        managerWorkStore: f.store,
        managerWorkCoordinator: f.coordinator
      });
      try {
        const response = await app.inject({
          method: "POST",
          url: `/api/v1/projects/${f.project.id}/work/${f.work.id}/result/accept`,
          payload: { expected_version: before.version }
        });
        expect(response.statusCode).toBe(409);
        expect(response.json()).toEqual({ error: "ARTIFACT_INTEGRITY_MISMATCH" });
        expect(f.get()).toEqual(before);
      } finally {
        await app.close();
      }
    }
  );

  it("accepts a finished result over HTTP exactly once and refuses it before completion", async () => {
    const f = await fixture();
    const app = buildApp({
      config: f.config,
      database: f.database,
      projectStore: f.projects,
      managerWorkStore: f.store,
      managerWorkCoordinator: f.coordinator
    });
    try {
      const path = `/api/v1/projects/${f.project.id}/work/${f.work.id}/result/accept`;
      const notReady = await app.inject({
        method: "POST",
        url: path,
        payload: { expected_version: f.get().version }
      });
      expect(notReady.statusCode).toBe(409);
      expect(notReady.json()).toEqual({ error: "WORK_RESULT_NOT_READY" });

      await f.coordinator.execute(f.work.id, "local-owner");
      expect(f.get().status).toBe("completed");
      const accepted = await app.inject({
        method: "POST",
        url: path,
        payload: { expected_version: f.get().version }
      });
      expect(accepted.statusCode).toBe(200);
      const body = accepted.json<{ result_accepted_at: string; result_accepted_by: string }>();
      expect(body.result_accepted_at).toBeTruthy();
      expect(body.result_accepted_by).toBe("local-owner");

      const repeated = await app.inject({
        method: "POST",
        url: path,
        payload: { expected_version: f.get().version }
      });
      expect(repeated.statusCode).toBe(200);
      expect(repeated.json<{ result_accepted_at: string }>().result_accepted_at).toBe(
        body.result_accepted_at
      );
      expect(
        (
          await app.inject({
            method: "POST",
            url: path,
            payload: { expected_version: f.get().version + 99 }
          })
        ).statusCode
      ).toBe(409);
      expect(
        (
          await app.inject({
            method: "POST",
            url: path,
            payload: { expected_version: 0 }
          })
        ).statusCode
      ).toBe(400);
    } finally {
      await app.close();
    }
  });
});

describe("Work admission startup", () => {
  it("admits two concurrent slots and fences a third until a slot is released", async () => {
    let secondRun: Promise<void> | undefined;
    const probe = admissionProbe(() => {
      secondRun = f.coordinator.execute(second.id, "local-owner");
    });
    const f = await fixture({
      graph: probe.graph,
      request: { ...request, goal: admissionBrief.goal },
      draft: { files: [{ name: "result.md", content: admissionBrief.content }] }
    });
    const project = f.projects.createProject("Independent", "admission-second").project;
    f.policy.ensureProfile(project.id);
    f.policy.updateProfile({
      projectId: project.id,
      baseLevel: "A2",
      overrides: [],
      expectedVersion: 1
    });
    const second = f.store.create(project.id, "local-owner", "local-owner", {
      ...request,
      client_request_id: "admission-second",
      goal: admissionBrief.goal
    })!;
    const third = f.store.create(project.id, "local-owner", "local-owner", {
      ...request,
      client_request_id: "admission-third",
      goal: admissionBrief.goal
    })!;
    const running = f.coordinator.execute(f.work.id, "local-owner");
    try {
      expect(probe.stats()).toEqual({ reads: 2, active: 2, peak: 2 });
      expect(f.coordinator.hasActiveExecution(f.work.id)).toBe(true);
      expect(f.coordinator.hasActiveExecution(second.id)).toBe(true);
      expect(f.store.get(third.id, "local-owner")?.status).toBe("queued");
      expect(f.calls).toHaveLength(0);
    } finally {
      probe.release();
      await Promise.allSettled([running, secondRun]);
    }
    await f.coordinator.execute(third.id, "local-owner");
    const app = buildApp({
      config: f.config,
      database: f.database,
      projectStore: f.projects,
      managerWorkStore: f.store,
      managerWorkCoordinator: f.coordinator
    });
    try {
      const artifacts = [];
      for (const [projectId, id] of [
        [f.project.id, f.work.id],
        [project.id, second.id],
        [project.id, third.id]
      ] as const) {
        expect(f.store.get(id, "local-owner")?.status).toBe("completed");
        const result = await app.inject({
          url: `/api/v1/projects/${projectId}/work/${id}/files/result.md`
        });
        expect(result.statusCode).toBe(200);
        expect(result.body).toBe(admissionBrief.content);
        const metadata = f.store.runtime.artifacts(projectId, "local-owner", id)[0]!;
        expect(metadata.sha256).toBe(createHash("sha256").update(result.body).digest("hex"));
        artifacts.push({
          content: result.body,
          sha256: metadata.sha256,
          version: metadata.version
        });
      }
      expect(probe.stats().peak).toBe(2);
      expect(f.calls).toHaveLength(6);
      const directory = process.env.KOSWORK_ADMISSION_REPORT_DIR;
      if (directory) {
        mkdirSync(directory, { recursive: true });
        writeFileSync(
          join(directory, "result.json"),
          JSON.stringify(
            {
              input: admissionBrief,
              peak_context_reads: probe.stats().peak,
              provider: "local fixture",
              real_model_called: false,
              model_requests: f.calls.length,
              artifacts
            },
            null,
            2
          ) + "\n",
          { flag: "wx" }
        );
      }
    } finally {
      await app.close();
    }
  });

  it("keeps a startup privacy drain pending until the graph read settles", async () => {
    let drain: Promise<void> | undefined,
      settled = false;
    let contextSignal: AbortSignal | undefined;
    const probe = admissionProbe((signal) => {
      contextSignal = signal;
      f.database.sqlite
        .prepare(
          "INSERT INTO kosmora_owner_data_lifecycle(owner_id,state,epoch,operation_id,started_at,updated_at) VALUES('local-owner','quiescing',1,'admission-test','now','now')"
        )
        .run();
      drain = f.coordinator.quiesceOwner("local-owner");
      void drain.then(() => {
        settled = true;
      });
    });
    const f = await fixture({ graph: probe.graph });
    const running = f.coordinator.execute(f.work.id, "local-owner");
    try {
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(settled).toBe(false);
      expect(contextSignal?.aborted).toBe(true);
      expect(f.coordinator.hasActiveExecution(f.work.id)).toBe(true);
      expect(f.calls).toHaveLength(0);
    } finally {
      probe.release();
      await running;
      await drain;
      f.database.sqlite
        .prepare(
          "UPDATE kosmora_owner_data_lifecycle SET state='active' WHERE owner_id='local-owner'"
        )
        .run();
      f.coordinator.resumeOwner("local-owner");
    }
    expect(f.calls).toHaveLength(0);
    expect(f.store.file(f.work.id, "local-owner", "result.md")).toBeNull();
    expect(f.coordinator.hasActiveExecution(f.work.id)).toBe(false);
  });

  it("keeps startup shutdown pending and aborts before any provider request", async () => {
    let stopping: Promise<void> | undefined,
      stopped = false;
    let contextSignal: AbortSignal | undefined;
    const probe = admissionProbe((signal) => {
      contextSignal = signal;
      stopping = f.coordinator.stop();
      void stopping.then(() => {
        stopped = true;
      });
    });
    const f = await fixture({ graph: probe.graph });
    const running = f.coordinator.execute(f.work.id, "local-owner");
    try {
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(stopped).toBe(false);
      expect(contextSignal?.aborted).toBe(true);
    } finally {
      probe.release();
      await running;
      await stopping;
    }
    expect(f.calls).toHaveLength(0);
    expect(f.store.file(f.work.id, "local-owner", "result.md")).toBeNull();
    expect(f.coordinator.hasActiveExecution(f.work.id)).toBe(false);
  });
});

describe("Work metered invalid replies", () => {
  it.each([
    ["plan", "manager_work_plan", 1],
    ["draft", "manager_work_draft", 2],
    ["review", "manager_work_review", 3]
  ] as const)(
    "keeps known usage for a blank %s without publishing or retrying",
    async (stage, taskType, calls) => {
      const blank = " \n\t ";
      const f = await fixture({
        request: { ...request, goal: admissionBrief.goal, require_critic: stage === "review" },
        chunksFor: (req) => (req.task_type === taskType ? [blank] : undefined)
      });
      const ceiling = f.accountStore.get("local-owner").max_total_tokens;
      await f.coordinator.execute(f.work.id, "local-owner");
      const state = f.get();
      expect(state).toMatchObject({
        status: "failed",
        error_code: "INVALID_MODEL_OUTPUT",
        stage,
        model_requests: calls
      });
      expect(f.calls).toHaveLength(calls);
      expect(f.store.file(f.work.id, "local-owner", "result.md")).toBeNull();
      const runId = state.inflight_run_id!;
      const usage = f.projects.getModelUsageForRun(runId)[0]!;
      expect(usage).toMatchObject({
        status: "committed",
        actual_input_tokens: 100,
        actual_output_tokens: 100
      });
      expect(f.projects.getRun(runId)?.status).toBe("succeeded");
      expect(f.accountStore.summary("local-owner")).toMatchObject({
        total_counted_tokens: calls * 200,
        model_tokens_or_upper_bound: calls * 200,
        in_flight_or_uncertain_holds: 0,
        max_total_tokens: ceiling
      });
      expect(state.owner_budget_hold_id).toBeNull();
      await f.coordinator.execute(f.work.id, "local-owner");
      expect(f.calls).toHaveLength(calls);
      const app = buildApp({
        config: f.config,
        database: f.database,
        projectStore: f.projects,
        managerWorkStore: f.store,
        managerWorkCoordinator: f.coordinator
      });
      try {
        const base = `/api/v1/projects/${f.project.id}/work/${f.work.id}`;
        const response = await app.inject({ url: base });
        expect(response.statusCode).toBe(200);
        expect(response.json()).toMatchObject({
          status: "failed",
          error_code: "INVALID_MODEL_OUTPUT"
        });
        const download = await app.inject({ url: base + "/files/result.md" });
        expect(download.statusCode).toBe(404);
        if (stage === "plan" && process.env.KOSWORK_METERED_REPORT_DIR) {
          const directory = process.env.KOSWORK_METERED_REPORT_DIR;
          mkdirSync(directory, { recursive: true });
          writeFileSync(
            join(directory, "result.json"),
            JSON.stringify(
              {
                input: {
                  goal: admissionBrief.goal,
                  provider_reply: blank,
                  usage: { inputTokens: 100, outputTokens: 100 }
                },
                real_model_called: false,
                provider: "local fixture",
                model_requests: f.calls.length,
                work: { status: state.status, stage: state.stage, error_code: state.error_code },
                ledger: {
                  status: usage.status,
                  input_tokens: usage.actual_input_tokens,
                  output_tokens: usage.actual_output_tokens
                },
                account: f.accountStore.summary("local-owner"),
                file_download_status: download.statusCode
              },
              null,
              2
            ) + "\n",
            { flag: "wx" }
          );
        }
      } finally {
        await app.close();
      }
    }
  );

  it.each([
    { inputTokens: 0, outputTokens: 0 },
    { inputTokens: 100, outputTokens: 0 }
  ])(
    "settles fully reported zero counts $inputTokens/$outputTokens on an empty reply",
    async (usage) => {
      const f = await fixture({ chunks: [""], usage });
      await f.coordinator.execute(f.work.id, "local-owner");
      expect(f.get()).toMatchObject({ status: "failed", error_code: "INVALID_MODEL_OUTPUT" });
      expect(f.accountStore.summary("local-owner").total_counted_tokens).toBe(
        usage.inputTokens + usage.outputTokens
      );
      expect(f.get().owner_budget_hold_id).toBeNull();
      expect(f.store.file(f.work.id, "local-owner", "result.md")).toBeNull();
      expect(f.calls).toHaveLength(1);
    }
  );

  it.each([
    { inputTokens: null, outputTokens: null },
    { inputTokens: null, outputTokens: 100 },
    { inputTokens: 100, outputTokens: null }
  ])(
    "preserves unknown usage $inputTokens/$outputTokens without turning it into free output",
    async (usage) => {
      const f = await fixture({ chunks: [""], usage });
      await f.coordinator.execute(f.work.id, "local-owner");
      const state = f.get();
      expect(state).toMatchObject({ status: "failed", error_code: "INVALID_MODEL_OUTPUT" });
      const ledger = f.projects.getModelUsageForRun(state.inflight_run_id!)[0]!;
      expect(ledger).toMatchObject({
        status: "committed",
        actual_input_tokens: usage.inputTokens,
        actual_output_tokens: usage.outputTokens
      });
      expect(ledger.calculated_cost_amount).toBeNull();
      expect(f.accountStore.summary("local-owner").total_counted_tokens).toBe(
        ledger.estimated_input_tokens + ledger.max_output_tokens
      );
      const holds = f.database.sqlite
        .prepare("SELECT status FROM kosmora_usage_holds WHERE owner_id=?")
        .all("local-owner");
      expect(holds).toEqual([{ status: "uncertain" }]);
      expect(new AccountStore(f.database.sqlite).summary("local-owner")).toEqual(
        f.accountStore.summary("local-owner")
      );
      expect(f.calls).toHaveLength(1);
      expect(f.store.file(f.work.id, "local-owner", "result.md")).toBeNull();
    }
  );
});

describe("Work completion accounting before transport settlement", () => {
  it.each([
    {
      stage: "plan",
      task: "manager_work_plan",
      calls: 1,
      usage: { inputTokens: 100, outputTokens: 100 }
    },
    {
      stage: "draft",
      task: "manager_work_draft",
      calls: 2,
      usage: { inputTokens: 100, outputTokens: 100 }
    },
    {
      stage: "review",
      task: "manager_work_review",
      calls: 3,
      usage: { inputTokens: 100, outputTokens: 100 }
    },
    {
      stage: "plan",
      task: "manager_work_plan",
      calls: 1,
      usage: { inputTokens: 0, outputTokens: 0 }
    },
    {
      stage: "plan",
      task: "manager_work_plan",
      calls: 1,
      usage: { inputTokens: null, outputTokens: 100 }
    }
  ])(
    "retains accepted $stage usage $usage after a trailing transport failure",
    async ({ stage, task, calls, usage }) => {
      const f = await fixture({
        request: { ...request, require_critic: stage === "review" },
        usage,
        afterCompletion: (req) => {
          if (req.task_type === task)
            throw new GatewayRunError(
              "PROVIDER_ERROR",
              "mock",
              "fixture transport failed after completion",
              false
            );
        }
      });
      await f.coordinator.execute(f.work.id, "local-owner");
      const state = f.get();
      expect(state).toMatchObject({
        status: "failed",
        stage,
        error_code: "PROVIDER_ERROR",
        model_requests: calls
      });
      const ledger = f.projects.getModelUsageForRun(state.inflight_run_id!)[0]!;
      expect(ledger).toMatchObject({
        status: "committed",
        actual_input_tokens: usage.inputTokens,
        actual_output_tokens: usage.outputTokens
      });
      expect(state.owner_budget_hold_id).toBeNull();
      expect(f.projects.getRun(state.inflight_run_id!)?.status).toBe("succeeded");
      const account = f.accountStore.summary("local-owner");
      expect(account.total_counted_tokens).toBe(
        calls *
          (usage.inputTokens === null
            ? ledger.estimated_input_tokens + ledger.max_output_tokens
            : usage.inputTokens + usage.outputTokens)
      );
      // Canonical committed attempts already contribute to the total; the summary
      // excludes their hold to avoid counting the same upper bound twice.
      expect(account.in_flight_or_uncertain_holds).toBe(0);
      const holds = f.database.sqlite
        .prepare("SELECT status FROM kosmora_usage_holds WHERE owner_id=?")
        .all("local-owner");
      expect(holds).toEqual(usage.inputTokens === null ? [{ status: "uncertain" }] : []);
      expect(f.store.file(f.work.id, "local-owner", "result.md")).toBeNull();
      expect(f.calls).toHaveLength(calls);
      expect(f.store.recover()).toBe(0);
      await new ManagerWorkCoordinator(f.dependencies).execute(f.work.id, "local-owner");
      expect(f.calls).toHaveLength(calls);
      const app = buildApp({
        config: f.config,
        database: f.database,
        projectStore: f.projects,
        managerWorkStore: f.store,
        managerWorkCoordinator: f.coordinator
      });
      try {
        const base = `/api/v1/projects/${f.project.id}/work/${f.work.id}`;
        const response = await app.inject({ url: base });
        const download = await app.inject({ url: base + "/files/result.md" });
        expect(response.statusCode).toBe(200);
        expect(response.json()).toMatchObject({ status: "failed", error_code: "PROVIDER_ERROR" });
        expect(download.statusCode).toBe(404);
        if (
          stage === "plan" &&
          usage.inputTokens === 100 &&
          process.env.KOSWORK_TRAILING_REPORT_DIR
        ) {
          const directory = process.env.KOSWORK_TRAILING_REPORT_DIR;
          mkdirSync(directory, { recursive: true });
          writeFileSync(
            join(directory, "result.json"),
            JSON.stringify(
              {
                input: {
                  goal: request.goal,
                  stage,
                  provider_usage: usage,
                  transport_failure: "after accepted response.completed"
                },
                real_model_called: false,
                provider: "local fixture",
                model_requests: f.calls.length,
                work: {
                  status: state.status,
                  stage: state.stage,
                  error_code: state.error_code,
                  owner_budget_hold_id: state.owner_budget_hold_id
                },
                ledger: {
                  status: ledger.status,
                  input_tokens: ledger.actual_input_tokens,
                  output_tokens: ledger.actual_output_tokens
                },
                account,
                work_http_status: response.statusCode,
                file_download_status: download.statusCode,
                recovery_replayed_provider: false
              },
              null,
              2
            ) + "\n",
            { flag: "wx" }
          );
        }
      } finally {
        await app.close();
      }
    }
  );

  it("keeps known usage when cancellation follows the completion event without publishing", async () => {
    const f = await fixture({
      afterCompletion: () => {
        f.coordinator.control(f.work.id, "local-owner", f.get().version, "cancel");
      }
    });
    await f.coordinator.execute(f.work.id, "local-owner");
    const state = f.get();
    expect(state.status).toBe("cancelled");
    expect(f.projects.getModelUsageForRun(state.inflight_run_id!)[0]).toMatchObject({
      status: "committed",
      actual_input_tokens: 100,
      actual_output_tokens: 100
    });
    expect(f.accountStore.summary("local-owner")).toMatchObject({
      total_counted_tokens: 200,
      in_flight_or_uncertain_holds: 0
    });
    expect(f.store.file(f.work.id, "local-owner", "result.md")).toBeNull();
    await f.coordinator.execute(f.work.id, "local-owner");
    expect(f.calls).toHaveLength(1);
  });
});
