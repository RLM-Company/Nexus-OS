#!/usr/bin/env node
/** Test an actual old 76e44320 schema missing migration 25 (not a clean-state approximation). */
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
const root = resolve(import.meta.dirname, "..");
const d = mkdtempSync(join(tmpdir(), "kosmora-retrofit-"));
try {
  const dbfile = join(d, "legacy.sqlite"),
    backup = join(d, "offline-backup.sqlite");
  const sqlite = new DatabaseSync(dbfile);
  sqlite.exec("PRAGMA foreign_keys=ON");
  const manifest = JSON.parse(
    readFileSync(resolve(root, "packages/db/migrations/meta/_journal.json"))
  );
  let count = 0;
  for (const entry of manifest.entries.filter((x) => x.idx <= 28 && x.idx !== 25)) {
    const sql = readFileSync(resolve(root, "packages/db/migrations", entry.tag + ".sql"), "utf8");
    sqlite.exec("BEGIN");
    try {
      for (const query of sql.split("--> statement-breakpoint"))
        if (query.trim()) sqlite.exec(query);
      sqlite.exec("COMMIT");
      count++;
    } catch (e) {
      sqlite.exec("ROLLBACK");
      throw new Error(`${entry.tag}: ${e.message}`);
    }
  }
  assert.equal(
    sqlite.prepare("SELECT count(*) n FROM sqlite_master WHERE name='document_library_files'").get()
      .n,
    0
  );
  sqlite.close();
  const response = execFileSync(
    process.execPath,
    [
      resolve(root, "scripts/retrofit-document-library.mjs"),
      "--apply",
      "--database",
      dbfile,
      "--backup",
      backup
    ],
    { encoding: "utf8" }
  ).trim();
  const report = JSON.parse(response);
  assert.equal(report.status, "PASS");
  assert.ok(existsSync(backup));
  const upgraded = new DatabaseSync(dbfile);
  for (const name of ["document_library_files", "document_library_chunks", "document_library_fts"])
    assert.equal(
      upgraded.prepare("SELECT count(*) n FROM sqlite_master WHERE name=?").get(name).n,
      1
    );
  assert.equal(upgraded.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
  upgraded.close();
  const original = new DatabaseSync(backup);
  assert.equal(
    original
      .prepare("SELECT count(*) n FROM sqlite_master WHERE name='document_library_files'")
      .get().n,
    0
  );
  original.close();
  console.log(
    `PASS offline upgrade ${count} old migrations (25 missing) -> 25 applied, backup verified and preserved`
  );
} finally {
  rmSync(d, { force: true, recursive: true });
}
