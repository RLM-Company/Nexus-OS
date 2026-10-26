import { loadServerConfig } from "@cosmora/config";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
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
import { buildApp } from "../src/app.js";
import { ManagerWorkCoordinator, type WorkOwnerBudget } from "../src/manager-work-coordinator.js";
import { buildModelRuntime, loadModelRegistryDocument } from "../src/model-runtime.js";
import { AccountStore } from "../src/account-settings/account-store.js";
import { GAME_FIXTURES } from "./fixtures/game-packages.js";
import type { GameGenre } from "@cosmora/contracts/game-package";
import { GAME_SOURCE_FILES } from "./fixtures/game-source.js";

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
  const project = projects.createProject("test", "source").project;
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
      yield { type: "text.delta", delta: JSON.stringify(result) };
      yield {
        type: "response.completed",
        provider: "mock",
        model: "manager-b0.1",
        finishReason: "stop",
        usage: { inputTokens: 100, outputTokens: 100 }
      };
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
    manager: runtime.manager,
    ...(options.graph ? { graph: options.graph } : {}),
    ownerBudget: options.ownerBudget ?? accountStore
  };
  const coordinator = new ManagerWorkCoordinator(dependencies);
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
    calls,
    coordinator,
    work,
    get,
    dependencies,
    config
  };
}

describe("durable Manager work", () => {
  it("accepts game source projects over HTTP and preserves all three code artifacts", async () => {
    const f = await fixture({ draft: { files: GAME_SOURCE_FILES } });
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
    } finally {
      await app.close();
      await f.coordinator.stop();
    }
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
});
