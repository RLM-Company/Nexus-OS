#!/usr/bin/env node
/** Reproduce previous 0030 table/trigger layout and test safe offline v3 bridge. */
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { spawnSync } from "node:child_process";
import { readFileSync, mkdtempSync, existsSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
const repo = resolve(import.meta.dirname, "..");
const directory = mkdtempSync(join(tmpdir(), "kosmora-retained-legacy-"));
const sha = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");
const journal = JSON.parse(
  readFileSync(join(repo, "packages/db/migrations/meta/_journal.json"), "utf8")
);
const fixture = (path, retained = false) => {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA foreign_keys=ON");
  for (const entry of journal.entries) {
    let ddl = readFileSync(join(repo, "packages/db/migrations", entry.tag + ".sql"), "utf8");
    if (entry.idx === 30) {
      ddl = ddl
        .replace("  run_id TEXT NOT NULL,\n", "")
        .replaceAll("usage_id,run_id,owner_id,", "usage_id,owner_id,")
        .replace(
          "SELECT 'general', OLD.usage_id, OLD.run_id, c.owner_id",
          "SELECT 'general', OLD.usage_id, c.owner_id"
        )
        .replace(
          "SELECT 'project', OLD.usage_id, OLD.run_id, p.owner_id",
          "SELECT 'project', OLD.usage_id, p.owner_id"
        )
        .replace(
          "SELECT 'general',u.usage_id,u.run_id, OLD.owner_id",
          "SELECT 'general',u.usage_id, OLD.owner_id"
        )
        .replace(
          "SELECT 'project',u.usage_id,u.run_id, OLD.owner_id",
          "SELECT 'project',u.usage_id, OLD.owner_id"
        );
    }
    for (const stmt of ddl.split("--> statement-breakpoint")) if (stmt.trim()) db.exec(stmt);
  }
  const at = "2026-10-09T00:00:00.000Z";
  db.prepare(
    "INSERT INTO projects(id,owner_id,title,status,created_at,updated_at) VALUES(?,?,?,?,?,?)"
  ).run("p", "alice", "test", "ACTIVE", at, at);
  db.prepare("INSERT INTO chats(id,project_id,kind,created_at) VALUES(?,?,?,?)").run(
    "c",
    "p",
    "main",
    at
  );
  db.prepare(
    "INSERT INTO runs(id,project_id,chat_id,status,created_at,updated_at) VALUES(?,?,?,?,?,?)"
  ).run("r", "p", "c", "succeeded", at, at);
  db.prepare(
    `INSERT INTO model_usage_ledger(usage_id,run_id,project_id,attempt,status,registry_version,provider_id,
   model_requested,estimated_input_tokens,max_output_tokens,actual_input_tokens,actual_output_tokens,
   calculated_cost_amount,currency,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    "use",
    "r",
    "p",
    1,
    "committed",
    "r1",
    "provider",
    "model",
    100,
    50,
    10,
    5,
    0.1,
    "USD",
    at,
    at
  );
  if (retained) db.prepare("DELETE FROM projects WHERE id=?").run("p");
  db.close();
};
try {
  const name = join(directory, "previous-0030.sqlite"),
    backup = join(directory, "backup.sqlite");
  fixture(name);
  const before = sha(name);
  const cli = join(repo, "scripts/retrofit-retained-accounting.mjs");
  const run = spawnSync(
    process.execPath,
    ["--no-warnings", cli, "--apply", "--database", name, "--backup", backup],
    { encoding: "utf8" }
  );
  assert.equal(run.status, 0, run.stderr);
  assert(existsSync(backup));
  assert.equal(sha(backup), before);
  const db = new DatabaseSync(name);
  db.exec("PRAGMA foreign_keys=ON");
  assert(
    db
      .prepare("PRAGMA table_info(kosmora_retained_accounting)")
      .all()
      .some((row) => row.name === "run_id")
  );
  db.prepare("DELETE FROM projects WHERE id=?").run("p");
  const row = db
    .prepare("SELECT run_id,attempt FROM kosmora_retained_accounting WHERE usage_id=?")
    .get("use");
  assert.equal(row.run_id, "r");
  assert.equal(row.attempt, 1);
  assert.equal(db.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
  db.close();
  console.log(
    "PASS legacy 0030 offline: byte-verifiable backup, restored retain triggers and run_id capture"
  );
  const bad = join(directory, "nonempty-previous.sqlite"),
    blockedBackup = join(directory, "nonempty-backup.sqlite");
  fixture(bad, true);
  const digest = sha(bad);
  const refused = spawnSync(
    process.execPath,
    ["--no-warnings", cli, "--apply", "--database", bad, "--backup", blockedBackup],
    { encoding: "utf8" }
  );
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /NONEMPTY_LEGACY_RETAINED_HISTORY/);
  assert(!existsSync(blockedBackup));
  assert.equal(sha(bad), digest);
  console.log(
    "PASS nonempty legacy retained audit fails closed without changing SQLite or producing false backup"
  );
} finally {
  rmSync(directory, { recursive: true, force: true });
}
