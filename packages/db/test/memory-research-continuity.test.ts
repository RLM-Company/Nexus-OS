import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ContextMemoryInput, MemoryTarget } from "@cosmora/contracts";
import { ContextMemoryStore, openDatabase, runMigrations } from "../src/index.js";

/** Long continuity scenario: one research fact is saved with a source receipt,
 * materials are updated, then the next task after a real SQLite reopen recalls
 * the current version — never the old summary. */
describe("memory continuity across material update and restart", () => {
  const at = "2026-11-25T10:00:00.000Z";
  const later = "2026-11-25T12:00:00.000Z";
  const target: MemoryTarget = { kind: "chat", id: "long-task" };
  const receiptV1 =
    "kosmora.source-receipt.v1|S2:E1|2026-11-25T10:00:00Z|sha256:aaaa|quote:12 октября";
  const receiptV2 =
    "kosmora.source-receipt.v1|S3:E1|2026-11-25T12:00:00Z|sha256:bbbb|quote:20 октября";
  const fact = (content: string): ContextMemoryInput => ({
    scope: "personal",
    scope_id: null,
    kind: "fact",
    title: `Срок поставки (${content})`,
    content: `${content} · ${content.includes("20 октября") ? receiptV2 : receiptV1}`,
    pinned: true,
    expires_at: null,
    source: null
  });
  const setup = (db: ReturnType<typeof openDatabase>, clock: () => number) => {
    db.sqlite
      .prepare(
        "INSERT OR IGNORE INTO general_chats(id,owner_id,title,created_at,updated_at) VALUES(?,?,?,?,?)"
      )
      .run(target.id, "a", "long task", at, at);
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

  it("uses the updated material in the next task after reopen, without resurrecting the old fact", async () => {
    const folder = mkdtempSync(join(tmpdir(), "kosmora-memory-continuity-"));
    const path = join(folder, "state.db");
    let db = openDatabase(path);
    await runMigrations(db);
    let store = setup(db, () => Date.parse(at));

    const first = store.create(fact("Срок поставки 12 октября 2027"), "a");
    expect(store.resolve(target, "a", "срок поставки").items[0]!.text).toContain("12 октября");
    const updated = store.update(
      first.id,
      first.version,
      fact("Срок поставки 20 октября 2027"),
      "a"
    );
    expect(updated.version).toBe(2);
    db.close();

    // Real restart from disk: new store instance, new clock, same database file.
    db = openDatabase(path);
    await runMigrations(db);
    store = setup(db, () => Date.parse(later));
    try {
      const nextTask = store.resolve(target, "a", "срок поставки");
      expect(nextTask.answer_evidence).toBe("matched");
      expect(nextTask.items.some((entry) => entry.text.includes("20 октября"))).toBe(true);
      expect(nextTask.items.some((entry) => entry.text.includes("12 октября"))).toBe(false);
      const current = store.get(first.id, "a")!;
      expect(current.version).toBe(2);
      expect(current.content).toContain(receiptV2);
      expect(current.content).not.toContain(receiptV1);
      expect(store.versions(first.id, "a")).toHaveLength(2);
      // A stale summary cannot become active memory again.
      expect(store.localSnapshot("a").entries[0]!.content).toContain("20 октября");
    } finally {
      db.close();
      rmSync(folder, { recursive: true, force: true });
    }
  });
});
