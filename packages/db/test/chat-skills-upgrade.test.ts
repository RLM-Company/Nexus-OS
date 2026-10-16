import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { GeneralChatStore, OwnerSkillStore, openDatabase, runMigrations } from "../src/index.js";

describe("chat Skills additive upgrade and restart", () => {
  it("preserves the deployed 0044 database, applies both newer migrations and freezes text across reopen", async () => {
    const folder = mkdtempSync(join(tmpdir(), "skills-upgrade-"));
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
      journal.entries = journal.entries.filter((e) => e.idx < 45);
      writeFileSync(journalPath, JSON.stringify(journal));
      await runMigrations(db, migrationFolder);
      db.sqlite
        .prepare(
          "INSERT INTO general_chats(id,owner_id,title,created_at,updated_at) VALUES('legacy-chat','owner','Старый чат','before','before')"
        )
        .run();
      db.sqlite
        .prepare(
          "INSERT INTO general_chat_runs(id,chat_id,status,created_at,updated_at) VALUES('legacy-run','legacy-chat','succeeded','before','before')"
        )
        .run();
      const skill = new OwnerSkillStore(db.sqlite).create("owner", {
        name: "Research",
        summary: "Sources",
        instructions: "PERSISTED_V1"
      });
      const before = db.sqlite.prepare("SELECT * FROM general_chats").all();
      await runMigrations(db);
      expect(db.sqlite.prepare("SELECT * FROM general_chats").all()).toEqual(before);
      let store = new GeneralChatStore(db.sqlite);
      expect(store.skills.forRun("legacy-run", "owner")).toEqual({
        selection_version: 0,
        items: []
      });
      store.skills.update("legacy-chat", "owner", 0, [{ skill_id: skill.id, version: 1 }]);
      const accepted = store.createMessage("legacy-chat", "Question", "durable-request", "owner")!;
      const snapshot = store.skills.forRun(accepted.run.id, "owner");
      expect(() =>
        db.sqlite
          .prepare("UPDATE chat_run_skill_snapshots SET skills_json='[]' WHERE run_id=?")
          .run(accepted.run.id)
      ).toThrow("SKILL_SNAPSHOT_IMMUTABLE");
      const migrationCount = db.sqlite
        .prepare("SELECT count(*) AS n FROM __drizzle_migrations")
        .get();
      db.close();
      db = openDatabase(path);
      await runMigrations(db);
      store = new GeneralChatStore(db.sqlite);
      new OwnerSkillStore(db.sqlite).delete("owner", skill.id, 1);
      expect(store.skills.forRun(accepted.run.id, "owner")).toEqual(snapshot);
      expect(store.skills.get("legacy-chat", "owner")).toMatchObject({ version: 2, items: [] });
      expect(
        store.createMessage("legacy-chat", "Question", "durable-request", "owner")?.run.id
      ).toBe(accepted.run.id);
      expect(db.sqlite.prepare("SELECT count(*) AS n FROM __drizzle_migrations").get()).toEqual(
        migrationCount
      );
      expect(db.sqlite.prepare("PRAGMA integrity_check").get()).toMatchObject({
        integrity_check: "ok"
      });
      expect(db.sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      db.close();
      rmSync(folder, { recursive: true, force: true });
    }
  });
});
