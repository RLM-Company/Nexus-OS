import { beforeEach, afterEach, describe, expect, it } from "vitest";
import type { ContextMemoryInput, MemoryTarget } from "@cosmora/contracts";
import { openDatabase, runMigrations, ContextMemoryStore } from "../src/index.js";

describe("source-backed context memory", () => {
  let db: ReturnType<typeof openDatabase>;
  let memory: ContextMemoryStore;
  let now: number;
  const at = "2026-10-30T09:00:00.000Z";
  const target: MemoryTarget = { kind: "chat", id: "new" };
  const input = (extra: Partial<ContextMemoryInput> = {}): ContextMemoryInput => ({
    scope: "personal",
    scope_id: null,
    kind: "preference",
    title: "Формат ответа",
    content: "Пиши кратко по-русски.",
    pinned: false,
    expires_at: null,
    source: null,
    ...extra
  });
  const enable = (extra = {}, t = target) =>
    memory.updateSettings(
      t,
      {
        enabled: true,
        use_personal: false,
        source_chat_ids: [],
        project_ids: [],
        expected_version: 0,
        ...extra
      },
      "a"
    );
  const message = (id: string, chat: string, content: string, owner = "a", role = "user") =>
    db.sqlite
      .prepare(
        "INSERT INTO general_chat_messages(id,chat_id,owner_id,role,content_type,content,status,created_at,updated_at) VALUES(?,?,?,?,'text',?,'completed',?,?)"
      )
      .run(id, chat, owner, role, content, at, at);
  beforeEach(async () => {
    db = openDatabase(":memory:");
    await runMigrations(db);
    now = Date.parse(at);
    memory = new ContextMemoryStore(db.sqlite, () => now);
    for (const [id, owner] of [
      ["old", "a"],
      ["new", "a"],
      ["other", "b"]
    ])
      db.sqlite
        .prepare(
          "INSERT INTO general_chats(id,owner_id,title,created_at,updated_at) VALUES(?,?,?,?,?)"
        )
        .run(id!, owner!, id!, at, at);
    for (const [id, owner] of [
      ["p1", "a"],
      ["p2", "a"],
      ["p3", "b"]
    ]) {
      db.sqlite
        .prepare(
          "INSERT INTO projects(id,owner_id,title,status,created_at,updated_at) VALUES(?,?,?,'ACTIVE',?,?)"
        )
        .run(id!, owner!, id!, at, at);
      db.sqlite
        .prepare("INSERT INTO chats(id,project_id,kind,created_at) VALUES(?,?,'main',?)")
        .run("c-" + id, id!, at);
    }
  });
  afterEach(() => db.close());

  it("keeps existing chats unchanged by default and requires explicit personal and history grants", () => {
    memory.create(input(), "a");
    message("m1", "old", "Джалиль утвердил бюджет 17350 рублей.");
    expect(memory.resolve(target, "a", "Джалиль бюджет").items).toEqual([]);
    enable();
    expect(memory.resolve(target, "a", "Джалиль бюджет").items).toEqual([]);
    memory.updateSettings(
      target,
      {
        enabled: true,
        use_personal: true,
        source_chat_ids: ["old"],
        project_ids: [],
        expected_version: 1
      },
      "a"
    );
    const found = memory.resolve(target, "a", "Джалиль бюджет");
    expect(found.items.some((e) => e.reference === "H:g:m1" && e.text.includes("17350"))).toBe(
      true
    );
    expect(found.items.some((e) => e.memory_kind === "preference")).toBe(true);
    expect(memory.get("missing", "a")).toBeNull();
    expect(() => memory.settings(target, "b")).toThrow("MEMORY_TARGET_NOT_FOUND");
    expect(() =>
      memory.updateSettings(
        target,
        {
          enabled: true,
          use_personal: true,
          source_chat_ids: ["other"],
          project_ids: [],
          expected_version: 2
        },
        "a"
      )
    ).toThrow("MEMORY_TARGET_NOT_FOUND");
    expect(memory.settings(target, "a").version).toBe(2);
  });
  it("keeps compaction off by default, preserves it for older clients and rejects project activation", () => {
    expect(memory.settings(target, "a").compact_history).toBe(false);
    expect(enable({ compact_history: true }).compact_history).toBe(true);
    const legacy = {
      enabled: true,
      use_personal: false,
      source_chat_ids: [],
      project_ids: [],
      expected_version: 1
    };
    expect(memory.updateSettings(target, legacy, "a").compact_history).toBe(true);
    expect(() =>
      memory.updateSettings(
        { kind: "project", id: "p1" },
        { ...legacy, expected_version: 0, compact_history: true },
        "a"
      )
    ).toThrow("COMPACTION_CHAT_ONLY");
    expect(memory.settings({ kind: "project", id: "p1" }, "a").version).toBe(0);
  });
  it("never shares a chat or project memory without its target grant", () => {
    memory.create(input({ scope: "chat", scope_id: "old", content: "Chat-only style." }), "a");
    memory.create(input({ scope: "project", scope_id: "p2", content: "Project-only style." }), "a");
    enable();
    expect(memory.resolve(target, "a", "style").items).toHaveLength(0);
    memory.updateSettings(
      target,
      {
        enabled: true,
        use_personal: false,
        source_chat_ids: ["old"],
        project_ids: ["p2"],
        expected_version: 1
      },
      "a"
    );
    expect(memory.resolve(target, "a", "style").items).toHaveLength(2);
    const p: MemoryTarget = { kind: "project", id: "p1" };
    enable({}, p);
    expect(memory.resolve(p, "a", "style").items).toHaveLength(0);
    expect(() => enable({ project_ids: ["p3"] }, { kind: "project", id: "p2" })).toThrow(
      "MEMORY_TARGET_NOT_FOUND"
    );
  });
  it("makes explicitly saved personal identity available without a literal keyword match", () => {
    const name = memory.create(input({ kind: "fact", title: "Имя", content: "Александр" }), "a");
    memory.create(
      input({ kind: "hypothesis", title: "Гипотеза", content: "Возможно, нужен новый офис." }),
      "a"
    );
    enable({ use_personal: true });
    const result = memory.resolve(target, "a", "Как меня зовут?");
    expect(result.items.map((e) => e.reference)).toEqual(["M:" + name.id]);
  });
  it("validates exact quotes, owner, source role and stable source hashes", () => {
    message("m1", "old", "Бюджет: 17350 рублей.", "a", "assistant");
    message("m2", "other", "Бюджет: 777 рублей.", "b");
    expect(() =>
      memory.create(
        input({ source: { kind: "chat_message", message_id: "m2", quote: "777" } }),
        "a"
      )
    ).toThrow("MEMORY_SOURCE_NOT_FOUND");
    expect(() =>
      memory.create(
        input({ source: { kind: "chat_message", message_id: "m1", quote: "миллион" } }),
        "a"
      )
    ).toThrow("MEMORY_SOURCE_NOT_FOUND");
    const saved = memory.create(
      input({
        content: "17350",
        source: { kind: "chat_message", message_id: "m1", quote: "17350" }
      }),
      "a"
    );
    expect(saved.source).toMatchObject({ chat_id: "old", role: "assistant", quote: "17350" });
    expect(saved.source?.sha256).toMatch(/^[a-f0-9]{64}$/);
    enable({ use_personal: true });
    expect(memory.resolve(target, "a", "бюджет").items).toHaveLength(1);
    db.sqlite
      .prepare("UPDATE general_chat_messages SET content='Бюджет: 19000 рублей.' WHERE id='m1'")
      .run();
    expect(memory.get(saved.id, "a")?.source_status).toBe("changed");
    expect(memory.resolve(target, "a", "бюджет").items).toHaveLength(0);
    expect(() => memory.sourceFor(target, "a", "M:" + saved.id)).toThrow("MEMORY_SOURCE_NOT_FOUND");
  });
  it("honors exclusions, archived chats and fresh source access checks on every read", () => {
    message("m1", "old", "Джалиль бюджет 17350");
    const entry = memory.create(
      input({ source: { kind: "chat_message", message_id: "m1", quote: "17350" } }),
      "a"
    );
    enable({ use_personal: true, source_chat_ids: ["old"] });
    expect(memory.sourceFor(target, "a", "H:g:m1").content).toContain("17350");
    db.sqlite
      .prepare(
        "INSERT INTO chat_context_settings(chat_id,excluded_json,summary,summary_through,version,updated_at) VALUES('old','[\"m1\"]','',NULL,1,?)"
      )
      .run(at);
    expect(memory.resolve(target, "a", "Джалиль").items).toEqual([]);
    expect(memory.get(entry.id, "a")?.source_status).toBe("unavailable");
    expect(() => memory.sourceFor(target, "a", "H:g:m1")).toThrow("MEMORY_SOURCE_NOT_FOUND");
    db.sqlite.prepare("DELETE FROM chat_context_settings WHERE chat_id='old'").run();
    db.sqlite.prepare("UPDATE general_chats SET archived=1 WHERE id='old'").run();
    expect(memory.resolve(target, "a", "Джалиль").items).toEqual([]);
  });
  it("versions edits, rejects stale changes and forgets every revision without deleting the source", () => {
    message("m1", "old", "Бюджет 17350");
    const entry = memory.create(
      input({ source: { kind: "chat_message", message_id: "m1", quote: "17350" } }),
      "a"
    );
    memory.update(entry.id, 1, input({ content: "Новый формат." }), "a");
    expect(memory.versions(entry.id, "a").map((v) => v.version)).toEqual([2, 1]);
    expect(() => memory.update(entry.id, 1, input(), "a")).toThrow("STALE_MEMORY");
    expect(() => memory.forget(entry.id, 1, "a")).toThrow("STALE_MEMORY");
    expect(() => memory.forget(entry.id, 2, "b")).toThrow("MEMORY_NOT_FOUND");
    expect(memory.forget(entry.id, 2, "a")).toEqual({
      forgotten: true,
      original_messages_deleted: false
    });
    expect(db.sqlite.prepare("SELECT * FROM context_memory_versions").all()).toEqual([]);
    expect(
      db.sqlite.prepare("SELECT id FROM general_chat_messages WHERE id='m1'").get()
    ).toBeTruthy();
  });
  it("deleting original messages removes derived entries and revisions referring to former sources", () => {
    message("m1", "old", "Бюджет 17350");
    const sourced = input({ source: { kind: "chat_message", message_id: "m1", quote: "17350" } });
    const first = memory.create(sourced, "a"),
      edited = memory.create(sourced, "a");
    memory.update(edited.id, 1, input(), "a");
    db.sqlite.prepare("DELETE FROM general_chat_messages WHERE id='m1'").run();
    expect(memory.get(first.id, "a")).toBeNull();
    expect(memory.versions(edited.id, "a").map((e) => e.version)).toEqual([2]);
    expect(db.sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });
  it("expires temporary facts, labels hypotheses and preserves exact numeric constraints", () => {
    const expiring = memory.create(input({ expires_at: "2026-10-31T00:00:00.000Z" }), "a");
    memory.create(input({ kind: "hypothesis", content: "Джалиль, возможно, согласен." }), "a");
    memory.create(
      input({
        kind: "constraint",
        content: "Не менять sidebar; бюджет ≤17350.25 ₽; срок 02.11.2026."
      }),
      "a"
    );
    enable({ use_personal: true });
    const found = memory.resolve(target, "a", "Джалиль");
    expect(found.items.find((e) => e.memory_kind === "constraint")?.text).toContain("≤17350.25");
    expect(found.items.find((e) => e.memory_kind === "hypothesis")?.text).toContain("возможно");
    now = Date.parse("2026-10-31T01:00:00Z");
    expect(
      memory.resolve(target, "a", "Джалиль").items.some((e) => e.reference === "M:" + expiring.id)
    ).toBe(false);
  });
  it("deduplicates evidence and bounds the complete UTF-8 bundle without cutting facts", () => {
    const content = "Не менять sidebar; точное число 17350.25";
    memory.create(input({ kind: "constraint", content }), "a");
    memory.create(input({ kind: "constraint", content }), "a");
    for (let i = 0; i < 8; i++)
      memory.create(input({ kind: "constraint", content: String(i) + "🚀".repeat(490) }), "a");
    enable({ use_personal: true });
    const bundle = memory.resolve(target, "a", "sidebar", [], 1000);
    expect(bundle.items.filter((e) => e.text === content)).toHaveLength(1);
    expect(bundle.omitted).toBeGreaterThan(0);
    expect(bundle.priority_omitted).toBeGreaterThan(0);
    expect(Buffer.byteLength(JSON.stringify(bundle))).toBe(bundle.bytes);
    expect(bundle.bytes).toBeLessThanOrEqual(1000);
  });
  it("retrieves an old fact from long history, preserving numbers and originals with a small context", () => {
    for (let i = 0; i < 140; i++)
      message(
        "history-" + i,
        "old",
        i === 4
          ? "Договор BR-941: ставка 17.5%, дата 2026-11-02, ответственный Джалиль."
          : "Нерелевантный материал ".repeat(100)
      );
    enable({ source_chat_ids: ["old"] });
    const bundle = memory.resolve(target, "a", "BR-941");
    expect(bundle.items).toHaveLength(1);
    expect(bundle.items[0]?.text).toContain("17.5%");
    expect(bundle.bytes).toBeLessThan(6000);
    const raw = db.sqlite
      .prepare("SELECT sum(length(CAST(content AS BLOB))) n FROM general_chat_messages")
      .get() as { n: number };
    expect(raw.n).toBeGreaterThan(bundle.bytes * 100);
    expect(db.sqlite.prepare("SELECT count(*) n FROM general_chat_messages").get()).toEqual({
      n: 140
    });
  });
  it("never treats FTS syntax as operators or returns an ungranted source", () => {
    message("a", "old", "Джалиль бюджет 17350");
    message("b", "other", "Джалиль чужой бюджет 777", "b");
    enable({ source_chat_ids: ["old"] });
    expect(() => memory.resolve(target, "a", '" OR * NEAR(Джалиль)')).not.toThrow();
    expect(() => memory.sourceFor(target, "a", "H:g:b")).toThrow("MEMORY_SOURCE_NOT_FOUND");
    expect(memory.resolve(target, "a", "Джалиль", ["a"]).items).toEqual([]);
    memory.updateSettings(
      target,
      {
        enabled: false,
        use_personal: true,
        source_chat_ids: ["old"],
        project_ids: [],
        expected_version: 1
      },
      "a"
    );
    expect(() => memory.sourceFor(target, "a", "H:g:a")).toThrow("MEMORY_SOURCE_NOT_FOUND");
  });
  it("rejects known credentials and does not recall a secret elsewhere in a source message", () => {
    expect(() => memory.create(input({ content: "password: fixture-secret-value" }), "a")).toThrow(
      "MEMORY_SECRET_UNSUPPORTED"
    );
    message("sensitive", "old", "Джалиль бюджет 17350. api_key: fixture-secret-value");
    enable({ source_chat_ids: ["old"] });
    expect(memory.resolve(target, "a", "Джалиль бюджет").items).toEqual([]);
    expect(() => memory.sourceFor(target, "a", "H:g:sensitive")).toThrow("MEMORY_SOURCE_NOT_FOUND");
    expect(
      memory.create(input({ content: "Не спрашивай пароль. Бюджет 17350." }), "a")
    ).toBeTruthy();
  });
  it("reconciles a lost creation response by key and rejects a changed replay", () => {
    const first = memory.create(input(), "a", "create-1");
    expect(memory.create(input(), "a", "create-1").id).toBe(first.id);
    expect(() => memory.create(input({ content: "Different." }), "a", "create-1")).toThrow(
      "MEMORY_CREATION_CONFLICT"
    );
    expect(memory.list("a").items).toHaveLength(1);
    memory.update(first.id, 1, input({ content: "Edited." }), "a");
    expect(memory.create(input(), "a", "create-1").content).toBe("Edited.");
  });
  it("retrieves project evidence only from a selected owned project", () => {
    db.sqlite
      .prepare(
        "INSERT INTO messages(id,project_id,chat_id,role,content_type,content,status,created_at,updated_at) VALUES('pm1','p1','c-p1','user','text','Джалиль согласовал 17350','completed',?,?)"
      )
      .run(at, at);
    enable({}, { kind: "project", id: "p1" });
    expect(memory.resolve({ kind: "project", id: "p1" }, "a", "Джалиль").items[0]?.reference).toBe(
      "H:p:pm1"
    );
    expect(() => memory.sourceFor(target, "a", "H:p:pm1")).toThrow("MEMORY_SOURCE_NOT_FOUND");
    enable({ project_ids: ["p1"] });
    expect(memory.sourceFor(target, "a", "H:p:pm1").content).toContain("17350");
    expect(() => memory.create(input({ scope: "project", scope_id: "p3" }), "a")).toThrow(
      "MEMORY_TARGET_NOT_FOUND"
    );
  });
  it("blocks mutations during active work, rejects invalid scope/date and searches Cyrillic case-insensitively", () => {
    memory.create(input({ title: "ЧЁРНЫЙ СТИЛЬ" }), "a");
    expect(memory.list("a", 0, "чёрный").items).toHaveLength(1);
    expect(() => memory.create(input({ scope: "chat", scope_id: null }), "a")).toThrow(
      "INVALID_MEMORY"
    );
    expect(() => memory.create(input({ expires_at: "yesterday" }), "a")).toThrow("INVALID_MEMORY");
    db.sqlite
      .prepare(
        "INSERT INTO general_chat_runs(id,chat_id,status,created_at,updated_at) VALUES('r','old','running',?,?)"
      )
      .run(at, at);
    expect(() => memory.create(input(), "a")).toThrow("MEMORY_RUN_ACTIVE");
    db.sqlite.prepare("UPDATE general_chat_runs SET status='cancelled' WHERE id='r'").run();
    db.sqlite
      .prepare(
        "INSERT INTO kosmora_owner_data_lifecycle(owner_id,epoch,state,operation_id,started_at,updated_at) VALUES('a',1,'deleting','delete',?,?)"
      )
      .run(at, at);
    expect(() => memory.resolve(target, "a", "style")).toThrow("OWNER_DATA_FENCED");
    expect(() => memory.create(input(), "a")).toThrow("OWNER_DATA_FENCED");
  });
});
