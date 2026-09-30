import assert from "node:assert/strict";
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { createBackup, verifyBackup } from "../sqlite-backup.mjs";

const fixture = (t) => {
  const root = mkdtempSync(join(tmpdir(), "cosmora-backup-test-"));
  const file = join(root, "live.db");
  const database = new DatabaseSync(file);
  database.exec(
    "PRAGMA journal_mode=WAL; CREATE TABLE messages(id INTEGER PRIMARY KEY, body TEXT);"
  );
  database.prepare("INSERT INTO messages(body) VALUES(?)").run("committed WAL message");
  t.after(() => {
    database.close();
    assert.equal(dirname(resolve(root)), resolve(tmpdir()));
    assert.ok(basename(root).startsWith("cosmora-backup-test-"));
    rmSync(root, { recursive: true, force: true });
  });
  return { root, file, database, output: join(root, "backups") };
};

test("online backup includes WAL records and restores an independent snapshot", async (t) => {
  const f = fixture(t);
  assert.ok(existsSync(`${f.file}-wal`));
  const result = await createBackup(`file:${f.file}`, f.output);
  const verified = await verifyBackup(result.manifestPath);
  f.database.prepare("INSERT INTO messages(body) VALUES(?)").run("after snapshot");
  const restoredFile = join(f.root, "restored.db");
  copyFileSync(verified.file, restoredFile);
  const restored = new DatabaseSync(restoredFile, { readOnly: true });
  try {
    assert.deepEqual(
      restored
        .prepare("SELECT body FROM messages ORDER BY id")
        .all()
        .map((row) => row.body),
      ["committed WAL message"]
    );
    assert.equal(f.database.prepare("SELECT count(*) AS n FROM messages").get().n, 2);
    assert.equal(restored.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
  } finally {
    restored.close();
  }
  if (process.platform !== "win32") {
    assert.equal(statSync(f.output).mode & 0o777, 0o700);
    assert.equal(statSync(verified.file).mode & 0o777, 0o600);
    assert.equal(statSync(result.manifestPath).mode & 0o777, 0o600);
  }
});

test("backup verification rejects tampering without modifying the live database", async (t) => {
  const f = fixture(t);
  const result = await createBackup(f.file, f.output);
  const file = join(f.output, result.file);
  const bytes = readFileSync(file);
  bytes[bytes.length - 1] ^= 1;
  writeFileSync(file, bytes);
  await assert.rejects(verifyBackup(result.manifestPath), /checksum mismatch/u);
  assert.equal(f.database.prepare("SELECT count(*) AS n FROM messages").get().n, 1);
});

test("missing source cannot create an empty database or a misleading backup", async (t) => {
  const f = fixture(t);
  const missing = join(f.root, "missing.db");
  await assert.rejects(createBackup(missing, f.output), /ENOENT/u);
  assert.equal(existsSync(missing), false);
  assert.equal(existsSync(f.output), false);
});

test("backup output cannot share the live database directory", async (t) => {
  const f = fixture(t);
  await assert.rejects(createBackup(f.file, f.root), /separate backup directory/u);
});

test("a manifest cannot resolve a database outside its backup directory", async (t) => {
  const f = fixture(t);
  const result = await createBackup(f.file, f.output);
  const manifest = JSON.parse(readFileSync(result.manifestPath, "utf8"));
  writeFileSync(result.manifestPath, JSON.stringify({ ...manifest, file: "../live.db" }));
  await assert.rejects(verifyBackup(result.manifestPath), /Invalid SQLite backup manifest/u);
});
