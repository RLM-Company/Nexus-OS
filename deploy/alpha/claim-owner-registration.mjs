import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// One-time offline migration of the existing owner's password into the new account table.
// Run only after 0036 has been applied, with API/edge stopped and a verified database backup.
const dbPath = process.env.KOSMORA_CLAIM_DATABASE;
const ownerId = process.env.KOSMORA_CLAIM_OWNER_ID;
const email = process.env.KOSMORA_CLAIM_EMAIL?.trim().toLowerCase();
const passwordFile = process.env.KOSMORA_CLAIM_PASSWORD_HASH_FILE;
if (
  !dbPath?.startsWith("/") ||
  !ownerId ||
  !email ||
  email.length > 254 ||
  !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email) ||
  !passwordFile?.startsWith("/")
) {
  throw Error("Set absolute database/hash-file paths, existing owner ID and a valid email");
}
const passwordHash = /^COSMORA_OWNER_PASSWORD_HASH=(scrypt:[a-f0-9]{32}:[a-f0-9]{64})$/mu.exec(
  readFileSync(resolve(passwordFile), "utf8")
)?.[1];
if (!passwordHash) throw Error("Existing owner password hash is missing");
const db = new DatabaseSync(dbPath);
try {
  db.exec("PRAGMA foreign_keys = ON; BEGIN IMMEDIATE");
  const actor = db
    .prepare(
      "SELECT 1 FROM identity_actors WHERE owner_id=? AND actor_id=? AND kind='owner' AND status='active'"
    )
    .get(ownerId, ownerId);
  if (!actor) throw Error("No active matching owner actor");
  if (db.prepare("SELECT 1 FROM auth_accounts WHERE owner_id=? OR email=?").get(ownerId, email))
    throw Error("Account or email already claimed");
  const at = new Date().toISOString();
  db.prepare(
    "INSERT INTO auth_accounts (owner_id,email,password_hash,google_sub,verified_at,created_at,updated_at) VALUES (?,?,?,NULL,?,?,?)"
  ).run(ownerId, email, passwordHash, at, at, at);
  db.exec("COMMIT");
  process.stdout.write(
    "Existing owner account claimed; switch proxy only after separate login verification.\n"
  );
} catch (cause) {
  db.exec("ROLLBACK");
  throw cause;
} finally {
  db.close();
}
