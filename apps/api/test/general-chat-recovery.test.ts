import { mkdtempSync, rmSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadServerConfig } from "@cosmora/config";
import { openDatabase, ProjectStore, runMigrations } from "@cosmora/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { GeneralChatRuntimeStore } from "../src/general-chat-runtime-store.js";
import { GeneralChatBackgroundRunCoordinator } from "../src/general-chat-background-run-coordinator.js";
import { AccountStore } from "../src/account-settings/account-store.js";
import { RuntimeMetrics } from "../src/operations.js";
import { buildModelRuntime } from "../src/model-runtime.js";

describe("ordinary chat durable recovery over HTTP", () => {
  const config = loadServerConfig({ NODE_ENV: "test", MOCK_PROVIDER_MODE: "success" });
  let directory: string;
  let filename: string;
  let database: ReturnType<typeof openDatabase>;
  let store: GeneralChatRuntimeStore;
  let runtime: Awaited<ReturnType<typeof buildModelRuntime>>;
  let app: ReturnType<typeof buildApp>;
  let modelCalls: number;
  const createApp = () =>
    buildApp({
      config,
      database,
      generalChatStore: store,
      projectStore: new ProjectStore(database.sqlite),
      modelGateway: runtime.gateway,
      chat: runtime.chat,
      generalChatRunExecutionMode: "background"
    });

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), "kosmora-chat-recovery-"));
    filename = join(directory, "chat.sqlite");
    database = openDatabase(filename);
    await runMigrations(database);
    store = new GeneralChatRuntimeStore(database.sqlite);
    runtime = await buildModelRuntime(config);
    modelCalls = 0;
    const originalStream = runtime.gateway.stream.bind(runtime.gateway);
    vi.spyOn(runtime.gateway, "stream").mockImplementation((request, signal) => {
      modelCalls++;
      return originalStream(request, signal);
    });
    app = createApp();
  });
  afterEach(async () => {
    await app.close();
    database.close();
    for (const suffix of ["", "-wal", "-shm", "-journal"])
      rmSync(filename + suffix, { force: true });
    rmdirSync(directory);
  });

  it.each(["failed", "cancelled"] as const)(
    "replays the saved partial answer before the %s event without a model call",
    async (terminal) => {
      const accepted = store.createChat("Original question", "partial-" + terminal);
      const assistant = store.startAssistantMessage(accepted.run.id)!;
      store.appendAssistantDelta(assistant.id, "Сохранённая часть ответа");
      if (terminal === "failed") store.failRun(accepted.run.id, "PROVIDER_ERROR");
      else store.cancelRun(accepted.run.id);
      const response = await app.inject({
        method: "GET",
        url: `/api/v1/chat-runs/${accepted.run.id}/events`
      });
      expect(response.statusCode).toBe(200);
      expect(response.body).toContain("event: message.started");
      expect(response.body).toContain("Сохранённая часть ответа");
      expect(response.body).toContain("event: run." + terminal);
      expect(response.body.indexOf("event: message.delta")).toBeLessThan(
        response.body.indexOf("event: run." + terminal)
      );
      expect(response.body).not.toContain("event: run.completed");
      expect(modelCalls).toBe(0);
    }
  );

  it.each(["failed", "cancelled"] as const)(
    "delivers the last saved text when an observed run becomes %s",
    async (terminal) => {
      const accepted = store.createChat("Observe persisted data", "observed-" + terminal);
      const assistant = store.startAssistantMessage(accepted.run.id)!;
      store.appendAssistantDelta(assistant.id, "First ");
      const timer = setTimeout(() => {
        store.appendAssistantDelta(assistant.id, "last");
        if (terminal === "failed") store.failRun(accepted.run.id, "PROVIDER_ERROR");
        else store.cancelRun(accepted.run.id);
      }, 10);
      try {
        const response = await app.inject({
          method: "GET",
          url: `/api/v1/chat-runs/${accepted.run.id}/events`
        });
        const deltas = response.body
          .split("\n\n")
          .filter((chunk) => chunk.startsWith("event: message.delta\n"))
          .map((chunk) => JSON.parse(chunk.split("\ndata: ")[1]!) as { data: { delta: string } });
        expect(deltas.map((event) => event.data.delta).join("")).toBe("First last");
        expect(response.body).toContain("event: run." + terminal);
        expect(modelCalls).toBe(0);
      } finally {
        clearTimeout(timer);
      }
    }
  );

  it("reopens a crashed claimed run from disk and handles a repeated POST without a second execution", async () => {
    const original = { initial_message: "Не потерять вопрос", client_message_id: "restart-client" };
    const first = await app.inject({ method: "POST", url: "/api/v1/chats", payload: original });
    const accepted = first.json<{ chat: { id: string }; run_id: string; stream_url: string }>();
    expect(first.statusCode).toBe(201);
    expect(store.claimQueuedGeneralChatRun(accepted.run_id)).toBe(true);
    await app.close();
    database.close();
    database = openDatabase(filename);
    await runMigrations(database);
    store = new GeneralChatRuntimeStore(database.sqlite);
    expect(store.recoverInterruptedRuns()).toBe(1);
    app = createApp();
    const replayedPost = await app.inject({
      method: "POST",
      url: "/api/v1/chats",
      payload: original
    });
    expect(replayedPost.statusCode).toBe(200);
    expect(replayedPost.json<{ run_id: string }>().run_id).toBe(accepted.run_id);
    const history = await app.inject({ method: "GET", url: `/api/v1/chats/${accepted.chat.id}` });
    expect(history.statusCode).toBe(200);
    expect(history.json<{ messages: Array<{ role: string; status: string }> }>().messages).toEqual([
      expect.objectContaining({ role: "user", status: "completed" }),
      expect.objectContaining({ role: "assistant", status: "failed" })
    ]);
    const events = await app.inject({ method: "GET", url: accepted.stream_url });
    expect(events.body).toContain("INTERRUPTED_BY_RESTART");
    expect(events.body).toContain("event: run.failed");
    const next = await app.inject({
      method: "POST",
      url: `/api/v1/chats/${accepted.chat.id}/messages`,
      payload: { content: "Продолжаем", client_message_id: "after-restart" }
    });
    expect(next.statusCode).toBe(202);
    expect(modelCalls).toBe(0);
  });

  it("reports a run removed during observation instead of leaving the observer waiting", async () => {
    const accepted = store.createChat("Remove in another window", "removed-run");
    store.startAssistantMessage(accepted.run.id);
    const timer = setTimeout(() => {
      store.cancelRun(accepted.run.id);
      store.deleteChat(accepted.chat.id, "local-owner");
    }, 10);
    try {
      const events = await app.inject({
        method: "GET",
        url: `/api/v1/chat-runs/${accepted.run.id}/events`
      });
      expect(events.body).toContain("RUN_NOT_FOUND");
      expect(events.body).toContain("event: run.failed");
      expect(modelCalls).toBe(0);
    } finally {
      clearTimeout(timer);
    }
  });

  it("does not expose another owner's persisted partial answer", async () => {
    const accepted = store.createChat("Private question", "private-owner", "other-owner");
    const assistant = store.startAssistantMessage(accepted.run.id, "other-owner")!;
    store.appendAssistantDelta(assistant.id, "Private partial");
    store.failRun(accepted.run.id, "PROVIDER_ERROR");
    const response = await app.inject({
      method: "GET",
      url: `/api/v1/chat-runs/${accepted.run.id}/events`
    });
    expect(response.statusCode).toBe(404);
    expect(response.body).not.toContain("Private partial");
    expect(modelCalls).toBe(0);
  });

  it("keeps one background generation alive when one of two HTTP observers disconnects", async () => {
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const upstream = await buildModelRuntime(config);
    vi.spyOn(runtime.gateway, "stream").mockImplementation(async function* (request, signal) {
      modelCalls++;
      for await (const event of upstream.gateway.stream(request, signal)) {
        if (event.type === "text.delta") {
          started.resolve();
          await release.promise;
        }
        yield event;
      }
    });
    const accountStore = new AccountStore(database.sqlite);
    accountStore.migrate();
    const coordinator = new GeneralChatBackgroundRunCoordinator({
      store,
      modelGateway: runtime.gateway,
      chat: runtime.chat,
      runtimeMetrics: new RuntimeMetrics(),
      accountStore,
      pollIntervalMs: 10
    });
    const accepted = store.createChat("One generation, two observers", "disconnect-observer");
    const origin = await app.listen({ port: 0, host: "127.0.0.1" });
    const controller = new AbortController();
    const firstResponse = await fetch(`${origin}/api/v1/chat-runs/${accepted.run.id}/events`, {
      signal: controller.signal
    });
    const first = firstResponse.text().catch(() => null);
    const second = app
      .inject({ method: "GET", url: `/api/v1/chat-runs/${accepted.run.id}/events` })
      .then((response) => response);
    coordinator.start();
    try {
      await started.promise;
      controller.abort();
      await first;
      release.resolve();
      const response = await second;
      expect(response.body).toContain("event: run.completed");
      expect(store.getRun(accepted.run.id)?.status).toBe("succeeded");
      expect(modelCalls).toBe(1);
      expect(store.getModelUsageForRun(accepted.run.id)).toHaveLength(1);
    } finally {
      controller.abort();
      release.resolve();
      await coordinator.stop();
      await second;
    }
  });

  it("closes a queued HTTP observer on server shutdown without dispatching a model", async () => {
    const accepted = store.createChat("Wait in queue", "shutdown-observer");
    const origin = await app.listen({ port: 0, host: "127.0.0.1" });
    const controller = new AbortController();
    try {
      const response = await fetch(`${origin}/api/v1/chat-runs/${accepted.run.id}/events`, {
        signal: controller.signal
      });
      const body = response.text();
      await app.close();
      expect(await body).not.toContain("event: run.completed");
      expect(store.getRun(accepted.run.id)?.status).toBe("queued");
      expect(modelCalls).toBe(0);
    } finally {
      controller.abort();
    }
  });
});
