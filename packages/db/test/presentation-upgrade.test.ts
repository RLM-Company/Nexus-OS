import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { openDatabase, PresentationStore, runMigrations } from "../src/index.js";

describe("presentation history migration", () => {
  it("keeps checkpoints and restore provenance after closing and reopening SQLite", async () => {
    const folder = mkdtempSync(join(tmpdir(), "presentation-restart-"));
    const path = `file:${join(folder, "decks.db")}`;
    let db = openDatabase(path);
    try {
      await runMigrations(db);
      let store = new PresentationStore(db.sqlite);
      const first = store.create("owner", "Durable");
      store.save("owner", first.id, 1, {
        ...first,
        title: "After save",
        slides: [{ ...first.slides[0]!, notes: "Keep through restart" }]
      });
      db.close();
      db = openDatabase(path);
      await runMigrations(db);
      store = new PresentationStore(db.sqlite);
      expect(store.get("owner", first.id).slides[0]?.notes).toBe("Keep through restart");
      expect(store.versions("owner", first.id).map((v) => v.version)).toEqual([2, 1]);
      store.restore("owner", first.id, 2, 1);
      db.close();
      db = openDatabase(path);
      await runMigrations(db);
      store = new PresentationStore(db.sqlite);
      expect(store.get("owner", first.id)).toMatchObject({ title: "Durable", version: 3 });
      expect(store.revision("owner", first.id, 3)).toMatchObject({
        source: "restore",
        source_version: 1
      });
    } finally {
      db.close();
      rmSync(folder, { recursive: true, force: true });
    }
  });
  it("backfills the actual current version and preserves slides on an existing database", async () => {
    const folder = mkdtempSync(join(tmpdir(), "presentation-upgrade-"));
    const migrations = fileURLToPath(new URL("../migrations", import.meta.url));
    const db = openDatabase(":memory:");
    try {
      cpSync(migrations, folder, { recursive: true });
      const journalPath = join(folder, "meta/_journal.json");
      const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
        entries: { idx: number }[];
      };
      journal.entries = journal.entries.filter((entry) => entry.idx < 45);
      writeFileSync(journalPath, JSON.stringify(journal));
      await runMigrations(db, folder);
      const slides = [
        {
          id: "legacy",
          layout: "content",
          title: "Старый слайд",
          body: "Текст",
          aside: "",
          notes: "Старые заметки"
        }
      ];
      db.sqlite
        .prepare(
          "INSERT INTO presentations(id,owner_id,title,theme,slides_json,version,created_at,updated_at) VALUES('legacy-deck','owner','Старый доклад','paper',?,7,'before','after')"
        )
        .run(JSON.stringify(slides));
      await runMigrations(db);
      const store = new PresentationStore(db.sqlite);
      expect(store.get("owner", "legacy-deck")).toMatchObject({ version: 7, slides });
      expect(store.versions("owner", "legacy-deck")).toEqual([
        expect.objectContaining({ version: 7, source: "migration", created_at: "after" })
      ]);
      expect(
        store.save("owner", "legacy-deck", 7, { title: "Новая правка", theme: "night", slides })
          .version
      ).toBe(8);
      expect(store.revision("owner", "legacy-deck", 7).slides).toEqual(slides);
      expect(db.sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      db.close();
      rmSync(folder, { recursive: true, force: true });
    }
  });
});
