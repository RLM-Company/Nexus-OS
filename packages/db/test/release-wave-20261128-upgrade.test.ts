import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { openDatabase, ProjectStore, runMigrations } from "../src/index.js";

const migrations = fileURLToPath(new URL("../migrations", import.meta.url));
const journal = JSON.parse(readFileSync(join(migrations, "meta/_journal.json"), "utf8")) as {
  entries: { idx: number; tag: string; when: number }[];
};
const tables = [
  "project_material_activity",
  "stars_org_snapshots",
  "document_answer_batches",
  "developer_api_keys",
  "automation_triggers",
  "automation_event_inbox"
];

it.each([null, 77, 78, 79, 80, 81, 82])(
  "upgrades release wave from migration %s without losing existing data",
  async (last) => {
    const folder = mkdtempSync(join(tmpdir(), "kosmora-release-wave-"));
    const db = openDatabase(join(folder, "state.db"));
    try {
      let before: unknown;
      if (last !== null) {
        const previous = join(folder, "migrations");
        cpSync(migrations, previous, { recursive: true });
        writeFileSync(
          join(previous, "meta/_journal.json"),
          JSON.stringify({
            ...journal,
            entries: journal.entries.filter((entry) => entry.idx <= last)
          })
        );
        await runMigrations(db, previous);
        new ProjectStore(db.sqlite).createEmptyProject(
          "retained-project",
          "Проект 00123",
          "release-owner",
          "ACTIVE"
        );
        before = db.sqlite.prepare("SELECT * FROM projects WHERE id='retained-project'").get();
      }
      await runMigrations(db);
      for (const name of tables)
        expect(
          db.sqlite
            .prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name=?")
            .get(name),
          name
        ).toBeTruthy();
      const ledger = db.sqlite.prepare("SELECT * FROM __drizzle_migrations ORDER BY id").all();
      expect(ledger).toHaveLength(journal.entries.length);
      await runMigrations(db);
      expect(db.sqlite.prepare("SELECT * FROM __drizzle_migrations ORDER BY id").all()).toEqual(
        ledger
      );
      if (last !== null)
        expect(
          db.sqlite.prepare("SELECT * FROM projects WHERE id='retained-project'").get()
        ).toEqual(before);
      expect(db.sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      expect(db.sqlite.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
      const additions = journal.entries.filter((entry) => entry.idx >= 78);
      expect(additions.map((entry) => entry.idx)).toEqual([78, 79, 80, 81, 82, 83]);
      expect(new Set(additions.map((entry) => entry.tag)).size).toBe(6);
      for (let i = 1; i < journal.entries.length; i++)
        expect(journal.entries[i]!.when).toBeGreaterThan(journal.entries[i - 1]!.when);
    } finally {
      db.close();
      rmSync(folder, { recursive: true, force: true });
    }
  }
);
