import { loadServerConfig } from "@cosmora/config";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CreateManagerWork, ModelRequest } from "@cosmora/contracts";
import {
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
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { ManagerWorkCoordinator } from "../src/manager-work-coordinator.js";
import { buildModelRuntime, loadModelRegistryDocument } from "../src/model-runtime.js";

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
    plan?: object;
    draft?: object;
    review?: object;
    retry?: boolean;
    roles?: string[];
    databasePath?: string;
    onCall?: (request: ModelRequest, signal: AbortSignal) => Promise<void>;
  } = {}
) {
  const database = openDatabase(options.databasePath ?? ":memory:");
  resources.push(() => database.close());
  await runMigrations(database);
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
  const dependencies = { store, projects, policy, emergency, gateway, manager: runtime.manager };
  const coordinator = new ManagerWorkCoordinator(dependencies);
  const work = store.create(project.id, "local-owner", "local-owner", request)!;
  const get = () => store.get(work.id, "local-owner")!;
  return {
    database,
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
      emergency: new EmergencyStopStore(reopened.sqlite)
    });
    const restored = store.get(f.work.id, "local-owner")!;
    coordinator.control(restored.id, "local-owner", restored.version, "approve");
    await coordinator.execute(restored.id, "local-owner");
    expect(store.get(restored.id, "local-owner")?.status).toBe("completed");
    expect(f.calls).toHaveLength(2);
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
    expect(f.calls).toHaveLength(2);
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

  it("counts every retry and blocks the fourth provider call", async () => {
    const f = await fixture({ retry: true });
    await f.coordinator.execute(f.work.id, "local-owner");
    expect(f.calls).toHaveLength(3);
    expect(f.get()).toMatchObject({ model_requests: 3, error_code: "EXECUTION_BUDGET_EXCEEDED" });
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
