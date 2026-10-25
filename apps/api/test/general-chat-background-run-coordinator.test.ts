import { loadServerConfig } from "@cosmora/config";
import {
  OwnerSkillStore,
  EmergencyStopStore,
  openDatabase,
  ProjectStore,
  runMigrations
} from "@cosmora/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { GeneralChatBackgroundRunCoordinator } from "../src/general-chat-background-run-coordinator.js";
import { GeneralChatRuntimeStore } from "../src/general-chat-runtime-store.js";
import { buildModelRuntime } from "../src/model-runtime.js";
import { RuntimeMetrics } from "../src/operations.js";
import { AccountStore } from "../src/account-settings/account-store.js";

describe("GeneralChatBackgroundRunCoordinator", () => {
  const config = loadServerConfig({
    NODE_ENV: "test",
    MOCK_PROVIDER_MODE: "slow_stream",
    MANAGER_TIMEOUT_MS: "5000"
  });
  let database: ReturnType<typeof openDatabase>;
  let store: GeneralChatRuntimeStore;
  let stopStore: EmergencyStopStore;
  let metrics: RuntimeMetrics;
  let coordinator: GeneralChatBackgroundRunCoordinator;
  let runtime: Awaited<ReturnType<typeof buildModelRuntime>>;
  let accountStore: AccountStore;

  beforeEach(async () => {
    database = openDatabase(":memory:");
    await runMigrations(database);
    accountStore = new AccountStore(database.sqlite);
    accountStore.migrate();
    runtime = await buildModelRuntime(config);
    store = new GeneralChatRuntimeStore(database.sqlite);
    stopStore = new EmergencyStopStore(database.sqlite);
    metrics = new RuntimeMetrics();
    coordinator = new GeneralChatBackgroundRunCoordinator({
      store,
      modelGateway: runtime.gateway,
      chat: runtime.chat,
      runtimeMetrics: metrics,
      emergencyStopStore: stopStore,
      accountStore,
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

  it("dispatches one explicit image request without also calling the text model", async () => {
    await coordinator.stop();
    const imageGeneration = vi.fn().mockResolvedValue("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    const textModel = vi.spyOn(runtime.gateway, "stream");
    coordinator = new GeneralChatBackgroundRunCoordinator({
      store,
      modelGateway: runtime.gateway,
      chat: runtime.chat,
      runtimeMetrics: metrics,
      accountStore,
      imageGeneration,
      pollIntervalMs: 10
    });
    coordinator.start();
    const accepted = store.createChat(
      "Нарисуй монохромный постер",
      "image-background-request",
      "local-owner"
    );
    await vi.waitFor(() => expect(store.getRun(accepted.run.id)?.status).toBe("succeeded"));
    expect(imageGeneration).toHaveBeenCalledTimes(1);
    expect(imageGeneration.mock.calls[0]?.slice(0, 2)).toEqual([
      "local-owner",
      "Нарисуй монохромный постер"
    ]);
    expect(textModel).not.toHaveBeenCalled();
    expect(store.getAssistantMessage(accepted.run.id)?.content).toContain("/api/v1/media/assets/");
  });

  it("does not dispatch a second image when the first generation fails", async () => {
    await coordinator.stop();
    const imageGeneration = vi.fn().mockRejectedValue(new Error("provider unavailable"));
    const textModel = vi.spyOn(runtime.gateway, "stream");
    coordinator = new GeneralChatBackgroundRunCoordinator({
      store,
      modelGateway: runtime.gateway,
      chat: runtime.chat,
      runtimeMetrics: metrics,
      imageGeneration,
      pollIntervalMs: 10
    });
    coordinator.start();
    const accepted = store.createChat("Создай изображение горы", "image-background-failure");
    await vi.waitFor(() => expect(store.getRun(accepted.run.id)?.status).toBe("failed"));
    expect(imageGeneration).toHaveBeenCalledTimes(1);
    expect(textModel).not.toHaveBeenCalled();
  });

  it("dispatches only the accepted Skill snapshot after catalog mutation, without an observer", async () => {
    const first = store.createChat("Начало", "skills-background-seed");
    store.cancelRun(first.run.id);
    const skills = new OwnerSkillStore(database.sqlite);
    const skill = skills.create("local-owner", {
      name: "Brief",
      summary: "Кратко",
      instructions: "PINNED_SKILL_V1"
    });
    store.skills.update(first.chat.id, "local-owner", 0, [{ skill_id: skill.id, version: 1 }]);
    const spy = vi.spyOn(runtime.gateway, "stream");
    const next = store.createMessage(first.chat.id, "Продолжение", "skills-background-next")!;
    skills.update("local-owner", skill.id, 1, {
      name: "Brief",
      summary: "Кратко",
      instructions: "DO_NOT_USE_V2"
    });
    skills.delete("local-owner", skill.id, 2);
    await vi.waitFor(() => expect(store.getRun(next.run.id)?.status).toBe("succeeded"), {
      timeout: 3000
    });
    expect(spy).toHaveBeenCalledTimes(1);
    const request = spy.mock.calls[0]![0];
    expect(request.messages.findLast((message) => message.role === "user")?.content).toContain(
      "PINNED_SKILL_V1"
    );
    expect(request.messages.some((message) => message.content.includes("DO_NOT_USE_V2"))).toBe(
      false
    );
    expect(request.messages[0]?.content).not.toContain("PINNED_SKILL_V1");
    expect(store.skills.get(first.chat.id, "local-owner").items).toEqual([]);
  });

  it("uses persisted chat memory when dispatching without an SSE observer", async () => {
    const first = store.createChat("Начало", "memory-background-seed");
    store.cancelRun(first.run.id);
    store.updateChatMemory(first.chat.id, "local-owner", "Отвечать на TypeScript", 0);
    const spy = vi.spyOn(runtime.gateway, "stream");
    const next = store.createMessage(first.chat.id, "Продолжение", "memory-background-next")!;
    await vi.waitFor(() => expect(store.getRun(next.run.id)?.status).toBe("succeeded"), {
      timeout: 3000
    });
    expect(spy).toHaveBeenCalledTimes(1);
    const request = spy.mock.calls[0]![0];
    expect(request.messages.findLast((message) => message.role === "user")?.content).toContain(
      "Отвечать на TypeScript"
    );
    expect(request.messages[0]?.content).not.toContain("Отвечать на TypeScript");
  });

  it("executes a queued ordinary-chat run without any SSE consumer", async () => {
    const accepted = store.createChat(
      "Ответь даже если вкладка не открывала поток",
      "chat-background-without-sse-1"
    );

    await vi.waitFor(() => expect(store.getRun(accepted.run.id)?.status).toBe("succeeded"), {
      timeout: 3_000
    });

    expect(store.getAssistantMessage(accepted.run.id)).toMatchObject({
      status: "completed",
      error_code: null
    });
    expect(store.getAssistantMessage(accepted.run.id)?.content).toContain("Ответь даже если");
    expect(store.getModelUsageForRun(accepted.run.id)).toEqual([
      expect.objectContaining({ status: "committed", provider_id: "mock", error_code: null })
    ]);
    expect(database.sqlite.prepare("SELECT COUNT(*) AS count FROM projects").get()).toMatchObject({
      count: 0
    });
    expect(metrics.snapshot(stopStore, 0)).toMatchObject({
      active_runs: 0,
      metrics: { runs_started: 1, runs_completed: 1, route_attempts: 1 }
    });
  });

  it("lets multiple SSE observers follow one server-owned execution", async () => {
    const app = buildApp({
      config,
      database,
      generalChatStore: store,
      projectStore: new ProjectStore(database.sqlite),
      emergencyStopStore: stopStore,
      modelGateway: runtime.gateway,
      chat: runtime.chat,
      manager: runtime.manager,
      runtimeMetrics: metrics,
      accountStore,
      generalChatRunExecutionMode: "background"
    });
    try {
      const created = await app.inject({
        method: "POST",
        url: "/api/v1/chats",
        payload: {
          initial_message: "Покажи один ответ двум наблюдателям",
          client_message_id: "chat-background-observers-1"
        }
      });
      const body = created.json<{ run_id: string; stream_url: string }>();

      const [first, second] = await Promise.all([
        app.inject({ method: "GET", url: body.stream_url }),
        app.inject({ method: "GET", url: body.stream_url })
      ]);

      expect(first.statusCode).toBe(200);
      expect(second.statusCode).toBe(200);
      expect(first.body).toContain("event: run.completed");
      expect(second.body).toContain("event: run.completed");
      expect(store.getModelUsageForRun(body.run_id)).toEqual([
        expect.objectContaining({ status: "committed", provider_id: "mock" })
      ]);
    } finally {
      await app.close();
    }
  });

  it("observes an explicit owner cancellation and does not relabel it as failure", async () => {
    const accepted = store.createChat("Запусти длинный ответ", "chat-background-cancel-1");

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

  it("interrupts background execution when a process emergency stop appears", async () => {
    const accepted = store.createChat("Запусти до аварийного стопа", "chat-background-stop-1");

    await vi.waitFor(
      () => {
        expect(store.getRun(accepted.run.id)?.status).toBe("running");
        expect(store.getModelUsageForRun(accepted.run.id)).toHaveLength(1);
      },
      { timeout: 2_000 }
    );

    stopStore.activateProcess("Background chat containment test", "owner:test");

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
    const snapshot = metrics.snapshot(stopStore, 0);
    expect(snapshot).toMatchObject({
      active_runs: 0,
      metrics: { runs_failed: 1 }
    });
    expect(snapshot.process_stop?.scope).toBe("process");
  });

  it("records coordinator shutdown as INTERRUPTED rather than owner cancellation", async () => {
    const accepted = store.createChat(
      "Останови runtime во время ответа",
      "chat-background-shutdown-1"
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

describe("GeneralChatRuntimeStore", () => {
  it("allows only one executor to create the assistant side of a claimed run", async () => {
    const database = openDatabase(":memory:");
    await runMigrations(database);
    try {
      const store = new GeneralChatRuntimeStore(database.sqlite);
      const accepted = store.createChat(
        "Проверь единственного исполнителя",
        "chat-single-executor-1"
      );

      expect(store.claimQueuedGeneralChatRun(accepted.run.id)).toBe(true);
      expect(store.claimQueuedGeneralChatRun(accepted.run.id)).toBe(false);
      expect(store.startAssistantMessage(accepted.run.id)).not.toBeNull();
      expect(store.startAssistantMessage(accepted.run.id)).toBeNull();
    } finally {
      database.close();
    }
  });
});
