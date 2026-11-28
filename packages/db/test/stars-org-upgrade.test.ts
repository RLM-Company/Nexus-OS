import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { StarsOrgStoreConflict, openDatabase, runMigrations, StarsOrgStore } from "../src/index.js";

describe("Stars org upgrade from main after 0077", () => {
  it("preserves missions, applies 0078, survives restart and rejects a stale write atomically", async () => {
    const folder = mkdtempSync(join(tmpdir(), "stars-org-upgrade-"));
    const path = `file:${join(folder, "state.db")}`;
    let db = openDatabase(path);
    try {
      const migrationFolder = join(folder, "migrations");
      cpSync(fileURLToPath(new URL("../migrations", import.meta.url)), migrationFolder, {
        recursive: true
      });
      const journalPath = join(migrationFolder, "meta/_journal.json");
      const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
        entries: { idx: number }[];
      };
      journal.entries = journal.entries.filter((entry) => entry.idx < 78);
      writeFileSync(journalPath, JSON.stringify(journal));
      await runMigrations(db, migrationFolder);
      db.sqlite
        .prepare(
          "INSERT INTO stars_missions(mission_id,owner_id,team_scope,version,state_json,created_at,updated_at) VALUES('legacy','a','team',1,'{}','before','before')"
        )
        .run();
      db.close();

      db = openDatabase(path);
      await runMigrations(db);
      expect(
        db.sqlite.prepare("SELECT version FROM stars_missions WHERE mission_id='legacy'").get()
      ).toEqual({ version: 1 });
      const store = new StarsOrgStore(db.sqlite);
      const snapshot = {
        team_scope: "team",
        version: 1,
        nodes: [
          {
            id: "chief",
            role: "chief",
            manager_id: null,
            responsibility_zones: ["*"],
            project_ids: ["p1"],
            status: "active" as const,
            effective_from: "2026-11-27T10:00:00.000Z"
          }
        ],
        checksum: "checksum-1"
      };
      expect(store.save(snapshot, "a", 0)).toEqual(snapshot);
      expect(() => store.save({ ...snapshot, version: 2 }, "a", 0)).toThrow(StarsOrgStoreConflict);
      expect(store.current("team", "a")?.version).toBe(1);
      db.close();

      db = openDatabase(path);
      await runMigrations(db);
      const reopened = new StarsOrgStore(db.sqlite);
      expect(reopened.current("team", "a")).toEqual(snapshot);
      expect(reopened.version("team", "a", 1)).toEqual(snapshot);
      expect(
        db.sqlite.prepare("SELECT version FROM stars_missions WHERE mission_id='legacy'").get()
      ).toEqual({ version: 1 });
    } finally {
      db.close();
      rmSync(folder, { recursive: true, force: true });
    }
  }, 60_000);
});
