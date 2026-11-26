import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { openDatabase, ProjectStore, runMigrations } from "../src/index.js";

const migrations = fileURLToPath(new URL("../migrations", import.meta.url));
const journal = JSON.parse(readFileSync(join(migrations, "meta/_journal.json"), "utf8")) as {
  entries: { idx: number; tag: string }[];
};
const owner = "upgrade-owner";
const time = "2026-11-26T12:00:00.000Z";
const names = [
  "project_correction_rules",
  "project_source_settings",
  "project_source_exclusions",
  "project_run_sources",
  "project_members",
  "stars_missions"
];

it.each(["fresh", "old main", "candidate", "Stars main", "delivery with members"])(
  "reconciles the migration journal on %s and preserves existing records",
  async (profile) => {
    const folder = mkdtempSync(join(tmpdir(), "nexus-project-upgrade-"));
    const filename = join(folder, "fixture.sqlite");
    let db = openDatabase(filename);
    try {
      const projects = () => new ProjectStore(db.sqlite);
      if (profile !== "fresh") {
        const entries = journal.entries.filter(
          ({ idx }) =>
            idx <= 71 ||
            ((profile === "candidate" || profile === "delivery with members") &&
              [72, 73].includes(idx)) ||
            ((profile === "Stars main" || profile === "delivery with members") && idx === 75)
        );
        mkdirSync(join(folder, "meta"));
        writeFileSync(join(folder, "meta/_journal.json"), JSON.stringify({ ...journal, entries }));
        for (const { tag } of entries)
          copyFileSync(join(migrations, tag + ".sql"), join(folder, tag + ".sql"));
        await runMigrations(db, folder);
        projects().createEmptyProject("project", "Закупка 00123", owner, "ACTIVE");
        projects().setMaterials("project", owner, {
          version: 0,
          instructions: "кроме доставки",
          attachments: []
        });
        db.sqlite
          .prepare("INSERT INTO manager_work VALUES(?,?,?,?,?,?)")
          .run("work", "project", owner, "request", 2, '{"status":"paused"}');
        if (profile === "candidate" || profile === "delivery with members") {
          db.sqlite
            .prepare("INSERT INTO project_correction_rules VALUES(?,?,?,?,?,?,?,?,?,?,?)")
            .run(
              "rule",
              "project",
              owner,
              "rule-req",
              "Доставка",
              "Строка",
              "Отдельно",
              1,
              1,
              time,
              time
            );
          db.sqlite
            .prepare("INSERT INTO project_run_sources VALUES(?,?,?,?,?)")
            .run(owner, "project", "work", time, "[]");
        }
        if (profile === "Stars main" || profile === "delivery with members")
          db.sqlite
            .prepare("INSERT INTO stars_missions VALUES(?,?,?,?,?,?,?)")
            .run("mission", owner, "team", 1, "{}", time, time);
        if (profile === "delivery with members") {
          const repair = readFileSync(join(migrations, "0077_project_intake_schema.sql"), "utf8");
          const memberDdl = repair
            .split("--> statement-breakpoint")
            .filter((sql) => /CREATE (TABLE|INDEX) IF NOT EXISTS project_members/.test(sql));
          expect(memberDdl).toHaveLength(2);
          for (const sql of memberDdl) db.sqlite.exec(sql);
          db.sqlite
            .prepare("INSERT INTO project_members VALUES(?,?,?,?,?,?,?)")
            .run("project", "editor", owner, "editor", "active", time, time);
        }
        db.close();
        db = openDatabase(filename);
      }
      const snapshot = (table: string) => db.sqlite.prepare("SELECT * FROM " + table).all();
      const before = new Map(
        ["projects", "project_materials", "manager_work", ...names].flatMap((table) =>
          db.sqlite.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?").get(table)
            ? [[table, snapshot(table)] as const]
            : []
        )
      );
      await runMigrations(db);
      const applied = snapshot("__drizzle_migrations");
      await runMigrations(db);
      expect(snapshot("__drizzle_migrations")).toEqual(applied);
      expect(db.sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      for (const name of [
        ...names,
        "project_members_account_idx",
        "project_run_sources_project_idx",
        "project_correction_rules_active_idx"
      ])
        expect(
          db.sqlite.prepare("SELECT 1 FROM sqlite_schema WHERE name=?").get(name),
          name
        ).toBeDefined();
      for (const [table, rows] of before) expect(snapshot(table), table).toEqual(rows);
    } finally {
      db.close();
      rmSync(folder, { recursive: true, force: true });
    }
  }
);
