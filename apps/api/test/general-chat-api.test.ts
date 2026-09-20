import { loadServerConfig } from "@cosmora/config";
import {
  EmergencyStopStore,
  GeneralChatStore,
  openDatabase,
  ProjectStore,
  runMigrations
} from "@cosmora/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { buildModelRuntime } from "../src/model-runtime.js";

describe("ordinary chat API", () => {
  const config = loadServerConfig({ NODE_ENV: "test", MOCK_PROVIDER_MODE: "success" });
  let database: ReturnType<typeof openDatabase>;
  let chats: GeneralChatStore;
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    database = openDatabase(":memory:");
    await runMigrations(database);
    const runtime = await buildModelRuntime(config);
    chats = new GeneralChatStore(database.sqlite);
    app = buildApp({
      config,
      database,
      generalChatStore: chats,
      projectStore: new ProjectStore(database.sqlite),
      emergencyStopStore: new EmergencyStopStore(database.sqlite),
      modelGateway: runtime.gateway,
      chat: runtime.chat,
      manager: runtime.manager
    });
  });

  afterEach(async () => {
    await app.close();
    database.close();
  });

  it("streams and persists an ordinary answer without creating a project", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/chats",
      payload: { initial_message: "Как устроен этот чат?", client_message_id: "ordinary-1" }
    });
    expect(created.statusCode, created.body).toBe(201);
    const body = created.json<{ chat: { id: string }; run_id: string; stream_url: string }>();

    const stream = await app.inject({ method: "GET", url: body.stream_url });
    expect(stream.statusCode).toBe(200);
    expect(stream.body).toContain("event: message.delta");
    expect(stream.body).toContain("Запрос обычного чата");
    expect(stream.body).toContain("event: run.completed");

    const detail = await app.inject({ method: "GET", url: `/api/v1/chats/${body.chat.id}` });
    expect(detail.statusCode).toBe(200);
    expect(detail.json<{ messages: Array<{ role: string; status: string }> }>().messages).toEqual([
      expect.objectContaining({ role: "user", status: "completed" }),
      expect.objectContaining({ role: "assistant", status: "completed" })
    ]);
    expect(chats.getModelUsageForRun(body.run_id)).toEqual([
      expect.objectContaining({ status: "committed", provider_id: "mock" })
    ]);
    expect(database.sqlite.prepare("SELECT COUNT(*) AS count FROM projects").get()).toMatchObject({
      count: 0
    });
  });

  it("reuses an idempotent create and keeps chats owner-scoped", async () => {
    const payload = { initial_message: "Повтори", client_message_id: "ordinary-duplicate" };
    const first = await app.inject({ method: "POST", url: "/api/v1/chats", payload });
    const duplicate = await app.inject({ method: "POST", url: "/api/v1/chats", payload });
    expect(first.statusCode).toBe(201);
    expect(duplicate.statusCode).toBe(200);
    expect(duplicate.json<{ chat: { id: string } }>().chat.id).toBe(
      first.json<{ chat: { id: string } }>().chat.id
    );
    const list = await app.inject({ method: "GET", url: "/api/v1/chats" });
    expect(list.json<{ items: unknown[] }>().items).toHaveLength(1);
  });

  it("accepts a mini-AI profile without exposing its instructions in chat responses", async () => {
    const payload = {
      initial_message: "Проверь мой текст",
      client_message_id: "ordinary-profile",
      assistant_profile: { name: "Редактор", instructions: "Сохраняй смысл и пиши короче." }
    };
    const created = await app.inject({ method: "POST", url: "/api/v1/chats", payload });
    expect(created.statusCode, created.body).toBe(201);
    const body = created.json<{ chat: { id: string; assistant_profile_name: string | null } }>();
    expect(body.chat.assistant_profile_name).toBe("Редактор");
    expect(created.body).not.toContain(payload.assistant_profile.instructions);
    expect(chats.getChat(body.chat.id)).toMatchObject({
      assistant_profile_name: "Редактор",
      assistant_profile_instructions: payload.assistant_profile.instructions
    });

    const changedProfile = await app.inject({
      method: "POST",
      url: "/api/v1/chats",
      payload: {
        ...payload,
        assistant_profile: { name: "Аналитик", instructions: "Сравни варианты." }
      }
    });
    expect(changedProfile.statusCode).toBe(409);
  });

  it("fails closed while the process emergency stop is active", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/chats",
      payload: { initial_message: "Не вызывай модель", client_message_id: "ordinary-stop" }
    });
    const body = created.json<{ run_id: string; stream_url: string }>();
    const stopped = await app.inject({
      method: "POST",
      url: "/api/v1/operations/emergency-stop",
      payload: { scope: "process", reason: "Ordinary chat containment test" }
    });
    expect(stopped.statusCode).toBe(200);

    const stream = await app.inject({ method: "GET", url: body.stream_url });
    expect(stream.body).toContain('"error_code":"EMERGENCY_STOP"');
    expect(chats.getRun(body.run_id)).toMatchObject({ status: "failed" });
    expect(chats.getModelUsageForRun(body.run_id)).toEqual([]);
  });
});
