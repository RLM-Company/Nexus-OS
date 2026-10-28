import assert from "node:assert/strict";
import {
  copyFileSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  linkSync,
  mkdirSync
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { openDatabase, runMigrations } from "../../../packages/db/dist/index.js";
import { createBackup } from "../sqlite-backup.mjs";
import { verifyVpsPreactivation } from "../../../scripts/vps-preactivation-check.mjs";

async function fixture(t, previous = false) {
  const root = mkdtempSync(join(tmpdir(), "kosmora-preactivation-test-"));
  t.after(() => {
    assert.equal(dirname(resolve(root)), resolve(tmpdir()));
    assert.ok(basename(root).startsWith("kosmora-preactivation-test-"));
    rmSync(root, { recursive: true, force: true });
  });
  const source = join(root, "source.sqlite");
  const handle = openDatabase(source);
  if (previous) {
    const migrations = resolve(import.meta.dirname, "../../../packages/db/migrations");
    const journal = JSON.parse(readFileSync(join(migrations, "meta/_journal.json"), "utf8"));
    journal.entries = journal.entries.slice(0, -3);
    const folder = join(root, "previous-migrations");
    mkdirSync(join(folder, "meta"), { recursive: true });
    writeFileSync(join(folder, "meta/_journal.json"), JSON.stringify(journal));
    for (const entry of journal.entries)
      copyFileSync(join(migrations, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`));
    await runMigrations(handle, folder);
  } else await runMigrations(handle);
  handle.close();
  const backup = await createBackup(source, join(root, "backups"));
  const file = join(root, "copy.sqlite");
  copyFileSync(join(root, "backups", backup.file), file);
  return { root, source, file, backup, backupManifest: backup.manifestPath };
}
test("preactivation runs the real migration engine on a disposable copy without modifying either input", async (t) => {
  const f = await fixture(t);
  const original = readFileSync(f.file);
  const report = await verifyVpsPreactivation({
    database: f.file,
    backupManifest: f.backupManifest
  });
  assert.equal(report.status, "OFFLINE_REHEARSAL_PASSED");
  assert.equal(report.production_deployed, false);
  assert.equal(report.applied_after, report.migrations.length);
  assert.equal(report.migrations_applied_to_disposable_copy, 0);
  assert.deepEqual(readFileSync(f.file), original);
  assert.deepEqual(readFileSync(join(f.root, "backups", f.backup.file)), original);
});
test("preactivation actually upgrades the previous schema and preserves the older input and backup", async (t) => {
  const f = await fixture(t, true);
  const before = readFileSync(f.file);
  const report = await verifyVpsPreactivation({
    database: f.file,
    backupManifest: f.backupManifest
  });
  assert.equal(report.migrations_applied_to_disposable_copy, 3);
  assert.equal(report.applied_after, report.migrations.length);
  assert.deepEqual(readFileSync(f.file), before);
  assert.deepEqual(readFileSync(join(f.root, "backups", f.backup.file)), before);
});
test("preactivation refuses a changed copy, live sidecars, backup aliases and tampered migration history", async (t) => {
  const f = await fixture(t);
  const file = join(f.root, "backups", f.backup.file);
  await assert.rejects(
    verifyVpsPreactivation({ database: file, backupManifest: f.backupManifest }),
    /INDEPENDENT_COPY/
  );
  const linked = join(f.root, "linked.sqlite");
  linkSync(file, linked);
  await assert.rejects(
    verifyVpsPreactivation({ database: linked, backupManifest: f.backupManifest }),
    /INDEPENDENT_COPY/
  );
  writeFileSync(`${f.file}-wal`, "busy");
  await assert.rejects(
    verifyVpsPreactivation({ database: f.file, backupManifest: f.backupManifest }),
    /OFFLINE_COPY/
  );
  rmSync(`${f.file}-wal`);
  const db = new DatabaseSync(f.file);
  db.exec(
    "UPDATE __drizzle_migrations SET hash='altered' WHERE created_at=(SELECT min(created_at) FROM __drizzle_migrations)"
  );
  db.close();
  await assert.rejects(
    verifyVpsPreactivation({ database: f.file, backupManifest: f.backupManifest }),
    /CHECKSUM_MISMATCH/
  );
  const changed = await createBackup(f.file, join(f.root, "changed-backups"));
  const copy = join(f.root, "changed-copy.sqlite");
  copyFileSync(join(f.root, "changed-backups", changed.file), copy);
  await assert.rejects(
    verifyVpsPreactivation({ database: copy, backupManifest: changed.manifestPath }),
    /MIGRATION_HISTORY_MISMATCH/
  );
});
