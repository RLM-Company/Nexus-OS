import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ContextMemoryInput, MemoryTarget } from "@cosmora/contracts";
import { ContextMemoryStore, openDatabase, runMigrations } from "../src/index.js";

/** Restart / expiry / forgotten-entry durability for the memory loop. */
describe("memory restart and expiry durability", () => {
  const at = "2026-11-11T10:00:00.000Z";
  const later = "2026-11-11T12:00:00.000Z";
  const target: MemoryTarget = { kind: "chat", id: "work" };
  const input = (extra: Partial<ContextMemoryInput> = {}): ContextMemoryInput => ({
    scope: "personal",
    scope_id: null,
    kind: "decision",
    title: "Бюджет",
    content: "Бюджет 19 700 ₽, кроме доставки.",
    pinned: false,
    expires_at: null,
    source: null,
    ...extra
  });
  const setup = (db: ReturnType<typeof openDatabase>, clock: () => number) => {
    db.sqlite
      .prepare(
        "INSERT OR IGNORE INTO general_chats(id,owner_id,title,created_at,updated_at) VALUES('work','a','work',?,?)"
      )
      .run(at, at);
    const store = new ContextMemoryStore(db.sqlite, clock);
    const current = store.settings(target, "a");
    if (!current.enabled)
      store.updateSettings(
        target,
        {
          enabled: true,
          use_personal: true,
          source_chat_ids: [],
          project_ids: [],
          expected_version: current.version
        },
        "a"
      );
    return store;
  };

  it("an expired entry is honestly labelled in list/get/snapshot, never recalled", async () => {
    const db = openDatabase(":memory:");
    await runMigrations(db);
    const clock = { now: () => Date.parse(at) };
    const store = setup(db, () => clock.now());
    const expiring = store.create(input({ expires_at: "2026-11-11T11:00:00.000Z" }), "a");
    expect(store.get(expiring.id, "a")!.expired).toBe(false);
    expect(store.list("a").items[0]!.expired).toBe(false);
    clock.now = () => Date.parse(later);
    expect(store.get(expiring.id, "a")!.expired).toBe(true);
    expect(store.list("a").items[0]!.expired).toBe(true);
    expect(store.localSnapshot("a").entries[0]!.expired).toBe(true);
    expect(store.resolve(target, "a", "бюджет").answer_evidence).toBe("absent");
    expect(store.resolve(target, "a", "бюджет").items).toEqual([]);
    db.close();
  });

  it("an expired entry does not return after a real database restart", async () => {
    const folder = mkdtempSync(join(tmpdir(), "kosmora-memory-restart-"));
    const file = join(folder, "state.db");
    let clock = () => Date.parse(at);
    let db = openDatabase(`file:${file}`);
    await runMigrations(db);
    const store = setup(db, () => clock());
    const expiring = store.create(input({ expires_at: "2026-11-11T11:00:00.000Z" }), "a");
    expect(
      store.resolve(target, "a", "бюджет").items.some((e) => e.reference === "M:" + expiring.id)
    ).toBe(true);
    clock = () => Date.parse(later);
    expect(store.resolve(target, "a", "бюджет").answer_evidence).toBe("absent");
    db.close();

    db = openDatabase(`file:${file}`);
    await runMigrations(db);
    const restarted = setup(db, () => clock());
    const after = restarted.resolve(target, "a", "бюджет");
    expect(after.items.some((e) => e.reference === "M:" + expiring.id)).toBe(false);
    expect(after.answer_evidence).toBe("absent");
    db.close();
    rmSync(folder, { recursive: true, force: true });
  });

  it("a forgotten entry never returns from the index after restart", async () => {
    const folder = mkdtempSync(join(tmpdir(), "kosmora-memory-forget-"));
    const file = join(folder, "state.db");
    let db = openDatabase(`file:${file}`);
    await runMigrations(db);
    const store = setup(db, () => Date.parse(at));
    const entry = store.create(input(), "a");
    // Simulate a derived vector row that the background index would have stored.
    db.sqlite
      .prepare(
        "INSERT INTO semantic_index_sources(id,owner_id,reference,encoder,fingerprint,memory_entry_id,complete) VALUES('s1','a',?,'fixture',?,?,1)"
      )
      .run("M:" + entry.id, "0".repeat(64), entry.id);
    expect(db.sqlite.prepare("SELECT count(*) n FROM semantic_index_sources").get()).toEqual({
      n: 1
    });
    store.forget(entry.id, entry.version, "a");
    expect(db.sqlite.prepare("SELECT count(*) n FROM semantic_index_sources").get()).toEqual({
      n: 0
    });
    db.close();

    db = openDatabase(`file:${file}`);
    await runMigrations(db);
    const restarted = setup(db, () => Date.parse(at));
    const after = restarted.resolve(target, "a", "бюджет");
    expect(after.answer_evidence).toBe("absent");
    expect(db.sqlite.prepare("SELECT count(*) n FROM semantic_index_sources").get()).toEqual({
      n: 0
    });
    db.close();
    rmSync(folder, { recursive: true, force: true });
  });
});
