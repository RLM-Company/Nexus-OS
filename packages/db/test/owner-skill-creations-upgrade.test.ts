import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { OwnerSkillStore, openDatabase, runMigrations } from "../src/index.js";
it("upgrades 0048 without rewriting Skills and resolves receipts after a database reopen", async () => {
  const folder = mkdtempSync(join(tmpdir(), "skill-creations-"));
  let db = openDatabase(join(folder, "state.db"));
  try {
    const migrations = join(folder, "migrations");
    cpSync(fileURLToPath(new URL("../migrations", import.meta.url)), migrations, {
      recursive: true
    });
    const journal = join(migrations, "meta/_journal.json");
    const value = JSON.parse(readFileSync(journal, "utf8")) as {
      entries: { idx: number; tag: string }[];
    };
    const completeCount = value.entries.length;
    const skillMigration = value.entries.find((v) => v.tag.endsWith("_owner_skill_creations"))!.idx;
    value.entries = value.entries.filter((v) => v.idx < skillMigration);
    const pendingCount = completeCount - value.entries.length;
    writeFileSync(journal, JSON.stringify(value));
    await runMigrations(db, migrations);
    const draft = { name: "Legacy", summary: "Summary", instructions: "Exact\r\n😀" };
    let store = new OwnerSkillStore(db.sqlite);
    const old = store.create("a", draft);
    const rows = db.sqlite.prepare("SELECT * FROM owner_skill_versions").all();
    const before = db.sqlite.prepare("SELECT COUNT(*) n FROM __drizzle_migrations").get() as {
      n: number;
    };
    await runMigrations(db);
    expect(db.sqlite.prepare("SELECT COUNT(*) n FROM __drizzle_migrations").get()).toMatchObject({
      n: before.n + pendingCount
    });
    expect(db.sqlite.prepare("SELECT * FROM owner_skill_versions").all()).toEqual(rows);
    const key = randomUUID(),
      first = store.create("a", draft, key);
    const deletedKey = randomUUID(),
      deleted = store.create("a", draft, deletedKey);
    store.delete("a", deleted.id, 1);
    db.close();
    db = openDatabase(join(folder, "state.db"));
    await runMigrations(db);
    store = new OwnerSkillStore(db.sqlite);
    expect(store.get("a", old.id).skill).toEqual(old);
    expect(store.creation("a", key)).toEqual(first);
    expect(store.create("a", draft, key)).toEqual(first);
    expect(() => store.create("a", draft, deletedKey)).toThrow("CREATION_DELETED");
    expect(db.sqlite.prepare("SELECT COUNT(*) n FROM __drizzle_migrations").get()).toMatchObject({
      n: before.n + pendingCount
    });
    expect(db.sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  } finally {
    db.close();
    rmSync(folder, { recursive: true, force: true });
  }
});
