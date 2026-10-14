import { randomUUID } from "node:crypto";
import { loadServerConfig } from "@cosmora/config";
import { GeneralChatStore, LOCAL_OWNER_ID, openDatabase, runMigrations } from "@cosmora/db";
import type {
  ChatBranchList,
  GeneralChatMessageAcceptedResponse,
  ModelRequest,
  CreateChatBranch
} from "@cosmora/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { buildModelRuntime } from "../src/model-runtime.js";
import { AccountCorePrivacyAdapter } from "../src/account-settings/privacy/account-core-adapter.js";

describe("chat variants", () => {
  let db: ReturnType<typeof openDatabase>;
  let store: GeneralChatStore;
  let app: ReturnType<typeof buildApp>;
  let requests: ModelRequest[];
  beforeEach(async () => {
    db = openDatabase(":memory:");
    await runMigrations(db);
    const config = loadServerConfig({ NODE_ENV: "test", MOCK_PROVIDER_MODE: "success" });
    const runtime = await buildModelRuntime(config);
    requests = [];
    const stream = runtime.gateway.stream.bind(runtime.gateway);
    vi.spyOn(runtime.gateway, "stream").mockImplementation((request, signal) => {
      requests.push(request);
      return stream(request, signal);
    });
    store = new GeneralChatStore(db.sqlite);
    app = buildApp({
      config,
      database: db,
      generalChatStore: store,
      modelGateway: runtime.gateway,
      chat: runtime.chat
    });
  });
  afterEach(async () => {
    await app.close();
    db.close();
  });
  const fork = (id: string, payload: unknown) =>
    app.inject({
      method: "POST",
      url: `/api/v1/chats/${id}/branches`,
      headers: { "content-type": "application/json" },
      payload: JSON.stringify(payload)
    });
  const finish = async (run: { id: string }) => {
    const response = await app.inject({ method: "GET", url: `/api/v1/chat-runs/${run.id}/events` });
    expect(response.body).toContain("event: run.completed");
  };
  const seed = async () => {
    const first = store.createChat("Первый запрос", randomUUID());
    await finish(first.run);
    const second = store.createMessage(
      first.chat.id,
      "Поздний секрет исходной ветки",
      randomUUID()
    )!;
    await finish(second.run);
    return { first, second };
  };

  it("edits an early request without altering source history or leaking the future; repeated acceptance queues once", async () => {
    const { first } = await seed();
    const original = store.listMessages(first.chat.id);
    const payload: CreateChatBranch = {
      client_branch_id: randomUUID(),
      kind: "edit",
      message_id: first.userMessage.id,
      content: "Изменённый первый запрос"
    };
    const results = await Promise.all([fork(first.chat.id, payload), fork(first.chat.id, payload)]);
    expect(results.map((response) => response.statusCode).sort()).toEqual([200, 201]);
    const accepted = results[0].json<GeneralChatMessageAcceptedResponse>();
    expect(accepted.chat.id).toBe(payload.client_branch_id);
    expect(accepted.chat.title).toContain(payload.content);
    expect(store.listMessages(first.chat.id)).toEqual(original);
    expect(store.listMessages(accepted.chat.id)).toHaveLength(1);
    expect(
      db.sqlite
        .prepare("SELECT count(*) n FROM general_chat_runs WHERE chat_id=?")
        .get(accepted.chat.id)
    ).toMatchObject({ n: 1 });
    expect(store.getModelUsageForRun(accepted.run_id)).toEqual([]);
    await finish({ id: accepted.run_id });
    expect(
      requests
        .at(-1)
        ?.messages.filter((message) => message.role === "user")
        .map((message) => message.content)
    ).toEqual([payload.content]);
    expect((await fork(first.chat.id, { ...payload, content: "Changed retry" })).statusCode).toBe(
      409
    );
    expect(store.getModelUsageForRun(accepted.run_id)).toHaveLength(1);
    const replay = await fork(first.chat.id, payload);
    expect(replay.statusCode).toBe(200);
    await finish({ id: replay.json<GeneralChatMessageAcceptedResponse>().run_id });
    expect(requests).toHaveLength(3);
  });

  it("regenerates from the matching user turn, keeps earlier context and groups nested variants", async () => {
    const { first, second } = await seed();
    const history = store.listMessages(first.chat.id);
    const answer = store.getAssistantMessage(second.run.id)!;
    const response = await fork(first.chat.id, {
      client_branch_id: randomUUID(),
      message_id: answer.id,
      kind: "regenerate"
    });
    expect(response.statusCode, response.body).toBe(201);
    const accepted = response.json<GeneralChatMessageAcceptedResponse>();
    await finish({ id: accepted.run_id });
    const request = requests.at(-1)!;
    expect(request.messages.map((message) => message.role)).toEqual([
      "system",
      "user",
      "assistant",
      "user"
    ]);
    expect(
      request.messages
        .filter((message) => message.role === "assistant")
        .map((message) => message.content)
    ).toEqual([history[1]!.content]);
    const clone = store.listMessages(accepted.chat.id)[0]!;
    const nested = await fork(accepted.chat.id, {
      client_branch_id: randomUUID(),
      message_id: clone.id,
      kind: "edit",
      content: "Новая независимая версия"
    });
    expect(nested.statusCode).toBe(201);
    const family = await app.inject({
      method: "GET",
      url: `/api/v1/chats/${nested.json<GeneralChatMessageAcceptedResponse>().chat.id}/branches`
    });
    expect(family.statusCode).toBe(200);
    expect(family.headers["cache-control"]).toBe("private, no-store");
    expect(family.json<ChatBranchList>().root_chat_id).toBe(first.chat.id);
    expect(family.json<ChatBranchList>().items.map((item) => item.kind)).toEqual([
      "original",
      "regenerate",
      "edit"
    ]);
  });

  it("copies original attachments and a memory snapshot without duplicating old usage", async () => {
    const attachments = [{ name: "example.ts", content: "export const answer = 42;" }];
    const first = store.createChat("Прочитай код", randomUUID(), LOCAL_OWNER_ID, attachments);
    await finish(first.run);
    store.updateChatMemory(first.chat.id, LOCAL_OWNER_ID, "Оригинальная заметка", 0);
    db.sqlite
      .prepare("INSERT INTO kosmora_chat_preferences(chat_id,owner_id,relay_enabled) VALUES(?,?,0)")
      .run(first.chat.id, LOCAL_OWNER_ID);
    const result = await fork(first.chat.id, {
      client_branch_id: randomUUID(),
      message_id: first.userMessage.id,
      kind: "edit",
      content: "Добавь объяснение"
    });
    expect(result.statusCode).toBe(201);
    const accepted = result.json<GeneralChatMessageAcceptedResponse>();
    expect(accepted.user_message.attachments).toEqual(attachments);
    expect(store.getChatMemory(accepted.chat.id)?.memory_notes).toBe("Оригинальная заметка");
    store.updateChatMemory(first.chat.id, LOCAL_OWNER_ID, "Другая заметка", 1);
    expect(store.getChatMemory(accepted.chat.id)?.memory_notes).toBe("Оригинальная заметка");
    expect(
      db.sqlite
        .prepare("SELECT relay_enabled FROM kosmora_chat_preferences WHERE chat_id=?")
        .get(accepted.chat.id)
    ).toMatchObject({ relay_enabled: 0 });
    expect(store.getModelUsageForRun(first.run.id)).toHaveLength(1);
    expect(store.getModelUsageForRun(accepted.run_id)).toEqual([]);
  });

  it("rejects foreign history, wrong roles, busy chats, ID collisions and malformed input atomically", async () => {
    const { first } = await seed();
    const foreign = store.createChat("Foreign", randomUUID(), "other-owner");
    store.cancelRun(foreign.run.id, "other-owner");
    const base = {
      client_branch_id: randomUUID(),
      message_id: first.userMessage.id,
      kind: "edit",
      content: "New"
    };
    expect((await fork(foreign.chat.id, base)).statusCode).toBe(404);
    expect(
      (await fork(first.chat.id, { ...base, message_id: foreign.userMessage.id })).statusCode
    ).toBe(404);
    expect(
      (await app.inject({ method: "GET", url: `/api/v1/chats/${foreign.chat.id}/branches` }))
        .statusCode
    ).toBe(404);
    expect((await fork(first.chat.id, { ...base, kind: "regenerate" })).statusCode).toBe(400);
    expect(
      (
        await fork(first.chat.id, {
          client_branch_id: randomUUID(),
          message_id: first.userMessage.id,
          kind: "regenerate"
        })
      ).statusCode
    ).toBe(400);
    expect(
      (await fork(first.chat.id, { ...base, client_branch_id: first.chat.id })).statusCode
    ).toBe(409);
    for (const bad of [
      { ...base, content: " " },
      { ...base, content: 3 },
      { ...base, owner_id: "other-owner" },
      { ...base, client_branch_id: "not-a-uuid" }
    ])
      expect((await fork(first.chat.id, bad)).statusCode).toBe(400);
    const pending = store.createMessage(first.chat.id, "Pending", randomUUID())!;
    expect((await fork(first.chat.id, base)).statusCode).toBe(409);
    store.cancelRun(pending.run.id);
    expect(store.listChats()).toHaveLength(1);
    expect(db.sqlite.prepare("SELECT count(*) n FROM chat_branches").get()).toMatchObject({ n: 0 });
  });

  it("exports owned metadata, honors privacy fences and cascades deletion without touching another owner", async () => {
    const { first } = await seed();
    const result = await fork(first.chat.id, {
      client_branch_id: randomUUID(),
      message_id: first.userMessage.id,
      kind: "edit",
      content: "Owned copy"
    });
    const branch = result.json<GeneralChatMessageAcceptedResponse>();
    store.cancelRun(branch.run_id);
    const foreign = store.createChat("Foreign", randomUUID(), "other-owner");
    store.cancelRun(foreign.run.id, "other-owner");
    const adapter = new AccountCorePrivacyAdapter(db.sqlite, () => Promise.resolve());
    expect((await adapter.export(LOCAL_OWNER_ID)).records.chat_branches).toHaveLength(1);
    const now = new Date().toISOString();
    db.sqlite
      .prepare(
        "INSERT INTO kosmora_owner_data_lifecycle(owner_id,epoch,state,operation_id,started_at,updated_at) VALUES(?,1,'deleting','test',?,?)"
      )
      .run(LOCAL_OWNER_ID, now, now);
    expect(() =>
      store.createChatBranch(first.chat.id, LOCAL_OWNER_ID, {
        client_branch_id: randomUUID(),
        message_id: first.userMessage.id,
        kind: "edit",
        content: "Fenced"
      })
    ).toThrow("OWNER_DATA_FENCED");
    await adapter.delete(LOCAL_OWNER_ID, 1);
    expect(db.sqlite.prepare("SELECT * FROM chat_branches").all()).toEqual([]);
    expect(store.getChat(foreign.chat.id, "other-owner")).not.toBeNull();
    expect(db.sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("bounds branch families and prefix size before copying", async () => {
    const { first } = await seed();
    for (let i = 0; i < 32; i++)
      store.createChatBranch(first.chat.id, LOCAL_OWNER_ID, {
        client_branch_id: randomUUID(),
        message_id: first.userMessage.id,
        kind: "edit",
        content: `Variant ${i}`
      });
    expect(
      (
        await fork(first.chat.id, {
          client_branch_id: randomUUID(),
          message_id: first.userMessage.id,
          kind: "edit",
          content: "Over limit"
        })
      ).statusCode
    ).toBe(400);
    expect(store.listChatBranches(first.chat.id)?.items).toHaveLength(33);
    const another = store.createChat("Large prefix", randomUUID());
    store.cancelRun(another.run.id);
    const add = db.sqlite.prepare(
      "INSERT INTO general_chat_messages(id,chat_id,owner_id,role,content_type,content,status,created_at,updated_at) VALUES(?,?,?,'user','text','fixture','completed',?,?)"
    );
    const now = new Date().toISOString();
    for (let i = 0; i < 401; i++) add.run(randomUUID(), another.chat.id, LOCAL_OWNER_ID, now, now);
    const last = store.listMessages(another.chat.id).at(-1)!;
    expect(
      (
        await fork(another.chat.id, {
          client_branch_id: randomUUID(),
          message_id: last.id,
          kind: "edit",
          content: "Too much history"
        })
      ).statusCode
    ).toBe(400);
    expect(store.listChatBranches(another.chat.id)?.items).toHaveLength(1);
  });
});
