import { loadServerConfig } from "@nexus/config";
import { openDatabase, ProjectStore, runMigrations } from "@nexus/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";

describe("project chat API", () => {
  const config = loadServerConfig({ NODE_ENV: "test", MOCK_PROVIDER_MODE: "success" });
  let database: ReturnType<typeof openDatabase>;
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    database = openDatabase(":memory:");
    await runMigrations(database);
    app = buildApp({
      config,
      database,
      projectStore: new ProjectStore(database.sqlite)
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
});
