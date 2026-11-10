import { loadServerConfig } from "@cosmora/config";
import type { ModelRequest } from "@cosmora/contracts";
import { GeneralChatStore, openDatabase, runMigrations } from "@cosmora/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { WebSearch } from "../src/web-search.js";
import { buildModelRuntime } from "../src/model-runtime.js";

/** Proves the explicit actions are wired into the real chat request builder. */
describe("Kosmora actions in the real chat dispatch", () => {
  let db: ReturnType<typeof openDatabase>;
  let app: ReturnType<typeof buildApp>;
  let requests: ModelRequest[];
  let chatId: string;
  const fetchFixture: typeof fetch = async () => {
    await Promise.resolve();
    return new Response(
      JSON.stringify({
        results: [
          {
            title: "Фикстурный источник",
            url: "https://example.test/source",
            content: "Сумма 19 700 ₽"
          }
        ]
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };

  beforeEach(async () => {
    db = openDatabase(":memory:");
    await runMigrations(db);
    const store = new GeneralChatStore(db.sqlite);
    const config = loadServerConfig({ NODE_ENV: "test", MOCK_PROVIDER_MODE: "success" });
    const runtime = await buildModelRuntime(config);
    requests = [];
    const original = runtime.gateway.stream.bind(runtime.gateway);
    vi.spyOn(runtime.gateway, "stream").mockImplementation((r, s) => {
      requests.push(r);
      return original(r, s);
    });
    app = buildApp({
      config,
      database: db,
      generalChatStore: store,
      modelGateway: runtime.gateway,
      chat: runtime.chat,
      webSearch: new WebSearch("http://127.0.0.1:8080", fetchFixture)
    });
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/chats",
      payload: {
        initial_message: "Первый запрос",
        client_message_id: crypto.randomUUID()
      }
    });
    chatId = created.json<{ chat: { id: string } }>().chat.id;
    const stream = await app.inject({
      method: "GET",
      url: created.json<{ stream_url: string }>().stream_url
    });
    expect(stream.body).toContain("event: run.completed");
    requests = [];
  });
  afterEach(async () => {
    await app.close();
    db.close();
  });

  const send = async (payload: Record<string, unknown>) => {
    const accepted = await app.inject({
      method: "POST",
      url: `/api/v1/chats/${chatId}/messages`,
      payload: { content: "Сколько стоит?", client_message_id: crypto.randomUUID(), ...payload }
    });
    expect(accepted.statusCode).toBe(202);
    const stream = await app.inject({
      method: "GET",
      url: accepted.json<{ stream_url: string }>().stream_url
    });
    expect(stream.body).toContain("event: run.completed");
    return JSON.stringify(requests.at(-1)?.messages ?? []);
  };

  it("does not search without the explicit action", async () => {
    const body = await send({});
    expect(body).not.toContain("kosmora_web_search");
    expect(body).not.toContain("example.test");
  });

  it("injects search results and a text action into the same model request", async () => {
    const body = await send({
      web_search: true,
      text_action: { kind: "explain", selection: "19 700 ₽" }
    });
    expect(body).toContain("kosmora_web_search");
    expect(body).toContain("https://example.test/source");
    expect(body).toContain("19 700 ₽");
    expect(body).toContain("kosmora_text_action");
    expect(body).toContain("kind: explain");
    expect(body).toContain("Сколько стоит?");
  });

  it("keeps the canonical stored message unmodified", async () => {
    await send({ web_search: true, text_action: { kind: "hint" } });
    const detail = await app.inject({ method: "GET", url: `/api/v1/chats/${chatId}` });
    const messages = detail.json<{
      messages: { role: string; content: string }[];
    }>().messages;
    const latestUser = messages.findLast((m) => m.role === "user")!;
    expect(latestUser.content).toBe("Сколько стоит?");
    expect(latestUser.content).not.toContain("kosmora_");
    expect(
      db.sqlite
        .prepare(
          "SELECT web_search, text_action_json FROM general_chat_messages WHERE role='user' ORDER BY rowid DESC LIMIT 1"
        )
        .get()
    ).toMatchObject({ web_search: 1 });
  });

  it("fails the run with an explicit error when search is unconfigured", async () => {
    await app.close();
    const config = loadServerConfig({ NODE_ENV: "test", MOCK_PROVIDER_MODE: "success" });
    const runtime = await buildModelRuntime(config);
    app = buildApp({
      config,
      database: db,
      generalChatStore: new GeneralChatStore(db.sqlite),
      modelGateway: runtime.gateway,
      chat: runtime.chat
      // no webSearch: search is unconfigured
    });
    const accepted = await app.inject({
      method: "POST",
      url: `/api/v1/chats/${chatId}/messages`,
      payload: { content: "Найди", client_message_id: crypto.randomUUID(), web_search: true }
    });
    expect(accepted.statusCode).toBe(202);
    const stream = await app.inject({
      method: "GET",
      url: accepted.json<{ stream_url: string }>().stream_url
    });
    expect(stream.body).toContain("SEARCH_UNAVAILABLE");
    expect(stream.body).toContain("event: run.failed");
  });
});
