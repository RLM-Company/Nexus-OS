import { loadServerConfig } from "@cosmora/config";
import { EmergencyStopStore, openDatabase, runMigrations } from "@cosmora/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ManagerBackgroundRunCoordinator } from "../src/manager-background-run-coordinator.js";
import { ManagerRuntimeProjectStore } from "../src/manager-runtime-project-store.js";
import { buildModelRuntime } from "../src/model-runtime.js";
import { RuntimeMetrics } from "../src/operations.js";

describe("ManagerBackgroundRunCoordinator", () => {
  const config = loadServerConfig({
    NODE_ENV: "test",
    MOCK_PROVIDER_MODE: "slow_stream",
    MANAGER_TIMEOUT_MS: "5000"
  });
  let database: ReturnType<typeof openDatabase>;
  let store: ManagerRuntimeProjectStore;
  let stopStore: EmergencyStopStore;
  let metrics: RuntimeMetrics;
  let coordinator: ManagerBackgroundRunCoordinator;

  beforeEach(async () => {
    database = openDatabase(":memory:");
    await runMigrations(database);
    const runtime = await buildModelRuntime(config);
    store = new ManagerRuntimeProjectStore(database.sqlite);
    stopStore = new EmergencyStopStore(database.sqlite);
    metrics = new RuntimeMetrics();
    coordinator = new ManagerBackgroundRunCoordinator({
      store,
      modelGateway: runtime.gateway,
      manager: runtime.manager,
      runtimeMetrics: metrics,
      emergencyStopStore: stopStore,
      pollIntervalMs: 10,
      controlPollIntervalMs: 10,
      maxConcurrentRuns: 2
    });
    coordinator.start();
  });

  afterEach(async () => {
    await coordinator.stop();
    database.close();
  });

  it("executes a queued Manager run without any SSE consumer", async () => {
    const accepted = store.createProject(
      "Выполни задачу даже если вкладка не открывала поток",
      "background-without-sse-1"
    );

    await vi.waitFor(() => expect(store.getRun(accepted.run.id)?.status).toBe("succeeded"), {
      timeout: 3_000
    });

    expect(store.getAssistantMessage(accepted.run.id)).toMatchObject({
      status: "completed",
      error_code: null
    });
    expect(store.getAssistantMessage(accepted.run.id)?.content).toContain("Выполни задачу");
    expect(store.getModelUsageForRun(accepted.run.id)).toEqual([
      expect.objectContaining({ status: "committed", provider_id: "mock", error_code: null })
    ]);
    expect(metrics.snapshot(stopStore, 0)).toMatchObject({
      active_runs: 0,
      metrics: { runs_started: 1, runs_completed: 1, route_attempts: 1 }
    });
  });

  it("observes an explicit owner cancellation and does not relabel it as failure", async () => {
    const accepted = store.createProject("Запусти длинный ответ", "background-cancel-1");

    await vi.waitFor(
      () => {
        expect(store.getRun(accepted.run.id)?.status).toBe("running");
        expect(store.getModelUsageForRun(accepted.run.id)).toHaveLength(1);
      },
      { timeout: 2_000 }
    );

    expect(store.cancelRun(accepted.run.id)).toBe("cancelled");
    await vi.waitFor(() => expect(coordinator.activeRunCount).toBe(0), { timeout: 2_000 });

    expect(store.getRun(accepted.run.id)).toMatchObject({ status: "cancelled" });
    expect(store.getAssistantMessage(accepted.run.id)).toMatchObject({
      status: "cancelled",
      error_code: "CANCELLED_BY_OWNER"
    });
    expect(store.getModelUsageForRun(accepted.run.id)).toEqual([
      expect.objectContaining({ status: "cancelled", error_code: "CANCELLED_BY_OWNER" })
    ]);
    expect(metrics.snapshot(stopStore, 0).metrics).toMatchObject({
      runs_cancelled: 1,
      runs_failed: 0
    });
  });

  it("interrupts background execution when a project emergency stop appears", async () => {
    const accepted = store.createProject("Запусти до аварийного стопа", "background-stop-1");

    await vi.waitFor(
      () => {
        expect(store.getRun(accepted.run.id)?.status).toBe("running");
        expect(store.getModelUsageForRun(accepted.run.id)).toHaveLength(1);
      },
      { timeout: 2_000 }
    );

    stopStore.activateProject(
      accepted.project.id,
      "Background containment test",
      "owner:test",
      "local-owner"
    );

    await vi.waitFor(() => expect(store.getRun(accepted.run.id)?.status).toBe("failed"), {
      timeout: 2_000
    });

    expect(store.getAssistantMessage(accepted.run.id)).toMatchObject({
      status: "failed",
      error_code: "EMERGENCY_STOP"
    });
    expect(store.getModelUsageForRun(accepted.run.id)).toEqual([
      expect.objectContaining({ status: "failed", error_code: "EMERGENCY_STOP" })
    ]);
    expect(metrics.snapshot(stopStore, 0)).toMatchObject({
      active_runs: 0,
      active_project_stops: 1,
      metrics: { runs_failed: 1 }
    });
  });

  it("records coordinator shutdown as INTERRUPTED rather than owner cancellation", async () => {
    const accepted = store.createProject(
      "Останови runtime во время ответа",
      "background-shutdown-1"
    );

    await vi.waitFor(
      () => {
        expect(store.getRun(accepted.run.id)?.status).toBe("running");
        expect(store.getModelUsageForRun(accepted.run.id)).toHaveLength(1);
      },
      { timeout: 2_000 }
    );

    await coordinator.stop();

    expect(store.getRun(accepted.run.id)).toMatchObject({ status: "failed" });
    expect(store.getAssistantMessage(accepted.run.id)).toMatchObject({
      status: "failed",
      error_code: "INTERRUPTED"
    });
    expect(store.getModelUsageForRun(accepted.run.id)).toEqual([
      expect.objectContaining({ status: "failed", error_code: "INTERRUPTED" })
    ]);
    expect(metrics.snapshot(stopStore, 0).metrics).toMatchObject({
      runs_failed: 1,
      runs_cancelled: 0
    });
  });
});

describe("ManagerRuntimeProjectStore", () => {
  it("allows only one executor to create the assistant side of a claimed run", async () => {
    const database = openDatabase(":memory:");
    await runMigrations(database);
    try {
      const store = new ManagerRuntimeProjectStore(database.sqlite);
      const accepted = store.createProject(
        "Проверь единственного исполнителя",
        "single-executor-1"
      );

      expect(store.claimQueuedManagerRun(accepted.run.id)).toBe(true);
      expect(store.claimQueuedManagerRun(accepted.run.id)).toBe(false);
      expect(store.startAssistantMessage(accepted.run.id)).not.toBeNull();
      expect(store.startAssistantMessage(accepted.run.id)).toBeNull();
    } finally {
      database.close();
    }
  });
});
