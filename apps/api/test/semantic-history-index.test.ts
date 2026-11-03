import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, unlinkSync, rmdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ContextMemoryEncoder, MemoryTarget } from "@cosmora/contracts";
import { ContextMemoryStore, openDatabase, runMigrations, vectorBytes } from "@cosmora/db";
import { SemanticHistoryIndex } from "../src/semantic-memory/index-service.js";
import { SemanticMemoryPrivacy } from "../src/semantic-memory-privacy.js";

describe("durable semantic history index", () => {
  let db: ReturnType<typeof openDatabase>, index: SemanticHistoryIndex, a: ContextMemoryStore;
  let now: number, calls: string[];
  const at = "2026-11-03T12:00:00.000Z",
    target: MemoryTarget = { kind: "chat", id: "current" };
  const unit = (n: number): number[] => Array.from({ length: 384 }, (_, i) => (i === n ? 1 : 0));
  // Controlled vectors test storage/authority, never claimed as learned semantics.
  const encoder = (
    hook?: (kind: string, texts: readonly string[]) => void
  ): ContextMemoryEncoder => ({
    encoder: "test-only-onehot",
    drain: () => Promise.resolve(),
    rank: () => Promise.reject(new Error("legacy rank must not run")),
    embed: async (kind, texts) => {
      await Promise.resolve();
      hook?.(kind, texts);
      calls.push(...texts);
      return {
        encoder: "test-only-onehot",
        vectors: texts.map((t) =>
          unit(t.includes("19700") || t.includes("spending ceiling") ? 1 : 2)
        )
      };
    }
  });
  const message = (id: string, text: string, chat = "history", owner = "a") =>
    db.sqlite
      .prepare(
        "INSERT INTO general_chat_messages(id,chat_id,owner_id,role,content_type,content,status,created_at,updated_at) VALUES(?,?,?,'user','text',?,'completed',?,?)"
      )
      .run(id, chat, owner, text, at, at);
  const enable = (ids = ["history"], t = target, owner = "a") =>
    a.updateSettings(
      t,
      {
        enabled: true,
        use_personal: false,
        source_chat_ids: ids,
        project_ids: [],
        expected_version: a.settings(t, owner).version
      },
      owner
    );
  const finish = async (t = target, owner = "a") => {
    for (let n = 0; n < 250; n++) {
      const p = index.store.progress(t, owner, index.format);
      if (p.state !== "building") return p;
      await index.buildOnce(t, owner);
    }
    throw new Error("Index failed to finish within finite fixture bound");
  };
  beforeEach(async () => {
    db = openDatabase(":memory:");
    await runMigrations(db);
    now = Date.parse(at);
    calls = [];
    a = new ContextMemoryStore(db.sqlite, () => now);
    for (const [id, owner] of [
      ["current", "a"],
      ["history", "a"],
      ["unselected", "a"],
      ["foreign", "b"],
      ["target-b", "b"]
    ])
      db.sqlite
        .prepare(
          "INSERT INTO general_chats(id,owner_id,title,created_at,updated_at) VALUES(?,?,?,?,?)"
        )
        .run(id!, owner!, id!, at, at);
    enable();
    index = new SemanticHistoryIndex(db.sqlite, encoder(), { now: () => now });
    a.indexedRecall = index;
  });
  afterEach(async () => {
    await index.stop();
    db.close();
  });
  it("finds a paraphrased source beyond the old 48-message window without recomputing all passages", async () => {
    message("a-old", "На технику 19700 рублей, без доставки.");
    db.sqlite
      .prepare(
        "UPDATE general_chat_messages SET created_at='2020-01-01T00:00:00.000Z' WHERE id='a-old'"
      )
      .run();
    for (let n = 0; n < 65; n++) message("z-" + n, "Независимая новая запись " + n);
    expect((await finish()).state).toBe("ready");
    calls = [];
    const result = await a.resolveAsync(target, "a", "spending ceiling");
    expect(result.items[0]).toMatchObject({
      reference: "H:g:a-old",
      text: "На технику 19700 рублей, без доставки."
    });
    expect(calls).toEqual(["spending ceiling"]);
    expect(result.semantic_retrieval?.index).toMatchObject({
      state: "ready",
      indexed_sources: 66,
      scan_limited: false
    });
    expect(result.semantic_retrieval?.limited).toBe(false);
    expect(result.bytes).toBe(Buffer.byteLength(JSON.stringify(result)));
  });
  it("invalidates physical vectors on edit/deletion and rejects a stale in-flight result", async () => {
    message("old", "19700 рублей.");
    await finish();
    expect(index.store.cached("a", "H:g:old", index.format)?.complete).toBe(1);
    db.sqlite
      .prepare("UPDATE general_chat_messages SET content='Новая версия' WHERE id='old'")
      .run();
    expect(index.store.cached("a", "H:g:old", index.format)).toBeUndefined();
    await index.stop();
    index = new SemanticHistoryIndex(
      db.sqlite,
      encoder((kind) => {
        if (kind === "passage")
          db.sqlite.prepare("DELETE FROM general_chat_messages WHERE id='old'").run();
      }),
      { now: () => now }
    );
    a.indexedRecall = index;
    await index.buildOnce(target, "a");
    await index.buildOnce(target, "a");
    expect(
      (db.sqlite.prepare("SELECT count(*) n FROM semantic_index_chunks").get() as { n: number }).n
    ).toBe(0);
  });
  it("keeps unselected and foreign sources outside inference and honors revoke during query", async () => {
    message("ok", "19700 рублей.");
    message("private", "FOREIGN", "foreign", "b");
    message("unselected", "UNSELECTED", "unselected");
    await finish();
    expect(calls.join("\n")).not.toMatch(/FOREIGN|UNSELECTED/);
    await index.stop();
    index = new SemanticHistoryIndex(
      db.sqlite,
      encoder((kind) => {
        if (kind === "query") enable([]);
      }),
      { now: () => now }
    );
    a.indexedRecall = index;
    const result = await a.resolveAsync(target, "a", "spending ceiling");
    expect(result.items).toHaveLength(0);
    expect(
      (
        db.sqlite
          .prepare("SELECT count(*) n FROM semantic_index_chunks WHERE owner_id='a'")
          .get() as { n: number }
      ).n
    ).toBe(0);
  });
  it("resumes chunk offsets across an actual SQLite close/reopen", async () => {
    const content = "Разрешённый большой источник 19700. ".repeat(500);
    message("long", content);
    await index.buildOnce(target, "a");
    await index.buildOnce(target, "a");
    const before = index.store.cached("a", "H:g:long", index.format)!;
    expect(before.next_offset).toBeGreaterThan(0);
    expect(before.complete).toBe(0);
    const directory = mkdtempSync(join(tmpdir(), "kosmora-index-")),
      file = join(directory, "state.sqlite");
    db.sqlite.prepare("VACUUM INTO ?").run(file);
    await index.stop();
    db.close();
    db = openDatabase(file);
    await runMigrations(db);
    a = new ContextMemoryStore(db.sqlite, () => now);
    index = new SemanticHistoryIndex(db.sqlite, encoder(), { now: () => now });
    a.indexedRecall = index;
    calls = [];
    try {
      await index.buildOnce(target, "a");
      expect(calls[0]).toBe(content.slice(before.next_offset, before.next_offset + 600));
      expect((await finish()).state).toBe("ready");
    } finally {
      await index.stop();
      db.close();
      unlinkSync(file);
      rmdirSync(directory);
      db = openDatabase(":memory:");
    }
  });
  it("exposes capacity without falsely claiming full coverage and resumes after capacity increases", async () => {
    message("a", "19700 " + "текст ".repeat(300));
    await index.stop();
    index = new SemanticHistoryIndex(db.sqlite, encoder(), { maxOwnerChunks: 1, now: () => now });
    a.indexedRecall = index;
    expect((await finish()).state).toBe("capacity");
    expect(
      (await a.resolveAsync(target, "a", "spending ceiling")).semantic_retrieval?.limited
    ).toBe(true);
    await index.stop();
    index = new SemanticHistoryIndex(db.sqlite, encoder(), { maxOwnerChunks: 100, now: () => now });
    a.indexedRecall = index;
    await index.buildOnce(target, "a");
    expect((await finish()).state).toBe("ready");
  });
  it("shrinks token-overflow chunks without gaps in source coverage", async () => {
    message("long", "你".repeat(1400));
    const fake = encoder();
    fake.embed = (kind, texts) =>
      Promise.resolve({
        encoder: fake.encoder,
        vectors: texts.map((t) => (kind === "passage" && t.length > 300 ? null : unit(1)))
      });
    await index.stop();
    index = new SemanticHistoryIndex(db.sqlite, fake, { now: () => now });
    expect((await finish()).state).toBe("ready");
    const chunks = db.sqlite
      .prepare("SELECT start_utf16,end_utf16 FROM semantic_index_chunks ORDER BY start_utf16")
      .all() as { start_utf16: number; end_utf16: number }[];
    let covered = 0;
    for (const c of chunks) {
      expect(c.start_utf16).toBeLessThanOrEqual(covered);
      covered = Math.max(covered, c.end_utf16);
    }
    expect(covered).toBe(1400);
  });
  it("purges expired notes and privacy snapshots while retaining another owner's vectors", async () => {
    a.create(
      {
        scope: "chat",
        scope_id: "history",
        kind: "fact",
        title: "Истекает",
        content: "19700",
        pinned: false,
        expires_at: "2026-11-03T12:01:00.000Z",
        source: null
      },
      "a"
    );
    message("b", "19700", "foreign", "b");
    enable(["foreign"], { kind: "chat", id: "target-b" }, "b");
    await finish();
    await finish({ kind: "chat", id: "target-b" }, "b");
    now += 60001;
    index.store.sweep(index.format);
    expect(
      (
        db.sqlite
          .prepare(
            "SELECT count(*) n FROM semantic_index_sources WHERE memory_entry_id IS NOT NULL"
          )
          .get() as { n: number }
      ).n
    ).toBe(0);
    db.sqlite
      .prepare(
        "INSERT INTO kosmora_owner_data_lifecycle(owner_id,epoch,state,operation_id,started_at,updated_at) VALUES('a',1,'quiescing','test',?,?)"
      )
      .run(at, at);
    const privacy = new SemanticMemoryPrivacy(db.sqlite, index);
    await privacy.quiesce("a", 1);
    expect(await privacy.export("a")).toMatchObject({ complete: true, records: {} });
    expect(
      (
        db.sqlite
          .prepare("SELECT count(*) n FROM semantic_index_chunks WHERE owner_id='b'")
          .get() as { n: number }
      ).n
    ).toBeGreaterThan(0);
    await expect(index.buildOnce(target, "a")).rejects.toThrow("OWNER_DATA_FENCED");
  });
  it("validates normalized finite vector blobs", () => {
    expect(() => vectorBytes(Array(384).fill(0) as number[])).toThrow("SEMANTIC_VECTOR_INVALID");
    const v = unit(1);
    v[5] = NaN;
    expect(() => vectorBytes(v)).toThrow("SEMANTIC_VECTOR_INVALID");
  });
  it("stops retrying an inference failure after three attempts until source changes", async () => {
    message("broken", "19700 рублей.");
    await index.stop();
    let attempts = 0;
    const broken = encoder();
    broken.embed = () => {
      attempts++;
      return Promise.reject(new Error("SEMANTIC_INFERENCE_FAILED"));
    };
    index = new SemanticHistoryIndex(db.sqlite, broken, { now: () => now });
    expect((await finish()).state).toBe("blocked");
    expect(attempts).toBe(3);
    await index.buildOnce(target, "a");
    expect(attempts).toBe(3);
    db.sqlite
      .prepare("UPDATE general_chat_messages SET content='Исправлен 19700' WHERE id='broken'")
      .run();
    expect(index.store.progress(target, "a", index.format).state).toBe("building");
  });
  it("indexes project history with the same current grants and provenance", async () => {
    for (const [id, owner] of [
      ["p1", "a"],
      ["p2", "b"]
    ]) {
      db.sqlite
        .prepare(
          "INSERT INTO projects(id,owner_id,title,status,created_at,updated_at) VALUES(?,?,?,'ACTIVE',?,?)"
        )
        .run(id!, owner!, id!, at, at);
      db.sqlite
        .prepare("INSERT INTO chats(id,project_id,kind,created_at) VALUES(?,?,'main',?)")
        .run("c-" + id, id!, at);
      db.sqlite
        .prepare(
          "INSERT INTO messages(id,project_id,chat_id,role,content_type,content,status,created_at,updated_at) VALUES(?,?,?,'user','text',?,'completed',?,?)"
        )
        .run("m-" + id, id!, "c-" + id, owner === "a" ? "19700 рублей." : "FOREIGN", at, at);
    }
    const project: MemoryTarget = { kind: "project", id: "p1" };
    enable([], project);
    calls = [];
    expect((await finish(project)).state).toBe("ready");
    expect(calls.join("\n")).not.toContain("FOREIGN");
    const result = await a.resolveAsync(project, "a", "spending ceiling");
    expect(result.items[0]).toMatchObject({
      reference: "H:p:m-p1",
      source: { project_id: "p1", role: "user" }
    });
  });
  it("keeps a completed target current when another unselected chat receives a message", async () => {
    message("allowed", "19700 рублей.");
    await finish();
    const before = index.store.progress(target, "a", index.format);
    message("unrelated", "Не относится к разрешённым источникам.", "unselected");
    expect(index.store.progress(target, "a", index.format)).toEqual(before);
  });
  it("reuses source vectors across targets and indexes an insertion before the saved cursor", async () => {
    message("z-first", "19700 рублей.");
    await finish();
    calls = [];
    const second: MemoryTarget = { kind: "chat", id: "unselected" };
    enable(["history"], second);
    await finish(second);
    expect(calls).toHaveLength(0);
    expect(index.store.summary(second, "a", index.format).indexed_chunks).toBe(1);
    message("a-inserted", "19700 новый источник.");
    await finish();
    expect(calls).toEqual(["19700 новый источник."]);
    expect(index.store.summary(target, "a", index.format).indexed_sources).toBe(2);
  });
  it("reports an incomplete scan under its time budget rather than claiming full recall", async () => {
    message("long", "19700 " + "Текст источника. ".repeat(16000));
    await finish();
    await index.stop();
    index = new SemanticHistoryIndex(db.sqlite, encoder(), { queryMs: 0, now: () => now });
    a.indexedRecall = index;
    const result = await a.resolveAsync(target, "a", "spending ceiling");
    expect(result.semantic_retrieval?.index).toMatchObject({ state: "ready", scan_limited: true });
    expect(result.semantic_retrieval?.limited).toBe(true);
  });
  it("drains an in-flight indexing write at the privacy fence", async () => {
    message("pending", "19700 рублей.");
    await index.stop();
    let started!: () => void;
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    const delayed = encoder();
    delayed.embed = (_kind, _texts, signal) =>
      new Promise((_resolve, reject) => {
        started();
        signal?.addEventListener("abort", () => reject(new Error("cancelled")), { once: true });
      });
    index = new SemanticHistoryIndex(db.sqlite, delayed, { now: () => now });
    await index.buildOnce(target, "a");
    const pending = index.buildOnce(target, "a").then(
      () => false,
      () => true
    );
    await entered;
    db.sqlite
      .prepare(
        "INSERT INTO kosmora_owner_data_lifecycle(owner_id,epoch,state,operation_id,started_at,updated_at) VALUES('a',1,'quiescing','test',?,?)"
      )
      .run(at, at);
    const privacy = new SemanticMemoryPrivacy(db.sqlite, index);
    await privacy.quiesce("a", 1);
    expect(await pending).toBe(true);
    expect(await privacy.export("a")).toMatchObject({ complete: true });
    expect(
      (db.sqlite.prepare("SELECT count(*) n FROM semantic_index_chunks").get() as { n: number }).n
    ).toBe(0);
  });
});
