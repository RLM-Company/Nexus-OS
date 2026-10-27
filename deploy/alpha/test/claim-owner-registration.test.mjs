import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { hashOwnerPassword } from "../owner-access.mjs";

test("offline claim preserves the existing owner and refuses to overwrite it", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "kosmora-claim-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const database = join(dir, "accounts.db");
  const passwordFile = join(dir, "owner-login.env");
  const hash = hashOwnerPassword("existing-owner-password");
  writeFileSync(passwordFile, `COSMORA_OWNER_PASSWORD_HASH=${hash}\n`);
  const db = new DatabaseSync(database);
  db.exec(`
    CREATE TABLE identity_actors(actor_id TEXT PRIMARY KEY,owner_id TEXT,kind TEXT,status TEXT);
    CREATE TABLE auth_accounts(
      owner_id TEXT PRIMARY KEY,email TEXT UNIQUE,password_hash TEXT,google_sub TEXT UNIQUE,
      verified_at TEXT,created_at TEXT,updated_at TEXT
    );
    INSERT INTO identity_actors VALUES ('existing-owner','existing-owner','owner','active');
  `);
  db.close();
  const env = {
    ...process.env,
    KOSMORA_CLAIM_DATABASE: database,
    KOSMORA_CLAIM_PASSWORD_HASH_FILE: passwordFile,
    KOSMORA_CLAIM_OWNER_ID: "existing-owner",
    KOSMORA_CLAIM_EMAIL: "Owner@Example.com"
  };
  const script = fileURLToPath(new URL("../claim-owner-registration.mjs", import.meta.url));
  const first = spawnSync(process.execPath, [script], { env, encoding: "utf8" });
  assert.equal(first.status, 0, first.stderr);
  const result = new DatabaseSync(database);
  const row = result.prepare("SELECT owner_id,email,password_hash FROM auth_accounts").get();
  assert.deepEqual(
    { ...row },
    {
      owner_id: "existing-owner",
      email: "owner@example.com",
      password_hash: hash
    }
  );
  result.close();
  const second = spawnSync(process.execPath, [script], { env, encoding: "utf8" });
  assert.notEqual(second.status, 0);
  assert.ok(!second.stdout.includes(hash));
  assert.ok(!readFileSync(passwordFile, "utf8").includes("new-password"));
});
