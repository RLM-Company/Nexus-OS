import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { openDatabase, runMigrations, ProjectMemoryStore, ProjectStore } from "../src/index.js";

it("upgrades existing project memory without changing legacy records", async () => {
  const directory = mkdtempSync(join(tmpdir(), "kosmora-memory-creation-"));
  let db = openDatabase(join(directory, "state.db"));
  try {
    const source = fileURLToPath(new URL("../migrations/", import.meta.url));
    const baseline = join(directory, "baseline");
    mkdirSync(join(baseline, "meta"), { recursive: true });
    const journal = JSON.parse(readFileSync(join(source, "meta/_journal.json"), "utf8")) as {
      entries: { idx: number; tag: string; when: number }[];
    };
    const entries = journal.entries.filter((entry) => entry.idx <= 63);
    for (const entry of entries)
      copyFileSync(join(source, entry.tag + ".sql"), join(baseline, entry.tag + ".sql"));
    writeFileSync(join(baseline, "meta/_journal.json"), JSON.stringify({ ...journal, entries }));
    await runMigrations(db, baseline);
    const project = new ProjectStore(db.sqlite).createProject(
      "Legacy",
      crypto.randomUUID(),
      "owner"
    ).project.id;
    db.sqlite
      .prepare(
        "INSERT INTO project_memory (id,project_id,owner_id,version,title,content,source_json,pinned,created_at,updated_at) VALUES ('legacy',?,'owner',2,'До обновления','19 700 ₽, кроме доставки',?,1,?,?)"
      )
      .run(
        project,
        JSON.stringify({ kind: "owner", reference: "Owner" }),
        "2026-11-09T12:00:00.000Z",
        "2026-11-09T12:00:00.000Z"
      );
    await runMigrations(db);
    await runMigrations(db);
    let memory = new ProjectMemoryStore(db.sqlite);
    expect(memory.get(project, "owner", "legacy")).toMatchObject({
      version: 2,
      content: "19 700 ₽, кроме доставки",
      pinned: true
    });
    expect(
      db.sqlite
        .prepare("SELECT creation_key,creation_sha256 FROM project_memory WHERE id='legacy'")
        .get()
    ).toMatchObject({ creation_key: null, creation_sha256: null });
    const input = {
      title: "New",
      content: "00123",
      pinned: false,
      source: { kind: "owner" as const, reference: "Owner" }
    };
    const first = memory.create(project, "owner", input, "attempt");
    db.close();
    db = openDatabase(join(directory, "state.db"));
    memory = new ProjectMemoryStore(db.sqlite);
    expect(memory.create(project, "owner", input, "attempt")).toEqual(first);
    expect(memory.list(project, "owner")).toHaveLength(2);
    expect(db.sqlite.prepare("PRAGMA integrity_check").get()).toMatchObject({
      integrity_check: "ok"
    });
    expect(journal.entries.at(-1)!.when).toBeGreaterThan(entries.at(-1)!.when);
  } finally {
    db.close();
    expect(dirname(resolve(directory))).toBe(resolve(tmpdir()));
    rmSync(directory, { recursive: true });
  }
});
