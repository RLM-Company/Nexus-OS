import { loadServerConfig } from "@cosmora/config";
import { EmergencyStopStore, openDatabase, ProjectStore, runMigrations } from "@cosmora/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { buildModelRuntime } from "../src/model-runtime.js";

describe("project chat API", () => {
  const config = loadServerConfig({
    NODE_ENV: "test",
    MOCK_PROVIDER_MODE: "slow_stream",
    MANAGER_TIMEOUT_MS: "5000"
  });
  let database: ReturnType<typeof openDatabase>;
  let projectStore: ProjectStore;
  let emergencyStopStore: EmergencyStopStore;
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    database = openDatabase(":memory:");
    await runMigrations(database);
    const runtime = buildModelRuntime(config);
    projectStore = new ProjectStore(database.sqlite);
    emergencyStopStore = new EmergencyStopStore(database.sqlite);
    app = buildApp({
      config,
      database,
      projectStore,
      emergencyStopStore,
      modelGateway: runtime.gateway,
      manager: runtime.manager
    });
  });

  afterEach(async () => {
    await app.close();
    database.close();
  });

  it("creates a project and reuses the idempotent request", async () => {
    const payload = { initial_message: "Создай digital-продукт", client_message_id: "client-1" };
    const first = await app.inject({ method: "POST", url: "/api/v1/projects", payload });
    const duplicate = await app.inject({ method: "POST", url: "/api/v1/projects", payload });

    expect(first.statusCode).toBe(201);
    expect(duplicate.statusCode).toBe(200);
    expect(duplicate.json<{ project: { id: string } }>().project.id).toBe(
      first.json<{ project: { id: string } }>().project.id
    );

    const projects = await app.inject({ method: "GET", url: "/api/v1/projects" });
    expect(projects.json<{ items: unknown[] }>().items).toHaveLength(1);

    const conflict = await app.inject({
      method: "POST",
      url: "/api/v1/projects",
      payload: { ...payload, initial_message: "Другой запрос" }
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json<{ error: { code: string } }>().error.code).toBe("IDEMPOTENCY_CONFLICT");
  });

  it("streams and persists the mock manager response", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/projects",
      payload: { initial_message: "Проверь сквозной сценарий", client_message_id: "client-2" }
    });
    const body = created.json<{ project: { id: string }; run_id: string; stream_url: string }>();

    const stream = await app.inject({ method: "GET", url: body.stream_url });
    expect(stream.statusCode).toBe(200);
    expect(stream.headers["content-type"]).toContain("text/event-stream");
    expect(stream.body).toContain("event: message.delta");
    expect(stream.body).toContain("event: run.completed");

    const project = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${body.project.id}`
    });
    expect(project.statusCode).toBe(200);
    const messages = project.json<{ messages: Array<{ role: string; status: string }> }>().messages;
    expect(messages).toHaveLength(2);
    expect(messages[1]).toMatchObject({ role: "assistant", status: "completed" });
    const usage = projectStore.getModelUsageForRun(body.run_id);
    expect(usage).toEqual([
      expect.objectContaining({
        status: "committed",
        registry_version: "b0.2-bootstrap-1",
        provider_id: "mock",
        model_requested: "manager-b0.1",
        model_resolved: "manager-b0.1",
        actual_output_tokens: 72,
        calculated_cost_amount: 0,
        currency: "USD"
      })
    ]);
    expect(typeof usage[0]?.actual_input_tokens).toBe("number");

    const projects = await app.inject({ method: "GET", url: "/api/v1/projects" });
    expect(projects.statusCode).toBe(200);
    const preview = projects.json<{ items: Array<{ last_message_preview: string | null }> }>()
      .items[0]?.last_message_preview;
    expect(preview?.length).toBeLessThanOrEqual(240);
  });

  it("persists every retry as a separate failed Usage Ledger attempt", async () => {
    await app.close();
    database.close();

    const retryConfig = loadServerConfig({
      NODE_ENV: "test",
      MOCK_PROVIDER_MODE: "provider_error",
      MODEL_MAX_ATTEMPTS_PER_ROUTE: "2",
      MODEL_RETRY_BASE_DELAY_MS: "0",
      MODEL_RETRY_MAX_DELAY_MS: "0"
    });
    database = openDatabase(":memory:");
    await runMigrations(database);
    const runtime = buildModelRuntime(retryConfig);
    projectStore = new ProjectStore(database.sqlite);
    emergencyStopStore = new EmergencyStopStore(database.sqlite);
    app = buildApp({
      config: retryConfig,
      database,
      projectStore,
      emergencyStopStore,
      modelGateway: runtime.gateway,
      manager: runtime.manager
    });

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/projects",
      payload: { initial_message: "Проверь retry ledger", client_message_id: "retry-ledger-1" }
    });
    const body = created.json<{ run_id: string; stream_url: string }>();
    const stream = await app.inject({ method: "GET", url: body.stream_url });

    expect(stream.body).toContain("event: run.failed");
    expect(projectStore.getModelUsageForRun(body.run_id)).toEqual([
      expect.objectContaining({ attempt: 0, status: "failed", error_code: "PROVIDER_ERROR" }),
      expect.objectContaining({ attempt: 1, status: "failed", error_code: "PROVIDER_ERROR" })
    ]);
  });

  it("returns typed not-found errors", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/projects/missing/messages",
      payload: { content: "Тест", client_message_id: "client-3" }
    });

    expect(response.statusCode).toBe(404);
    expect(response.json<{ error: { code: string } }>().error.code).toBe("PROJECT_NOT_FOUND");
  });

  it("blocks a queued run after a project emergency stop and reports operational status", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/projects",
      payload: { initial_message: "Не запускай модель", client_message_id: "stop-queued-1" }
    });
    const body = created.json<{ project: { id: string }; run_id: string; stream_url: string }>();

    const stopped = await app.inject({
      method: "POST",
      url: "/api/v1/operations/emergency-stop",
      payload: {
        scope: "project",
        project_id: body.project.id,
        reason: "Owner containment test"
      }
    });
    const stream = await app.inject({ method: "GET", url: body.stream_url });
    const status = await app.inject({ method: "GET", url: "/api/v1/operations/status" });

    expect(stopped.statusCode, stopped.body).toBe(200);
    expect(stopped.json()).toMatchObject({
      scope: "project",
      project_id: body.project.id,
      active: true
    });
    expect(stream.body).toContain('"error_code":"EMERGENCY_STOP"');
    expect(projectStore.getRun(body.run_id)).toMatchObject({ status: "failed" });
    expect(projectStore.getAssistantMessage(body.run_id)).toMatchObject({
      status: "failed",
      error_code: "EMERGENCY_STOP"
    });
    expect(status.json()).toMatchObject({
      active_runs: 0,
      process_stop: null,
      active_project_stops: 1,
      metrics: {
        runs_started: 0,
        runs_failed: 1,
        route_attempts: 0,
        route_failures: { EMERGENCY_STOP: 1 }
      },
      alerts: [expect.objectContaining({ code: "PROJECT_EMERGENCY_STOP" })]
    });
  });

  it("interrupts an active run with a process emergency stop", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/projects",
      payload: { initial_message: "Начни длинный ответ", client_message_id: "stop-active-1" }
    });
    const body = created.json<{ run_id: string; stream_url: string }>();
    const pendingStream = app.inject({ method: "GET", url: body.stream_url });

    await vi.waitFor(() => expect(projectStore.getRun(body.run_id)?.status).toBe("running"), {
      timeout: 2_000
    });
    const stopped = await app.inject({
      method: "POST",
      url: "/api/v1/operations/emergency-stop",
      payload: { scope: "process", reason: "Provider incident" }
    });
    const stream = await pendingStream;
    const status = await app.inject({ method: "GET", url: "/api/v1/operations/status" });

    expect(stopped.statusCode).toBe(200);
    expect(stream.body).toContain("event: run.failed");
    expect(stream.body).toContain('"error_code":"EMERGENCY_STOP"');
    expect(projectStore.getRun(body.run_id)).toMatchObject({ status: "failed" });
    expect(projectStore.getModelUsageForRun(body.run_id)).toEqual([
      expect.objectContaining({ status: "failed", error_code: "EMERGENCY_STOP" })
    ]);
    expect(status.json()).toMatchObject({
      active_runs: 0,
      process_stop: { scope: "process", active: true },
      metrics: { runs_started: 1, runs_failed: 1, route_attempts: 1 },
      alerts: [expect.objectContaining({ code: "PROCESS_EMERGENCY_STOP" })]
    });
  });

  it("does not expose another owner's project or run", async () => {
    const hidden = projectStore.createProject(
      "Проект другого владельца",
      "other-owner-client",
      "other-owner"
    );

    const project = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${hidden.project.id}`
    });
    const stream = await app.inject({
      method: "GET",
      url: `/api/v1/runs/${hidden.run.id}/events`
    });
    const cancel = await app.inject({
      method: "POST",
      url: `/api/v1/runs/${hidden.run.id}/cancel`
    });

    expect(project.statusCode).toBe(404);
    expect(stream.statusCode).toBe(404);
    expect(cancel.statusCode).toBe(404);
  });

  it("cancels an active stream and rejects a concurrent stream consumer", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/projects",
      payload: { initial_message: "Длинный поток", client_message_id: "cancel-client-1" }
    });
    const body = created.json<{ run_id: string; stream_url: string }>();

    const firstStream = app.inject({ method: "GET", url: body.stream_url });
    await vi.waitFor(
      () => {
        expect(projectStore.getRun(body.run_id)?.status).toBe("running");
        expect(projectStore.getModelUsageForRun(body.run_id)).toHaveLength(1);
      },
      { timeout: 2_000 }
    );

    const duplicateStream = await app.inject({ method: "GET", url: body.stream_url });
    expect(duplicateStream.statusCode).toBe(409);

    const cancelled = await app.inject({
      method: "POST",
      url: `/api/v1/runs/${body.run_id}/cancel`
    });
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json<{ status: string }>().status).toBe("cancelled");

    const stream = await firstStream;
    expect(stream.body).toContain("event: run.cancelled");
    expect(projectStore.getRun(body.run_id)).toMatchObject({ status: "cancelled" });
    expect(projectStore.getAssistantMessage(body.run_id)).toMatchObject({ status: "cancelled" });
    expect(projectStore.getModelUsageForRun(body.run_id)).toEqual([
      expect.objectContaining({
        status: "cancelled",
        error_code: "CANCELLED_BY_OWNER"
      })
    ]);

    const repeated = await app.inject({
      method: "POST",
      url: `/api/v1/runs/${body.run_id}/cancel`
    });
    expect(repeated.statusCode).toBe(200);
  });

  it("persists a cancelled assistant message before streaming starts", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/projects",
      payload: { initial_message: "Не начинай поток", client_message_id: "queued-cancel-1" }
    });
    const body = created.json<{ project: { id: string }; run_id: string }>();

    const cancelled = await app.inject({
      method: "POST",
      url: `/api/v1/runs/${body.run_id}/cancel`
    });
    const project = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${body.project.id}`
    });

    expect(cancelled.statusCode).toBe(200);
    expect(project.statusCode).toBe(200);
    expect(
      project
        .json<{ messages: Array<{ role: string; status: string; error_code: string | null }> }>()
        .messages.at(-1)
    ).toMatchObject({
      role: "assistant",
      status: "cancelled",
      error_code: "CANCELLED_BY_OWNER"
    });

    projectStore.completeRun(body.run_id, "mock", "late-completion");
    expect(projectStore.getRun(body.run_id)).toMatchObject({ status: "cancelled" });
    expect(projectStore.getAssistantMessage(body.run_id)).toMatchObject({ status: "cancelled" });
  });

  it("keeps malformed empty JSON requests as typed client errors", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/projects",
      payload: { initial_message: "Проверка JSON", client_message_id: "empty-json-1" }
    });
    const { run_id: runId } = created.json<{ run_id: string }>();

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/runs/${runId}/cancel`,
      headers: { "content-type": "application/json" },
      payload: ""
    });

    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: { code: string } }>().error.code).toBe("VALIDATION_ERROR");
  });
});
