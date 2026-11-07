import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  ContextMemoryEncoder,
  GeneralChatMessage,
  MemoryTarget
} from "@cosmora/contracts";
import {
  ContextMemoryStore,
  openDatabase,
  runMigrations
} from "@cosmora/db";
import { compactChatHistory, verifyHistoryCompaction } from "@cosmora/core";
import { SemanticHistoryIndex } from "../src/semantic-memory/index-service.js";

/**
 * End-to-end acceptance for the Kosmora/Koswork memory block.
 *
 * Real: SQLite schema, migrations, FTS/lexical recall, scoped grants, versioned
 * entries, source revalidation, compaction, privacy-driven deletion, index tables.
 * Fixture: the embedding encoder is a deterministic one-hot stand-in, so the
 * paraphrase path proves the pipeline, NOT real E5 quality. No provider is called.
 */
describe("memory acceptance: long work, versions, correction and revocation", () => {
  let db: ReturnType<typeof openDatabase>;
  let memory: ContextMemoryStore;
  let index: SemanticHistoryIndex;
  let now: number;
  const at = "2026-11-02T09:00:00.000Z";
  const target: MemoryTarget = { kind: "chat", id: "work" };
  const filler = (n: number) =>
    ("Подробное описание визуального варианта оформления, часть " + n + ". ").repeat(24);

  const msgs: [GeneralChatMessage["role"], string][] = [
    ["user", "Проект «Логистика». Заявка 00123, бюджет 17 350 ₽. Доставка не входит."],
    ["assistant", filler(1)],
    ["user", "Уточнение от 2026-11-02: бюджет 19 700 ₽ на заявку 00123."],
    ["assistant", filler(2)],
    ["user", "Добавь в письмо дату 02.11.2026 и сумму 19 700 ₽."],
    ["assistant", "Итого 21 000 ₽ с доставкой — по моей оценке."],
    ["user", "Без доставки. Кроме доставки ничего не добавлять."],
    ["assistant", filler(3)],
    ["user", "Статус: письмо не отправлено, ждём согласования."],
    ["assistant", filler(4)],
    ["user", "Код заявки 00123 не менять."],
    ["assistant", filler(5)],
    ["user", "Следующий шаг — проверить адрес доставки."],
    ["assistant", filler(6)],
    ["user", "И ещё правка: срок 05.11.2026."],
    ["assistant", filler(7)],
    ["user", "Напомни: какой бюджет заявки и что с доставкой?"]
  ];

  const corpus = (): GeneralChatMessage[] =>
    msgs.map(([role, content], i) => ({
      id: "m-" + String(i).padStart(2, "0"),
      chat_id: "archive",
      role,
      content_type: "text",
      content,
      status: "completed",
      run_id: null,
      error_code: null,
      created_at: new Date(Date.parse(at) + i * 60_000).toISOString(),
      updated_at: at
    }));

  const seed = () => {
    const insert = db.sqlite.prepare(
      "INSERT INTO general_chat_messages(id,chat_id,owner_id,role,content_type,content,status,created_at,updated_at) VALUES(?,?,?,?,'text',?,'completed',?,?)"
    );
    for (const m of corpus()) insert.run(m.id, m.chat_id, "a", m.role, m.content, m.created_at, at);
  };

  const settings = (extra: Record<string, unknown> = {}) =>
    memory.updateSettings(
      target,
      {
        enabled: true,
        use_personal: false,
        source_chat_ids: ["archive"],
        project_ids: [],
        expected_version: memory.settings(target, "a").version,
        ...extra
      },
      "a"
    );

  beforeEach(async () => {
    db = openDatabase(":memory:");
    await runMigrations(db);
    now = Date.parse(at);
    memory = new ContextMemoryStore(db.sqlite, () => now);
    for (const [id, owner] of [
      ["work", "a"],
      ["archive", "a"],
      ["ungranted", "a"],
      ["foreign", "b"]
    ])
      db.sqlite
        .prepare("INSERT INTO general_chats(id,owner_id,title,created_at,updated_at) VALUES(?,?,?,?,?)")
        .run(id!, owner!, id!, at, at);
    seed();
  });
  afterEach(async () => {
    await index?.stop();
    db.close();
  });

  it("compacts long work without dropping numbers, the exception or the source links", () => {
    const original = corpus();
    const before = JSON.stringify(original);
    const result = compactChatHistory(original, {
      enabled: true,
      query: "какой бюджет заявки и что с доставкой"
    });
    expect(result.report.state).toBe("applied");
    expect(result.report.protected_kept).toBe(result.report.protected_spans);
    expect(result.report.capsule_bytes).toBeLessThan(result.report.source_bytes!);
    expect(result.memory!.bytes).toBeLessThanOrEqual(8000);
    expect(verifyHistoryCompaction(original, result.memory!)).toBe(true);

    const capsule = result.memory!.items.map((e) => e.text).join("\n");
    for (const value of ["19 700", "00123", "Кроме доставки", "17 350"])
      expect(capsule).toContain(value);

    // Every recalled span must point at a real message and its exact bytes.
    const byId = new Map(original.map((m) => [m.id, m]));
    for (const item of result.memory!.items) {
      const source = item.source!;
      const message = byId.get(source.message_id)!;
      expect(message).toBeDefined();
      expect(message.content).toContain(item.text);
      expect(source.role).toBe(message.role);
      expect(item.reference).toBe("H:g:" + message.id);
    }
    // An assistant estimate keeps assistant authority even when it cites numbers.
    const claim = result.memory!.items.find((e) => e.text.includes("21 000"));
    if (claim) {
      expect(claim.source!.role).toBe("assistant");
      expect(claim.priority).not.toBe(true);
    }
    expect(result.messages.at(-1)?.id).toBe("m-16");
    expect(JSON.stringify(original)).toBe(before);
  });

  it("recalls the corrected value and origin, and never resurrects the old one", async () => {
    settings();
    const v2 = corpus().find((m) => m.id === "m-02")!;
    const entry = memory.create(
      {
        scope: "chat",
        scope_id: "work",
        kind: "decision",
        title: "Бюджет заявки 00123",
        content: "Бюджет 19 700 ₽, доставка не входит.",
        pinned: true,
        expires_at: null,
        source: { kind: "chat_message", message_id: v2.id, quote: "бюджет 19 700 ₽" }
      },
      "a"
    );
    expect(entry.source_status).toBe("current");
    expect(entry.source!.sha256).toHaveLength(64);

    const found = await memory.resolveAsync(target, "a", "бюджет заявки");
    const recalled = found.items.find((e) => e.reference === "M:" + entry.id)!;
    expect(recalled.text).toContain("19 700");
    expect(recalled.source!.message_id).toBe(v2.id);
    expect(recalled.version).toBe(1);
    // History evidence for the superseded figure stays attributed, not merged.
    const old = found.items.filter((e) => e.kind === "history" && e.text.includes("17 350"));
    expect(old.every((e) => e.source!.role === "user")).toBe(true);
    expect(found.items.some((e) => e.text.includes("17 350") && e.kind === "memory")).toBe(false);

    const corrected = memory.update(
      entry.id,
      1,
      {
        scope: "chat",
        scope_id: "work",
        kind: "decision",
        title: "Бюджет заявки 00123",
        content: "Бюджет 19 700 ₽ утверждён 2026-11-07, доставка не входит.",
        pinned: true,
        expires_at: null,
        source: { kind: "chat_message", message_id: v2.id, quote: "бюджет 19 700 ₽" }
      },
      "a"
    );
    expect(corrected.version).toBe(2);
    const after = await memory.resolveAsync(target, "a", "бюджет заявки");
    expect(after.items.find((e) => e.reference === "M:" + entry.id)!.text).toContain("2026-11-07");
    expect(memory.versions(entry.id, "a")).toHaveLength(2);
    expect(() => memory.update(entry.id, 1, corrected, "a")).toThrow("STALE_MEMORY");
  });

  it("finds a paraphrase through the index (fixture encoder) and drops it after revocation", async () => {
    // One-hot fixture: only the logistics material and the paraphrase share a vector.
    const unit = (n: number) => Array.from({ length: 384 }, (_, i) => (i === n ? 1 : 0));
    const encoder: ContextMemoryEncoder = {
      encoder: "fixture-onehot",
      drain: () => Promise.resolve(),
      rank: () => Promise.reject(new Error("legacy rank must not run")),
      embed: async (_kind, texts) => {
        await Promise.resolve();
        return {
          encoder: "fixture-onehot",
          vectors: texts.map((t) => unit(/Логистика|перевозк|груз/.test(t) ? 1 : 2))
        };
      }
    };
    settings();
    index = new SemanticHistoryIndex(db.sqlite, encoder, { now: () => now });
    memory.indexedRecall = index;
    for (let n = 0; n < 250; n++) {
      if (index.store.progress(target, "a", index.format).state !== "building") break;
      await index.buildOnce(target, "a");
    }
    const paraphrase = await memory.resolveAsync(target, "a", "какая сумма по перевозке груза");
    expect(paraphrase.retrieval).toBe("hybrid");
    expect(paraphrase.items[0]?.reference).toBe("H:g:m-00");
    expect(paraphrase.semantic_retrieval?.encoder).toBe("fixture-onehot");

    // Revocation must not be bypassed by the index or its rows.
    memory.updateSettings(
      target,
      {
        enabled: true,
        use_personal: false,
        source_chat_ids: [],
        project_ids: [],
        expected_version: memory.settings(target, "a").version
      },
      "a"
    );
    const revoked = await memory.resolveAsync(target, "a", "какая сумма по перевозке груза");
    expect(revoked.items).toEqual([]);
    expect(
      db.sqlite.prepare("SELECT count(*) n FROM semantic_index_sources").get()
    ).toEqual({ n: 0 });
  });

  it("erases a chat's memory through the existing store and leaves originals intact", async () => {
    settings();
    memory.create(
      {
        scope: "chat",
        scope_id: "work",
        kind: "fact",
        title: "Код заявки",
        content: "Код 00123.",
        pinned: false,
        expires_at: null,
        source: null
      },
      "a"
    );
    expect((await memory.resolveAsync(target, "a", "код заявки")).items.length).toBeGreaterThan(0);
    const result = memory.forgetScope(target, "a");
    expect(result.forgotten_entries).toBe(1);
    expect(result.original_messages_deleted).toBe(false);
    expect(
      db.sqlite.prepare("SELECT count(*) n FROM general_chat_messages").get()
    ).toEqual({ n: msgs.length });
    const after = await memory.resolveAsync(target, "a", "код заявки");
    expect(after.items.some((e) => e.kind === "memory")).toBe(false);
  });

  it("keeps another project's closed data out of a scoped recall", async () => {
    db.sqlite
      .prepare("INSERT INTO projects(id,owner_id,title,status,created_at,updated_at) VALUES('p1','a','P1','ACTIVE',?,?)")
      .run(at, at);
    db.sqlite
      .prepare("INSERT INTO chats(id,project_id,kind,created_at) VALUES('c-p1','p1','main',?)")
      .run(at);
    db.sqlite
      .prepare(
        "INSERT INTO messages(id,project_id,chat_id,role,content_type,content,status,created_at,updated_at) VALUES('pm1','p1','c-p1','user','text','Закрытая смета 19 700 ₽','completed',?,?)"
      )
      .run(at, at);
    settings({ project_ids: ["p1"] });
    const found = await memory.resolveAsync(target, "a", "смета 19 700");
    expect(found.items.some((e) => e.reference === "H:p:pm1")).toBe(true);
    memory.updateSettings(
      target,
      {
        enabled: true,
        use_personal: false,
        source_chat_ids: ["archive"],
        project_ids: [],
        expected_version: memory.settings(target, "a").version
      },
      "a"
    );
    const without = await memory.resolveAsync(target, "a", "смета 19 700");
    expect(without.items.some((e) => e.reference === "H:p:pm1")).toBe(false);
  });
});
