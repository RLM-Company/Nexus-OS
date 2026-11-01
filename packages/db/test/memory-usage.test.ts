import { beforeEach, afterEach, it, expect, describe } from "vitest";
import { openDatabase, runMigrations, ContextMemoryStore } from "../src/index.js";
import type { MemoryUsageSnapshot, MemoryTarget } from "@cosmora/contracts";

describe("bounded owner-scoped memory usage journal", () => {
  let db: ReturnType<typeof openDatabase>, store: ContextMemoryStore;
  const target: MemoryTarget = { kind: "chat", id: "a-chat" },
    at = "2026-10-31T00:00:00.000Z";
  const snapshot = (): MemoryUsageSnapshot => ({
    representation: "exact",
    bundle_sha256: "b".repeat(64),
    bundle_bytes: 1000,
    sources_omitted: 0,
    sources: [
      {
        reference: "H:g:source",
        kind: "history",
        version: null,
        text_sha256: "c".repeat(64),
        source_kind: "chat_message",
        source_message_id: "source",
        source_sha256: "d".repeat(64),
        excerpt_only: true
      }
    ]
  });
  const input = (attempt = 1) => ({
    run_id: "run",
    request_id: "req",
    attempt,
    channel: "chat" as const,
    phase: "dispatch_boundary" as const,
    snapshot: snapshot()
  });
  beforeEach(async () => {
    db = openDatabase(":memory:");
    await runMigrations(db);
    store = new ContextMemoryStore(db.sqlite, () => Date.parse(at));
    for (const owner of ["a", "b"])
      db.sqlite
        .prepare(
          "INSERT INTO general_chats(id,owner_id,title,created_at,updated_at) VALUES(?,?,?, ?,?)"
        )
        .run(owner + "-chat", owner, "Chat", at, at);
    db.sqlite
      .prepare(
        "INSERT INTO general_chat_runs(id,chat_id,status,created_at,updated_at) VALUES('run','a-chat','running',?,?)"
      )
      .run(at, at);
    db.sqlite
      .prepare(
        "INSERT INTO general_chat_messages(id,chat_id,owner_id,role,content_type,content,status,created_at,updated_at) VALUES('source','a-chat','a','user','text','Secret original budget 17350','completed',?,?)"
      )
      .run(at, at);
  });
  afterEach(() => db.close());
  it("requires a real owned run, immutable snapshots and a dispatch before completion", () => {
    expect(() => store.recordUsage(target, "b", input())).toThrow("MEMORY_TARGET_NOT_FOUND");
    expect(() => store.recordUsage({ kind: "chat", id: "b-chat" }, "b", input())).toThrow(
      "MEMORY_USAGE_RUN_NOT_FOUND"
    );
    expect(() =>
      store.recordUsage(target, "a", { ...input(), phase: "provider_completed" })
    ).toThrow("MEMORY_USAGE_DISPATCH_MISSING");
    store.recordUsage(target, "a", input());
    store.recordUsage(target, "a", input());
    store.recordUsage(target, "a", { ...input(), phase: "provider_completed" });
    store.recordUsage(target, "a", input());
    expect(store.usage(target, "a").items).toHaveLength(1);
    expect(store.usage(target, "a").items[0]!.phase).toBe("provider_completed");
    expect(() =>
      store.recordUsage(target, "a", { ...input(), snapshot: { ...snapshot(), bundle_bytes: 99 } })
    ).toThrow("MEMORY_USAGE_CONFLICT");
    expect(JSON.stringify(store.usage(target, "a"))).not.toContain("17350");
  });
  it("keeps the most recent 500 receipts, with deterministic pagination", () => {
    for (let attempt = 1; attempt <= 505; attempt++) store.recordUsage(target, "a", input(attempt));
    const page = store.usage(target, "a");
    expect(page.items.map((i) => i.attempt)).toEqual(Array.from({ length: 20 }, (_, i) => 505 - i));
    expect(page.next_offset).toBe(20);
    expect(store.usage(target, "a", 480).items.at(-1)!.attempt).toBe(6);
    expect(store.usage(target, "a", 500).items).toEqual([]);
  });
  it("deletes exact and transformed receipts with their original source", () => {
    store.recordUsage(target, "a", input());
    store.recordUsage(target, "a", {
      ...input(2),
      snapshot: { ...snapshot(), representation: "unverified" }
    });
    db.sqlite.prepare("DELETE FROM general_chat_messages WHERE id='source'").run();
    expect(store.usage(target, "a").items).toEqual([]);
  });
  it("forgets derived receipts when a manual memory is deleted; cascade clears a deleted run", () => {
    db.sqlite.prepare("UPDATE general_chat_runs SET status='cancelled'").run();
    const saved = store.create(
      {
        scope: "personal",
        scope_id: null,
        kind: "fact",
        title: "Budget",
        content: "17350",
        pinned: false,
        expires_at: null,
        source: null
      },
      "a"
    );
    store.recordUsage(target, "a", {
      ...input(),
      snapshot: {
        ...snapshot(),
        sources: [
          {
            ...snapshot().sources[0]!,
            reference: "M:" + saved.id,
            source_kind: null,
            source_message_id: null,
            source_sha256: null
          }
        ]
      }
    });
    store.forget(saved.id, 1, "a");
    expect(store.usage(target, "a").items).toEqual([]);
    store.recordUsage(target, "a", input());
    db.sqlite.prepare("DELETE FROM general_chat_runs WHERE id='run'").run();
    expect(store.usage(target, "a").items).toEqual([]);
    expect(db.sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });
  it("blocks reads/writes during privacy fencing and clearing during active execution", () => {
    store.recordUsage(target, "a", input());
    expect(() => store.clearUsage(target, "a")).toThrow("MEMORY_RUN_ACTIVE");
    db.sqlite.prepare("UPDATE general_chat_runs SET status='cancelled'").run();
    expect(store.clearUsage(target, "a")).toEqual({ cleared: true });
    store.recordUsage(target, "a", input());
    db.sqlite
      .prepare(
        "INSERT INTO kosmora_owner_data_lifecycle(owner_id,epoch,state,operation_id,started_at,updated_at) VALUES('a',1,'deleting','delete',?,?)"
      )
      .run(at, at);
    expect(() => store.usage(target, "a")).toThrow("OWNER_DATA_FENCED");
    expect(() => store.recordUsage(target, "a", input(2))).toThrow("OWNER_DATA_FENCED");
    expect(() => store.clearUsage(target, "a")).toThrow("OWNER_DATA_FENCED");
  });
  it("rejects accidental source text or arbitrary extra fields in receipt metadata", () => {
    expect(() =>
      store.recordUsage(target, "a", {
        ...input(),
        snapshot: { ...snapshot(), text: "raw source" } as MemoryUsageSnapshot
      })
    ).toThrow("INVALID_MEMORY_USAGE");
  });
});
