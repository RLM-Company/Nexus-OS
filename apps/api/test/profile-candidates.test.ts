import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { openDatabase, runMigrations, GeneralChatStore, LOCAL_OWNER_ID } from "@cosmora/db";
import type { ProfileCandidatePage, ContextMemoryEntry } from "@cosmora/contracts";
import { loadServerConfig } from "@cosmora/config";
import { buildApp } from "../src/app.js";
import { AccountCorePrivacyAdapter } from "../src/account-settings/privacy/account-core-adapter.js";

describe("reviewed profile extraction", () => {
  let db: ReturnType<typeof openDatabase>,
    store: GeneralChatStore,
    app: ReturnType<typeof buildApp>,
    chatId: string,
    source: string,
    target: string;
  const add = (text: string, owner = LOCAL_OWNER_ID) => {
    const c = store.createChat(text, crypto.randomUUID(), owner);
    store.cancelRun(c.run.id, owner);
    return c;
  };
  const enable = (ids: string[] = []) =>
    store.contextMemory.updateSettings(
      { kind: "chat", id: target },
      {
        enabled: true,
        use_personal: true,
        source_chat_ids: ids,
        project_ids: [],
        expected_version: store.contextMemory.settings({ kind: "chat", id: target }, LOCAL_OWNER_ID)
          .version
      },
      LOCAL_OWNER_ID
    );
  const path = () => "/api/v1/memory/targets/chat/" + target + "/profile-candidates";
  const scan = async () => (await app.inject({ url: path() })).json<ProfileCandidatePage>();
  const confirm = (id: string, extra = {}) =>
    app.inject({
      method: "POST",
      url: path() + "/confirm",
      payload: { candidate_id: id, ...extra }
    });
  beforeEach(async () => {
    db = openDatabase(":memory:");
    await runMigrations(db);
    store = new GeneralChatStore(db.sqlite);
    const c = add("Я предпочитаю краткие ответы на русском.");
    chatId = c.chat.id;
    source = c.userMessage.id;
    target = add("Рабочая беседа").chat.id;
    app = buildApp({
      config: loadServerConfig({ NODE_ENV: "test" }),
      database: db,
      generalChatStore: store
    });
  });
  afterEach(async () => {
    await app.close();
    db.close();
  });
  it("does not scan unselected sources; preview is read-only; confirmation is source-backed and retry-safe", async () => {
    expect((await scan()).enabled).toBe(false);
    enable();
    expect((await scan()).items).toEqual([]);
    enable([chatId]);
    const response = await app.inject({ url: path() });
    expect(response.headers["cache-control"]).toBe("private, no-store");
    const c = response.json<ProfileCandidatePage>().items[0]!;
    expect(c.source.role).toBe("user");
    expect(c.input.scope).toBe("personal");
    expect(store.contextMemory.list(LOCAL_OWNER_ID).items).toEqual([]);
    const saved = (await confirm(c.id)).json<ContextMemoryEntry>();
    expect(saved.source_status).toBe("current");
    expect(saved.source?.quote).toBe(saved.content);
    expect((await confirm(c.id)).json<ContextMemoryEntry>().id).toBe(saved.id);
    expect((await scan()).items).toHaveLength(0);
    store.contextMemory.forget(saved.id, saved.version, LOCAL_OWNER_ID);
    expect((await scan()).items).toHaveLength(0);
  });
  it("offers explicit replacement with versioned history instead of silently overwriting", async () => {
    enable([chatId]);
    const old = store.contextMemory.create(
      {
        scope: "personal",
        scope_id: null,
        kind: "preference",
        title: "Стиль ответа",
        content: "Я предпочитаю подробные ответы.",
        pinned: true,
        expires_at: null,
        source: null
      },
      LOCAL_OWNER_ID
    );
    const c = (await scan()).items[0]!;
    expect(c.replaces[0]?.id).toBe(old.id);
    expect((await confirm(c.id, { replace_id: old.id, expected_version: 99 })).statusCode).toBe(
      409
    );
    const updated = (
      await confirm(c.id, { replace_id: old.id, expected_version: 1 })
    ).json<ContextMemoryEntry>();
    expect(updated.id).toBe(old.id);
    expect(updated.version).toBe(2);
    expect(updated.pinned).toBe(true);
    expect(store.contextMemory.versions(old.id, LOCAL_OWNER_ID)).toHaveLength(2);
    store.contextMemory.forget(updated.id, 2, LOCAL_OWNER_ID);
    expect((await scan()).items).toEqual([]);
  });
  it("rejects stale or revoked candidates, excludes assistant text and recognized credentials", async () => {
    enable([chatId]);
    const c = (await scan()).items[0]!;
    db.sqlite
      .prepare(
        "UPDATE general_chat_messages SET content='Я предпочитаю подробные ответы.' WHERE id=?"
      )
      .run(source);
    expect((await confirm(c.id)).statusCode).toBe(409);
    const fresh = (await scan()).items[0]!;
    enable([]);
    expect((await confirm(fresh.id)).statusCode).toBe(409);
    enable([chatId]);
    db.sqlite.prepare("UPDATE general_chat_messages SET role='assistant' WHERE id=?").run(source);
    expect((await scan()).items).toEqual([]);
    db.sqlite
      .prepare(
        "UPDATE general_chat_messages SET role='user',content='Я предпочитаю кратко. Пароль: fixture-not-a-real-secret' WHERE id=?"
      )
      .run(source);
    expect((await scan()).items).toEqual([]);
  });
  it("excludes hidden/foreign/quoted sources and fences mutation while a task or deletion is active", async () => {
    add("Меня зовут Чужой.", "other");
    enable([chatId]);
    store.workspace.updateContext(chatId, LOCAL_OWNER_ID, {
      excluded_ids: [source],
      summary: "",
      summary_through: null,
      expected_version: 0
    });
    expect((await scan()).items).toEqual([]);
    const quoted = add("Пример: Я предпочитаю всегда покупать акции.");
    enable([quoted.chat.id]);
    expect((await scan()).items).toEqual([]);
    store.workspace.updateContext(chatId, LOCAL_OWNER_ID, {
      excluded_ids: [],
      summary: "",
      summary_through: null,
      expected_version: 1
    });
    enable([chatId]);
    const c = (await scan()).items[0]!;
    const running = store.createMessage(target, "Задача", crypto.randomUUID())!;
    expect((await confirm(c.id)).json<{ error: { code: string } }>().error.code).toBe(
      "MEMORY_RUN_ACTIVE"
    );
    store.cancelRun(running.run.id);
    const now = new Date().toISOString();
    db.sqlite
      .prepare(
        "INSERT INTO kosmora_owner_data_lifecycle(owner_id,epoch,state,operation_id,started_at,updated_at) VALUES(?,1,'deleting','test',?,?)"
      )
      .run(LOCAL_OWNER_ID, now, now);
    expect((await confirm(c.id)).statusCode).toBe(409);
    expect((await app.inject({ url: path() })).statusCode).toBe(409);
  });
  it("persists suppression, exports it, cascades source deletion and deletes owner data", async () => {
    enable([chatId]);
    const c = (await scan()).items[0]!;
    expect(
      (
        await app.inject({
          method: "POST",
          url: path() + "/dismiss",
          payload: { candidate_id: c.id }
        })
      ).statusCode
    ).toBe(200);
    expect((await scan()).items).toEqual([]);
    const privacy = new AccountCorePrivacyAdapter(db.sqlite, async () => {});
    const section = await privacy.export(LOCAL_OWNER_ID);
    expect(section.records.profile_candidate_dismissals).toHaveLength(1);
    expect((await privacy.export("other")).records.profile_candidate_dismissals).toHaveLength(0);
    db.sqlite.prepare("DELETE FROM general_chat_messages WHERE id=?").run(source);
    expect(db.sqlite.prepare("SELECT count(*) n FROM profile_candidate_dismissals").get()).toEqual({
      n: 0
    });
    const another = add("Меня зовут Александр.");
    enable([another.chat.id]);
    const candidate = (await scan()).items[0]!;
    await app.inject({
      method: "POST",
      url: path() + "/dismiss",
      payload: { candidate_id: candidate.id }
    });
    const at = new Date().toISOString();
    db.sqlite
      .prepare(
        "INSERT INTO kosmora_owner_data_lifecycle(owner_id,epoch,state,operation_id,started_at,updated_at) VALUES(?,1,'deleting','test',?,?)"
      )
      .run(LOCAL_OWNER_ID, at, at);
    await privacy.delete(LOCAL_OWNER_ID, 1);
    expect(db.sqlite.prepare("SELECT count(*) n FROM profile_candidate_dismissals").get()).toEqual({
      n: 0
    });
  });
  it("rolls back the memory and revision if recording its review fails", async () => {
    enable([chatId]);
    const c = (await scan()).items[0]!;
    const insert = db.sqlite.prepare(
      "INSERT INTO profile_candidate_dismissals VALUES(?,?,?,NULL,?)"
    );
    db.sqlite.exec("BEGIN");
    for (let i = 0; i < 5000; i++)
      insert.run(LOCAL_OWNER_ID, "fixture-" + i, source, new Date().toISOString());
    db.sqlite.exec("COMMIT");
    expect((await confirm(c.id)).statusCode).toBe(409);
    expect(store.contextMemory.list(LOCAL_OWNER_ID).items).toEqual([]);
    expect(db.sqlite.prepare("SELECT count(*) n FROM context_memory_versions").get()).toEqual({
      n: 0
    });
  });
  it("exports current memory only for the current owner and fences the snapshot", async () => {
    enable([chatId]);
    const c = (await scan()).items[0]!;
    await confirm(c.id);
    const response = await app.inject({ url: "/api/v1/memory/local-snapshot" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    const data = response.json<{ format: string; entries: ContextMemoryEntry[] }>();
    expect(data.format).toBe("kosmora.memory-snapshot.v1");
    expect(data.entries).toHaveLength(1);
    expect(store.contextMemory.localSnapshot("other").entries).toEqual([]);
    const at = new Date().toISOString();
    db.sqlite
      .prepare(
        "INSERT INTO kosmora_owner_data_lifecycle(owner_id,epoch,state,operation_id,started_at,updated_at) VALUES(?,1,'deleting','test',?,?)"
      )
      .run(LOCAL_OWNER_ID, at, at);
    expect((await app.inject({ url: "/api/v1/memory/local-snapshot" })).statusCode).toBe(409);
  });
  it("rejects client-invented text and bounds the scan", async () => {
    enable([chatId]);
    const c = (await scan()).items[0]!;
    expect((await confirm(c.id, { content: "I own this account" })).statusCode).toBe(400);
    for (let i = 0; i < 205; i++)
      db.sqlite
        .prepare(
          "INSERT INTO general_chat_messages(id,chat_id,owner_id,role,content_type,content,status,created_at,updated_at) VALUES(?,?,?,'user','text','Привет','completed',?,?)"
        )
        .run(
          crypto.randomUUID(),
          chatId,
          LOCAL_OWNER_ID,
          new Date().toISOString(),
          new Date().toISOString()
        );
    const p = await scan();
    expect(p.limited).toBe(true);
    expect(p.scanned).toBe(200);
  });
});
