import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ManagerWorkStore,
  OwnerSkillStore,
  ProjectStore,
  openDatabase,
  runMigrations
} from "../src/index.js";

describe("Work Skills additive migration and restart", () => {
  it("preserves 0046 tasks, never adds Skills retroactively, and restores accepted snapshots after reopen", async () => {
    const folder = mkdtempSync(join(tmpdir(), "work-skills-upgrade-")),
      path = `file:${join(folder, "state.db")}`;
    let db = openDatabase(path);
    try {
      const migrations = join(folder, "migrations");
      cpSync(fileURLToPath(new URL("../migrations", import.meta.url)), migrations, {
        recursive: true
      });
      const jp = join(migrations, "meta/_journal.json"),
        j = JSON.parse(readFileSync(jp, "utf8")) as { entries: { idx: number }[] };
      j.entries = j.entries.filter((x) => x.idx < 47);
      writeFileSync(jp, JSON.stringify(j));
      await runMigrations(db, migrations);
      const project = new ProjectStore(db.sqlite).createProject("Legacy", "legacy", "owner").project
        .id;
      db.sqlite
        .prepare(
          "INSERT INTO manager_work(id,project_id,owner_id,client_request_id,version,state_json) VALUES('old-work',?,'owner','old',1,'{}')"
        )
        .run(project);
      db.sqlite
        .prepare("INSERT INTO work_dags VALUES('old-plan',?,'owner','old',1,'{}','{}')")
        .run(project);
      const old = db.sqlite.prepare("SELECT * FROM manager_work").all();
      const skill = new OwnerSkillStore(db.sqlite).create("owner", {
        name: "Brief",
        summary: "Precise",
        instructions: "DURABLE_V1"
      });
      await runMigrations(db);
      expect(db.sqlite.prepare("SELECT * FROM manager_work").all()).toEqual(old);
      let store = new ManagerWorkStore(db.sqlite);
      expect(store.skills.forWork("old-work", "owner")).toMatchObject({
        source: "legacy",
        items: []
      });
      expect(store.skills.forPlan("old-plan", "owner")).toMatchObject({
        source: "legacy",
        items: []
      });
      store.skills.update(project, "owner", 0, [{ skill_id: skill.id, version: 1 }]);
      const request = {
        client_request_id: "durable",
        goal: "Result",
        worker_role: "analyst" as const,
        max_model_requests: 3,
        max_input_tokens: 32000,
        max_output_tokens: 6000
      };
      const a = store.create(project, "owner", "owner", request)!;
      const graph = store.dag.create(project, "owner", "owner", {
        client_request_id: "new",
        title: "Plan",
        nodes: [{ id: "a", title: "A", goal: "File", depends_on: [] }]
      });
      const snap = store.skills.forWork(a.id, "owner"),
        planSnap = store.skills.forPlan(graph.id, "owner");
      const count = db.sqlite.prepare("SELECT COUNT(*) AS n FROM __drizzle_migrations").get();
      db.close();
      db = openDatabase(path);
      await runMigrations(db);
      store = new ManagerWorkStore(db.sqlite);
      new OwnerSkillStore(db.sqlite).delete("owner", skill.id, 1);
      expect(store.skills.forWork(a.id, "owner")).toEqual(snap);
      expect(store.skills.forPlan(graph.id, "owner")).toEqual(planSnap);
      expect(store.create(project, "owner", "owner", request)?.id).toBe(a.id);
      expect(store.skills.forWork("old-work", "owner")?.items).toEqual([]);
      expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM __drizzle_migrations").get()).toEqual(
        count
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
