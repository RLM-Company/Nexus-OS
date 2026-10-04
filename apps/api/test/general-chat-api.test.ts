import { loadServerConfig } from "@cosmora/config";
import {
  EmergencyStopStore,
  GeneralChatStore,
  openDatabase,
  ProjectStore,
  runMigrations
} from "@cosmora/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { buildModelRuntime } from "../src/model-runtime.js";
import type {
  GeneralChatDetailResponse,
  GeneralChatMessageAcceptedResponse,
  ModelRequest
} from "@cosmora/contracts";

describe("ordinary chat API", () => {
  const config = loadServerConfig({ NODE_ENV: "test", MOCK_PROVIDER_MODE: "success" });
  let database: ReturnType<typeof openDatabase>;
  let chats: GeneralChatStore;
  let app: ReturnType<typeof buildApp>;
  let modelRequests: ModelRequest[];

  beforeEach(async () => {
    database = openDatabase(":memory:");
    await runMigrations(database);
    const runtime = await buildModelRuntime(config);
    modelRequests = [];
    const stream = runtime.gateway.stream.bind(runtime.gateway);
    vi.spyOn(runtime.gateway, "stream").mockImplementation((request, signal) => {
      modelRequests.push(request);
      return stream(request, signal);
    });
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

  it("accepts text files on both chat routes and returns them in durable history", async () => {
    const attachments = [{ name: "example.ts", content: "export const value = 42;" }];
    const payload = { initial_message: "Объясни код", client_message_id: "files-api", attachments };
    const first = await app.inject({ method: "POST", url: "/api/v1/chats", payload });
    expect(first.statusCode, first.body).toBe(201);
    const accepted = first.json<GeneralChatMessageAcceptedResponse>();
    expect(accepted.user_message.attachments).toEqual(attachments);
    expect((await app.inject({ method: "POST", url: "/api/v1/chats", payload })).statusCode).toBe(
      200
    );
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/chats",
          payload: { ...payload, attachments: [] }
        })
      ).statusCode
    ).toBe(409);
    await app.inject({ method: "GET", url: accepted.stream_url });
    expect(modelRequests[0]?.messages.find((item) => item.role === "user")?.content).toContain(
      JSON.stringify(attachments)
    );
    const next = await app.inject({
      method: "POST",
      url: `/api/v1/chats/${accepted.chat.id}/messages`,
      payload: {
        content: "Сравни файлы",
        client_message_id: "files-api-next",
        attachments: [{ name: "other.txt", content: "value: 42" }]
      }
    });
    expect(next.statusCode, next.body).toBe(202);
    await app.inject({
      method: "GET",
      url: next.json<GeneralChatMessageAcceptedResponse>().stream_url
    });
    const userTurns = modelRequests[1]?.messages.filter((item) => item.role === "user");
    expect(userTurns).toHaveLength(2);
    expect(userTurns?.[0]?.content).toContain("export const value = 42;");
    expect(userTurns?.[1]?.content).toContain("value: 42");
    const detail = await app.inject({ method: "GET", url: `/api/v1/chats/${accepted.chat.id}` });
    expect(
      detail
        .json<GeneralChatDetailResponse>()
        .messages.filter((item) => item.role === "user")
        .map((item) => item.attachments)
    ).toEqual([attachments, [{ name: "other.txt", content: "value: 42" }]]);
    expect(detail.body).not.toContain("attachments_json");
  });

  it.each(
    [
      [{ name: "../secret.txt", content: "text" }],
      [{ name: "image.png", content: "text" }],
      [{ name: "nul.txt", content: "binary\u0000data" }],
      [{ name: "empty.txt", content: "" }],
      [{ name: "long.txt", content: "x".repeat(8001) }],
      Array.from({ length: 4 }, (_, index) => ({
        name: `${index}.txt`,
        content: "я".repeat(4000)
      })),
      Array.from({ length: 5 }, (_, index) => ({ name: `${index}.txt`, content: "text" })),
      Array.from({ length: 4 }, (_, index) => ({ name: `${index}.txt`, content: "x".repeat(7000) }))
    ].map((attachments) => ({ attachments }))
  )(
    "rejects invalid attachments before creating a chat or queuing a model run (%#)",
    async ({ attachments }) => {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/chats",
        payload: {
          initial_message: "Вопрос",
          client_message_id: "invalid-files",
          attachments
        }
      });
      expect(response.statusCode, response.body).toBe(400);
      expect(chats.listChats()).toEqual([]);
      expect(modelRequests).toEqual([]);
      expect(
        database.sqlite.prepare("SELECT COUNT(*) AS count FROM general_chat_runs").get()
      ).toMatchObject({ count: 0 });
    }
  );

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
