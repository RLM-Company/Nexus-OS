import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { DocumentAnswerStore, openDatabase, ProjectStore, runMigrations } from "../src/index.js";

it("preserves an existing partial analysis when adding the batch registry after 0077", async () => {
  const folder = mkdtempSync(join(tmpdir(), "kosmora-checkpoint-upgrade-"));
  const migrations = fileURLToPath(new URL("../migrations", import.meta.url));
  const journal = JSON.parse(readFileSync(join(migrations, "meta/_journal.json"), "utf8")) as {
    entries: { idx: number; tag: string }[];
  };
  const entries = journal.entries.filter(({ idx }) => idx <= 77);
  const db = openDatabase(join(folder, "old.db"));
  try {
    mkdirSync(join(folder, "meta"));
    writeFileSync(join(folder, "meta/_journal.json"), JSON.stringify({ ...journal, entries }));
    for (const { tag } of entries)
      copyFileSync(join(migrations, tag + ".sql"), join(folder, tag + ".sql"));
    await runMigrations(db, folder);
    const owner = "test-owner";
    const project = new ProjectStore(db.sqlite).createProject("Сверка", "old-project", owner)
      .project.id;
    const store = new DocumentAnswerStore(db.sqlite);
    const coverage = {
      phase: "reading" as const,
      total_chunks: 4,
      analyzed_chunks: 2,
      failed_chunks: 0,
      files: []
    };
    const run = store.create(project, owner, "Сверить 00123", ["old-file"], [], coverage);
    expect(
      store.transition(project, owner, run.id, "queued", "failed", { error: "INTERRUPTED" })
    ).toBe(true);
    const before = store.get(project, owner, run.id);
    await runMigrations(db);
    const ledger = db.sqlite.prepare("SELECT * FROM __drizzle_migrations").all();
    await runMigrations(db);
    expect(db.sqlite.prepare("SELECT * FROM __drizzle_migrations").all()).toEqual(ledger);
    expect(store.get(project, owner, run.id)).toEqual(before);
    expect([...store.batches(run)]).toEqual([]);
    const resumed = store.create(project, owner, run.question, ["old-file"], [], coverage, {
      of: run.id,
      requestId: "repeat-0077"
    });
    expect(store.transition(project, owner, resumed.id, "queued", "running")).toBe(true);
    expect(store.saveBatch(resumed, 0, "a".repeat(64), '{"notes":null}', coverage)).toBe(true);
    expect([...store.batches(resumed)]).toHaveLength(1);
    store.deleteOwner(owner);
    expect(db.sqlite.prepare("SELECT * FROM document_answer_batches").all()).toEqual([]);
  } finally {
    db.close();
    rmSync(folder, { recursive: true, force: true });
  }
});
