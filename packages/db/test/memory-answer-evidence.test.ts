import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ContextMemoryInput, MemoryTarget } from "@cosmora/contracts";
import { ContextMemoryStore, openDatabase, runMigrations } from "../src/index.js";

/**
 * Fixed acceptance panel for the memory honesty signal (slice A).
 * Real SQLite schema + FTS, no external provider or live model.
 */
describe("memory answer_evidence fixed panel", () => {
  let db: ReturnType<typeof openDatabase>;
  let memory: ContextMemoryStore;
  const at = "2026-11-10T12:00:00.000Z";
  const target: MemoryTarget = { kind: "chat", id: "work" };
  const input = (extra: Partial<ContextMemoryInput> = {}): ContextMemoryInput => ({
    scope: "personal",
    scope_id: null,
    kind: "fact",
    title: "Бюджет",
    content: "Согласовано 19 700 ₽, кроме доставки.",
    pinned: false,
    expires_at: null,
    source: null,
    ...extra
  });
  const enable = (extra: Record<string, unknown> = {}) =>
    memory.updateSettings(
      target,
      {
        enabled: true,
        use_personal: true,
        source_chat_ids: ["archive"],
        project_ids: [],
        expected_version: memory.settings(target, "a").version,
        ...extra
      },
      "a"
    );
  const message = (id: string, text: string, owner = "a") =>
    db.sqlite
      .prepare(
        "INSERT INTO general_chat_messages(id,chat_id,owner_id,role,content_type,content,status,created_at,updated_at) VALUES(?,?,?,'user','text',?,'completed',?,?)"
      )
      .run(id, owner === "a" ? "archive" : "foreign", owner, text, at, at);

  beforeEach(async () => {
    db = openDatabase(":memory:");
    await runMigrations(db);
    memory = new ContextMemoryStore(db.sqlite, () => Date.parse(at));
    for (const [id, owner] of [
      ["work", "a"],
      ["archive", "a"],
      ["foreign", "b"]
    ] as const)
      db.sqlite
        .prepare(
          "INSERT INTO general_chats(id,owner_id,title,created_at,updated_at) VALUES(?,?,?,?,?)"
        )
        .run(id, owner, id, at, at);
  });
  afterEach(() => db.close());

  it("matched: a query with a real source yields answer_evidence=matched", () => {
    memory.create(input(), "a");
    enable();
    const bundle = memory.resolve(target, "a", "сколько согласовано бюджет");
    expect(bundle.answer_evidence).toBe("matched");
    expect(bundle.matched_items).toBeGreaterThan(0);
    expect(bundle.items.some((e) => e.matched === true)).toBe(true);
    expect(bundle.items.some((e) => e.text.includes("19 700"))).toBe(true);
  });

  it("absent: an unrelated question keeps mandatory constraints but is NOT an answer", () => {
    // A pinned constraint must survive topical filtering, yet must not be
    // presented as evidence answering an unrelated question.
    memory.create(
      input({
        kind: "constraint",
        title: "Ограничение",
        content: "Не менять сайдбар.",
        pinned: true
      }),
      "a"
    );
    enable();
    const bundle = memory.resolve(target, "a", "какая погода на Марсе в марте");
    expect(bundle.items.length).toBeGreaterThan(0);
    expect(bundle.items.every((e) => e.matched !== true)).toBe(true);
    expect(bundle.answer_evidence).toBe("absent");
    expect(bundle.matched_items).toBe(0);
  });

  it("absent: disabled memory stays absent with no items", () => {
    memory.create(input(), "a");
    const bundle = memory.resolve(target, "a", "бюджет");
    expect(bundle.answer_evidence).toBe("absent");
    expect(bundle.items).toEqual([]);
  });

  it("contradiction: old and new versions stay distinct, neither is silently merged", () => {
    const first = memory.create(
      input({ kind: "decision", content: "Бюджет 17 350 ₽, версия 1." }),
      "a"
    );
    memory.update(
      first.id,
      1,
      input({ kind: "decision", content: "Бюджет 19 700 ₽, версия 2." }),
      "a"
    );
    enable();
    const bundle = memory.resolve(target, "a", "бюджет");
    // Only the current version of the entry is recalled; old text is not resurrected.
    expect(bundle.items.some((e) => e.text.includes("19 700"))).toBe(true);
    expect(bundle.items.some((e) => e.text.includes("17 350"))).toBe(false);
    expect(memory.versions(first.id, "a")).toHaveLength(2);
  });

  it("forget: a forgotten entry never returns via lexical recall", () => {
    const entry = memory.create(input(), "a");
    enable();
    expect(memory.resolve(target, "a", "бюджет").answer_evidence).toBe("matched");
    memory.forget(entry.id, entry.version, "a");
    const after = memory.resolve(target, "a", "бюджет");
    expect(after.answer_evidence).toBe("absent");
    expect(after.items.some((e) => e.reference === "M:" + entry.id)).toBe(false);
  });

  it("revoke: removing the grant makes the answer absent without hidden reads", () => {
    memory.create(input(), "a");
    enable();
    expect(memory.resolve(target, "a", "бюджет").answer_evidence).toBe("matched");
    enable({ use_personal: false, source_chat_ids: [] });
    const after = memory.resolve(target, "a", "бюджет");
    expect(after.answer_evidence).toBe("absent");
    expect(after.items).toEqual([]);
  });

  it("cross-owner: another owner's data never enters this owner's bundle", () => {
    message("m-b", "Секрет владельца b: 77 777 ₽", "b");
    memory.create(input({ content: "Бюджет владельца a: 19 700 ₽." }), "a");
    memory.create(input({ content: "Секрет владельца b: 77 777 ₽." }), "b");
    enable();
    const bundle = memory.resolve(target, "a", "бюджет секрет 77777");
    expect(bundle.answer_evidence).toBe("matched");
    expect(bundle.items.some((e) => e.text.includes("77 777"))).toBe(false);
    expect(bundle.items.some((e) => e.text.includes("19 700"))).toBe(true);
    // The target chat belongs to "a": owner "b" cannot resolve it at all.
    expect(() => memory.resolve(target, "b", "77 777")).toThrow();
  });

  it("read-back: the original message is reachable by reference after recall", () => {
    message("m-src", "Бюджет 19 700 ₽, кроме доставки. Код 00123.");
    enable();
    const bundle = memory.resolve(target, "a", "бюджет 19 700");
    const hit = bundle.items.find((e) => e.kind === "history" && e.source);
    expect(hit).toBeDefined();
    const original = memory.sourceFor(target, "a", hit!.reference);
    expect(original.content).toContain("19 700 ₽");
    expect(original.content).toContain("00123");
    expect(original.source.message_id).toBe("m-src");
  });

  it("revoke removes the source reason: read-back is refused after grant loss", () => {
    message("m-src", "Бюджет 19 700 ₽, кроме доставки.");
    enable();
    const bundle = memory.resolve(target, "a", "бюджет 19 700");
    const reference = bundle.items.find((e) => e.source)!.reference;
    expect(() => memory.sourceFor(target, "a", reference)).not.toThrow();
    enable({ source_chat_ids: [] });
    expect(() => memory.sourceFor(target, "a", reference)).toThrow("MEMORY_SOURCE_NOT_FOUND");
  });

  it("async owner fence: fuseSemantic fails closed after an owner is fenced", () => {
    memory.create(input(), "a");
    enable();
    db.sqlite
      .prepare(
        "INSERT INTO kosmora_owner_data_lifecycle(owner_id,epoch,state,operation_id,started_at,updated_at) VALUES('a',1,'deleting','d',?,?)"
      )
      .run(at, at);
    expect(() =>
      memory.fuseSemantic(target, "a", "бюджет", [], 6000, 1, [], "fixture", false)
    ).toThrow("OWNER_DATA_FENCED");
  });

  it("async owner fence: resolveAsync degrades safely when the encoder is absent", async () => {
    memory.create(input(), "a");
    enable();
    // No semanticRanker/indexedRecall: resolveAsync takes the synchronous path.
    const bundle = await memory.resolveAsync(target, "a", "бюджет");
    expect(bundle.answer_evidence).toBe("matched");
    expect(bundle.retrieval).toBe("lexical");
  });
});
