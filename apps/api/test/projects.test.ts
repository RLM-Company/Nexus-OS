import { loadServerConfig } from "@nexus/config";
import { openDatabase, ProjectStore, runMigrations } from "@nexus/db";
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
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    database = openDatabase(":memory:");
    await runMigrations(database);
    const runtime = buildModelRuntime(config);
    projectStore = new ProjectStore(database.sqlite);
    app = buildApp({
      config,
      database,
      projectStore,
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
    const body = created.json<{ project: { id: string }; stream_url: string }>();

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

    const projects = await app.inject({ method: "GET", url: "/api/v1/projects" });
    expect(projects.statusCode).toBe(200);
    const preview = projects.json<{ items: Array<{ last_message_preview: string | null }> }>()
      .items[0]?.last_message_preview;
    expect(preview?.length).toBeLessThanOrEqual(240);
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
    await vi.waitFor(() => expect(projectStore.getRun(body.run_id)?.status).toBe("running"), {
      timeout: 2_000
    });

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

    const repeated = await app.inject({
      method: "POST",
      url: `/api/v1/runs/${body.run_id}/cancel`
    });
    expect(repeated.statusCode).toBe(200);
  });
});
