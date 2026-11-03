import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadServerConfig } from "@cosmora/config";
import { openDatabase, runMigrations, LOCAL_OWNER_ID } from "@cosmora/db";
import type { HistoryCompactionPreview, ModelRequest } from "@cosmora/contracts";
import { buildApp } from "../src/app.js";
import { buildModelRuntime } from "../src/model-runtime.js";
import { seedCompactionHistory } from "./fixtures/compaction-history.js";

describe("verified history compaction API", () => {
  let db: ReturnType<typeof openDatabase>, seed: ReturnType<typeof seedCompactionHistory>;
  let app: ReturnType<typeof buildApp>, calls: ModelRequest[];
  beforeEach(async () => {
    db = openDatabase(":memory:");
    await runMigrations(db);
    seed = seedCompactionHistory(db);
    const config = loadServerConfig({ NODE_ENV: "test", MOCK_PROVIDER_MODE: "success" });
    const runtime = await buildModelRuntime(config);
    calls = [];
    const original = runtime.gateway.stream.bind(runtime.gateway);
    vi.spyOn(runtime.gateway, "stream").mockImplementation((r, s) => {
      calls.push(r);
      return original(r, s);
    });
    app = buildApp({
      config,
      database: db,
      generalChatStore: seed.store,
      chat: runtime.chat,
      modelGateway: runtime.gateway
    });
  });
  afterEach(async () => {
    await app.close();
    db.close();
  });
  const enable = (id = seed.chatId) =>
    seed.store.contextMemory.updateSettings(
      { kind: "chat", id },
      {
        enabled: true,
        compact_history: true,
        use_personal: false,
        source_chat_ids: [],
        project_ids: [],
        expected_version: 0
      },
      LOCAL_OWNER_ID
    );
  const preview = (id = seed.chatId) =>
    app.inject({
      method: "POST",
      url: "/api/v1/chats/" + id + "/history-compaction/preview",
      payload: { query: "Напомни цель, бюджет и следующий шаг." }
    });
  it("is off by default, previews exact sources and measurable request reduction without model calls", async () => {
    expect((await preview()).json<HistoryCompactionPreview>().report.state).toBe("disabled");
    enable();
    const count = seed.store.listMessages(seed.chatId).length,
      before = seed.store.getChat(seed.chatId);
    const response = await preview(),
      value = response.json<HistoryCompactionPreview>();
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(value.report.state).toBe("applied");
    expect(value.report.protected_kept).toBe(value.report.protected_spans);
    expect(value.after_input_upper_bound!).toBeLessThan(value.before_input_upper_bound!);
    expect(JSON.stringify(value.memory)).toContain("17 350.25");
    expect(calls).toHaveLength(0);
    expect(seed.store.listMessages(seed.chatId)).toHaveLength(count);
    expect(seed.store.getChat(seed.chatId)).toEqual(before);
  });
  it("uses verified quotes in the actual streaming request and never writes a summary into chat history", async () => {
    enable();
    seed.store.contextMemory.create(
      {
        scope: "chat",
        scope_id: seed.chatId,
        kind: "constraint",
        title: "Отправка письма",
        content: "Не отправлять письмо без отдельного разрешения.",
        pinned: true,
        expires_at: null,
        source: null
      },
      LOCAL_OWNER_ID
    );
    const accepted = await app.inject({
      method: "POST",
      url: "/api/v1/chats/" + seed.chatId + "/messages",
      payload: {
        content: "Напомни бюджет и следующий шаг.",
        client_message_id: crypto.randomUUID()
      }
    });
    const response = await app.inject({
      method: "GET",
      url: accepted.json<{ stream_url: string }>().stream_url
    });
    expect(response.body).toContain("event: run.completed");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.messages[0]!.content).toContain("ранней истории сокращена");
    expect(JSON.stringify(calls[0]!.messages)).toContain("17 350.25");
    expect(JSON.stringify(calls[0]!.messages)).toContain(
      "Не отправлять письмо без отдельного разрешения."
    );
    expect(calls[0]!.routing.estimated_input_tokens).toBeLessThanOrEqual(28000);
    expect(
      seed.store
        .listMessages(seed.chatId)
        .filter((m) => m.role === "user")
        .at(-1)!.content
    ).toBe("Напомни бюджет и следующий шаг.");
  });
  it("rebuilds after exclusions and source edits, keeps sources scoped to their owner", async () => {
    enable();
    const first = (await preview()).json<HistoryCompactionPreview>();
    const oldHash = first.memory!.items.find((e) => e.source?.message_id === seed.budgetMessage)!
      .source!.sha256;
    db.sqlite
      .prepare("UPDATE general_chat_messages SET content='Бюджет теперь 19 000.50 ₽.' WHERE id=?")
      .run(seed.budgetMessage);
    const second = (await preview()).json<HistoryCompactionPreview>();
    expect(JSON.stringify(second.memory)).toContain("19 000.50");
    expect(
      second.memory!.items.find((e) => e.source?.message_id === seed.budgetMessage)!.source!.sha256
    ).not.toBe(oldHash);
    seed.store.workspace.updateContext(seed.chatId, LOCAL_OWNER_ID, {
      excluded_ids: [seed.budgetMessage],
      summary: "",
      summary_through: null,
      expected_version: 0
    });
    expect(JSON.stringify((await preview()).json<HistoryCompactionPreview>().memory)).not.toContain(
      "19 000.50"
    );
    const foreign = seedCompactionHistory(db, "foreign");
    expect((await preview(foreign.chatId)).statusCode).toBe(404);
  });
  it("blocks incomplete protected coverage before a paid dispatch and preserves manual summaries", async () => {
    const blocked = seedCompactionHistory(db, LOCAL_OWNER_ID, true);
    enable(blocked.chatId);
    const result = (await preview(blocked.chatId)).json<HistoryCompactionPreview>();
    expect(result.report.state).toBe("blocked");
    expect(result.dispatch_blocked).toBe(true);
    const accepted = await app.inject({
      method: "POST",
      url: "/api/v1/chats/" + blocked.chatId + "/messages",
      payload: { content: "Продолжай", client_message_id: crypto.randomUUID() }
    });
    expect(
      (await app.inject({ method: "GET", url: accepted.json<{ stream_url: string }>().stream_url }))
        .body
    ).toContain("MEMORY_CONTEXT_INCOMPLETE");
    expect(calls).toHaveLength(0);
    enable();
    seed.store.workspace.updateContext(seed.chatId, LOCAL_OWNER_ID, {
      expected_version: 0,
      excluded_ids: [],
      summary: "Ручная сводка владельца.",
      summary_through: seed.store.listMessages(seed.chatId)[2]!.id
    });
    expect((await preview()).json<HistoryCompactionPreview>().report.reason).toBe("manual_summary");
  });
  it("preserves the flag for old clients and fences reads, with strict request validation", async () => {
    enable();
    seed.store.contextMemory.updateSettings(
      { kind: "chat", id: seed.chatId },
      {
        enabled: true,
        use_personal: false,
        source_chat_ids: [],
        project_ids: [],
        expected_version: 1
      },
      LOCAL_OWNER_ID
    );
    expect(
      seed.store.contextMemory.settings({ kind: "chat", id: seed.chatId }, LOCAL_OWNER_ID)
        .compact_history
    ).toBe(true);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/chats/" + seed.chatId + "/history-compaction/preview",
          payload: { query: "test", owner_id: "foreign" }
        })
      ).statusCode
    ).toBe(400);
    const at = new Date().toISOString();
    db.sqlite
      .prepare(
        "INSERT INTO kosmora_owner_data_lifecycle(owner_id,epoch,state,operation_id,started_at,updated_at) VALUES(?,1,'deleting','test',?,?)"
      )
      .run(LOCAL_OWNER_ID, at, at);
    expect((await preview()).statusCode).toBe(409);
  });
});
