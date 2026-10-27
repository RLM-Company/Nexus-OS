import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ManagerWorkStore, openDatabase, ProjectStore, runMigrations } from "../src/index.js";

describe("Work runtime migration compatibility", () => {
  it("upgrades the deployed migration24 database and preserves historical downloads without invented versions", async () => {
    const temporary = mkdtempSync(join(tmpdir(), "kosmora-work-upgrade-"));
    const database = openDatabase(join(temporary, "state.db"));
    try {
      const source = fileURLToPath(new URL("../migrations/", import.meta.url));
      const baseline = join(temporary, "baseline");
      mkdirSync(join(baseline, "meta"), { recursive: true });
      const journal = JSON.parse(readFileSync(join(source, "meta/_journal.json"), "utf8")) as {
        entries: { idx: number; tag: string; when: number }[];
      };
      const oldEntries = journal.entries.filter((entry) => entry.idx <= 24);
      for (const entry of oldEntries)
        copyFileSync(join(source, entry.tag + ".sql"), join(baseline, entry.tag + ".sql"));
      writeFileSync(
        join(baseline, "meta/_journal.json"),
        JSON.stringify({ ...journal, entries: oldEntries })
      );
      await runMigrations(database, baseline);
      const projects = new ProjectStore(database.sqlite);
      const project = projects.createProject(
        "Existing project",
        "baseline-project",
        "owner"
      ).project;
      const historical = {
        id: "historical",
        project_id: project.id,
        owner_id: "owner",
        version: 1,
        status: "completed",
        stage: "done",
        draft: { files: [{ name: "old.md", content: "Historical output" }] }
      };
      database.sqlite
        .prepare(
          "INSERT INTO manager_work (id, project_id, owner_id, client_request_id, version, state_json) VALUES (?, ?, ?, ?, ?, ?)"
        )
        .run(
          historical.id,
          project.id,
          "owner",
          "historical-request",
          1,
          JSON.stringify(historical)
        );
      database.sqlite
        .prepare("INSERT INTO manager_work_files (execution_id, name, content) VALUES (?, ?, ?)")
        .run(historical.id, "old.md", "Historical output");
      await runMigrations(database);
      await runMigrations(database);
      const store = new ManagerWorkStore(database.sqlite);
      expect(store.file(historical.id, "owner", "old.md")).toBe("Historical output");
      expect(store.runtime.artifacts(project.id, "owner")).toEqual([]);
      expect(store.runtime.checkpoints(project.id, "owner", historical.id)).toEqual([]);
      const created = store.create(project.id, "owner", "owner", {
        client_request_id: "new-runtime",
        goal: "Create useful files",
        worker_role: "analyst",
        max_model_requests: 3,
        max_input_tokens: 32000,
        max_output_tokens: 6000
      })!;
      expect(store.claim(created)?.status).toBe("running");
      expect(store.runtime.checkpoints(project.id, "owner", created.id)).toHaveLength(2);
      expect(database.sqlite.prepare("PRAGMA integrity_check").get()).toMatchObject({
        integrity_check: "ok"
      });
      const runtime = journal.entries.find((entry) => entry.tag === "0026_work_runtime")!;
      expect(runtime.idx).toBe(26);
      expect(runtime.when).toBeGreaterThan(oldEntries.at(-1)!.when);
    } finally {
      database.close();
      // The generated target must remain within the explicitly named temporary parent.
      expect(dirname(resolve(temporary))).toBe(resolve(tmpdir()));
      rmSync(temporary, { recursive: true });
    }
  });
});
