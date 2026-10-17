import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { openDatabase, PresentationStore, runMigrations } from "../src/index.js";

it("upgrades 0047 without rewriting decks and retains import identity/provenance after restart", async () => {
  const dir = mkdtempSync(join(tmpdir(), "presentation-work-upgrade-"));
  const path = `file:${join(dir, "state.db")}`;
  let db = openDatabase(path);
  try {
    const migrations = join(dir, "migrations");
    cpSync(fileURLToPath(new URL("../migrations", import.meta.url)), migrations, {
      recursive: true
    });
    const journalPath = join(migrations, "meta/_journal.json");
    const journal = JSON.parse(readFileSync(journalPath, "utf8")) as { entries: { idx: number }[] };
    journal.entries = journal.entries.filter((entry) => entry.idx < 48);
    writeFileSync(journalPath, JSON.stringify(journal));
    await runMigrations(db, migrations);
    const slides = [
      {
        id: "s1",
        layout: "title" as const,
        title: "Старое",
        body: "",
        aside: "",
        notes: "Сохранить"
      }
    ];
    db.sqlite
      .prepare(
        "INSERT INTO presentations VALUES('legacy','owner','Old','paper',?,4,'before','after')"
      )
      .run(JSON.stringify(slides));
    const before = db.sqlite.prepare("SELECT * FROM presentations").all();
    await runMigrations(db);
    expect(db.sqlite.prepare("SELECT * FROM presentations").all()).toEqual(before);
    let store = new PresentationStore(db.sqlite);
    expect(store.get("owner", "legacy").work_source).toBeNull();
    const source = {
      project_id: "project",
      work_id: "work",
      artifact_id: "artifact",
      version: 1,
      sha256: "a".repeat(64),
      name: "presentation.json",
      created_at: "source-time",
      model_sources: [],
      critic: { verdict: "PASS" as const, reason: "checked" }
    };
    const imported = store.importWork(
      "owner",
      { title: "Imported", theme: "paper", slides },
      source
    );
    db.close();
    db = openDatabase(path);
    await runMigrations(db);
    store = new PresentationStore(db.sqlite);
    expect(
      store.importWork("owner", { title: "Imported", theme: "paper", slides }, source).id
    ).toBe(imported.id);
    expect(store.get("owner", imported.id).work_source).toEqual(source);
    store.delete("owner", imported.id, 1);
    db.close();
    db = openDatabase(path);
    await runMigrations(db);
    store = new PresentationStore(db.sqlite);
    expect(() =>
      store.importWork("owner", { title: "Imported", theme: "paper", slides }, source)
    ).toThrow("IMPORT_DELETED");
    expect(db.sqlite.prepare("PRAGMA integrity_check").get()!.integrity_check).toBe("ok");
    expect(db.sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
