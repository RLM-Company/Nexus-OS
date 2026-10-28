#!/usr/bin/env node
// Offline rehearsal only: migrate a disposable copy, never a live database or backup.
import { createHash } from "node:crypto";
import {
  createReadStream,
  existsSync,
  copyFileSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import process from "node:process";
import { verifyBackup } from "../deploy/alpha/sqlite-backup.mjs";

const root = resolve(import.meta.dirname, "..");
const digest = async (file) => {
  const hash = createHash("sha256");
  for await (const bytes of createReadStream(file)) hash.update(bytes);
  return hash.digest("hex");
};
const integrity = (sqlite) => {
  const rows = sqlite.prepare("PRAGMA integrity_check").all();
  if (rows.length !== 1 || Object.values(rows[0])[0] !== "ok")
    throw Error("PREACTIVATION_INTEGRITY_FAILED");
  if (sqlite.prepare("PRAGMA foreign_key_check").all().length)
    throw Error("PREACTIVATION_FOREIGN_KEYS_FAILED");
};
const migrationHistory = (sqlite, entries) => {
  if (
    !sqlite
      .prepare("SELECT 1 FROM sqlite_master WHERE name='__drizzle_migrations' AND type='table'")
      .get()
  )
    throw Error("PREACTIVATION_MIGRATION_HISTORY_MISSING");
  const rows = sqlite
    .prepare("SELECT hash,created_at FROM __drizzle_migrations ORDER BY created_at")
    .all();
  const seen = new Set();
  for (const row of rows) {
    const entry = entries.find((candidate) => candidate.when === row.created_at);
    if (!entry || seen.has(row.created_at) || row.hash !== entry.sha256)
      throw Error("PREACTIVATION_MIGRATION_HISTORY_MISMATCH");
    seen.add(row.created_at);
  }
  const last = rows.at(-1)?.created_at ?? -1;
  if (entries.some((entry) => entry.when <= last && !seen.has(entry.when)))
    throw Error("PREACTIVATION_MIGRATION_HISTORY_GAP: legacy bridge history needs explicit review");
  return rows.length;
};

export async function verifyVpsPreactivation({ database, backupManifest }) {
  if (typeof database !== "string" || typeof backupManifest !== "string")
    throw Error("PREACTIVATION_INPUT_REQUIRED");
  const copy = realpathSync(resolve(database));
  const verified = await verifyBackup(resolve(backupManifest));
  const backup = verified.file;
  const left = statSync(copy),
    right = statSync(backup);
  if (
    !left.isFile() ||
    !right.isFile() ||
    copy === backup ||
    (left.dev === right.dev && left.ino === right.ino)
  )
    throw Error("PREACTIVATION_INDEPENDENT_COPY_REQUIRED");
  for (const file of [copy, backup])
    if (existsSync(`${file}-wal`) || existsSync(`${file}-shm`) || existsSync(`${file}-journal`))
      throw Error("PREACTIVATION_OFFLINE_COPY_REQUIRED");
  const originalSha = await digest(copy);
  if (originalSha !== verified.sha256) throw Error("PREACTIVATION_COPY_CHECKSUM_MISMATCH");

  const journal = JSON.parse(
    readFileSync(join(root, "packages/db/migrations/meta/_journal.json"), "utf8")
  );
  const entries = journal.entries.map((entry) => ({
    ...entry,
    sha256: createHash("sha256")
      .update(readFileSync(join(root, "packages/db/migrations", `${entry.tag}.sql`)))
      .digest("hex")
  }));
  if (
    new Set(entries.map((entry) => entry.when)).size !== entries.length ||
    entries.some((entry, index) => index > 0 && entry.when <= entries[index - 1].when)
  )
    throw Error("PREACTIVATION_INVALID_SOURCE_JOURNAL");
  const { openDatabase, runMigrations } = await import("../packages/db/dist/index.js");
  const scratch = mkdtempSync(join(tmpdir(), "kosmora-preactivation-"));
  if (
    dirname(resolve(scratch)) !== resolve(tmpdir()) ||
    !basename(scratch).startsWith("kosmora-preactivation-")
  )
    throw Error("PREACTIVATION_INVALID_CLEANUP_PATH");
  let handle;
  try {
    const file = join(scratch, "rehearsal.sqlite");
    copyFileSync(copy, file);
    const before = new DatabaseSync(file, { readOnly: true });
    let appliedBefore;
    try {
      integrity(before);
      appliedBefore = migrationHistory(before, entries);
    } finally {
      before.close();
    }
    handle = openDatabase(file);
    await runMigrations(handle);
    integrity(handle.sqlite);
    const appliedAfter = migrationHistory(handle.sqlite, entries);
    if (appliedAfter !== entries.length)
      throw Error("PREACTIVATION_INCOMPLETE_MIGRATION_REHEARSAL");
    handle.close();
    handle = undefined;
    if ((await digest(copy)) !== originalSha || (await digest(backup)) !== verified.sha256)
      throw Error("PREACTIVATION_INPUT_CHANGED_DURING_REHEARSAL");
    return {
      format: "kosmora-offline-preactivation-v1",
      status: "OFFLINE_REHEARSAL_PASSED",
      backup_sha256: verified.sha256,
      applied_before: appliedBefore,
      applied_after: appliedAfter,
      migrations_applied_to_disposable_copy: appliedAfter - appliedBefore,
      migrations: entries.map(({ idx, tag, sha256 }) => ({ idx, tag, sha256 })),
      production_deployed: false,
      live_provider_tested: false
    };
  } finally {
    handle?.close();
    rmSync(scratch, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const value = (name) => args[args.indexOf(name) + 1];
  if (args.length !== 4 || args[0] !== "--database" || args[2] !== "--backup-manifest")
    throw Error(
      "Usage: vps-preactivation-check.mjs --database /OFFLINE/copy.sqlite --backup-manifest /PRIVATE/backup.sqlite.json"
    );
  try {
    process.stdout.write(
      JSON.stringify(
        await verifyVpsPreactivation({
          database: value("--database"),
          backupManifest: value("--backup-manifest")
        }),
        null,
        2
      ) + "\n"
    );
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
