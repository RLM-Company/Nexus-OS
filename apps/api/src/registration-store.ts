import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const VERIFY_TTL = 30 * 60 * 1000;
const RECOVERY_TTL = 30 * 60 * 1000;
const EMAIL_CHANGE_TTL = 30 * 60 * 1000;
type Row = Record<string, unknown>;

export const normalizedEmail = (value: string): string | null => {
  const email = value.trim().toLowerCase();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email) ? email : null;
};

export const hashPassword = (password: string): string => {
  if (password.length < 12 || password.length > 512) throw Error("INVALID_PASSWORD");
  const salt = randomBytes(16).toString("hex");
  return `scrypt:${salt}:${scryptSync(password, salt, 32, SCRYPT).toString("hex")}`;
};

const DUMMY_HASH = "scrypt:00000000000000000000000000000000:" + "0".repeat(64);
export const verifyPassword = (password: string, hash: string | null): boolean => {
  const value = hash && /^scrypt:[a-f0-9]{32}:[a-f0-9]{64}$/u.test(hash) ? hash : DUMMY_HASH;
  const [, salt, digest] = value.split(":");
  const candidate = scryptSync(password.slice(0, 512), salt!, 32, SCRYPT);
  return timingSafeEqual(candidate, Buffer.from(digest!, "hex")) && value !== DUMMY_HASH;
};
const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

export class RegistrationStore {
  constructor(
    private readonly db: DatabaseSync,
    private readonly now: () => number = Date.now
  ) {}

  requestEmailVerification(email: string, password: string, existingOnly = false): string | null {
    const normalized = normalizedEmail(email);
    if (!normalized) throw Error("INVALID_EMAIL");
    const passwordHash = hashPassword(password);
    const existing = this.db
      .prepare("SELECT owner_id, password_hash, verified_at FROM auth_accounts WHERE email = ?")
      .get(normalized) as Row | undefined;
    if (existingOnly && !existing) return null;
    if (existing?.verified_at) return null;
    if (
      existing &&
      !verifyPassword(
        password,
        typeof existing.password_hash === "string" ? existing.password_hash : ""
      )
    )
      return null;
    const ownerId = existing ? String(existing.owner_id) : randomUUID();
    const token = randomBytes(32).toString("base64url");
    const at = new Date(this.now()).toISOString();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      if (!existing) {
        this.db
          .prepare(
            "INSERT INTO auth_accounts (owner_id,email,password_hash,google_sub,verified_at,created_at,updated_at) VALUES (?,?,?,NULL,NULL,?,?)"
          )
          .run(ownerId, normalized, passwordHash, at, at);
      }
      this.db.prepare("DELETE FROM auth_email_verifications WHERE owner_id = ?").run(ownerId);
      this.db
        .prepare(
          "INSERT INTO auth_email_verifications (token_hash,owner_id,expires_at,created_at) VALUES (?,?,?,?)"
        )
        .run(tokenHash(token), ownerId, new Date(this.now() + VERIFY_TTL).toISOString(), at);
      this.db.exec("COMMIT");
      return token;
    } catch (cause) {
      this.db.exec("ROLLBACK");
      throw cause;
    }
  }

  confirmEmail(token: string): string | null {
    if (!/^[A-Za-z0-9_-]{43}$/u.test(token)) return null;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const row = this.db
        .prepare(
          "SELECT owner_id FROM auth_email_verifications WHERE token_hash=? AND consumed_at IS NULL AND expires_at>?"
        )
        .get(tokenHash(token), new Date(this.now()).toISOString()) as Row | undefined;
      if (!row) {
        this.db.exec("ROLLBACK");
        return null;
      }
      const ownerId = String(row.owner_id);
      const at = new Date(this.now()).toISOString();
      this.db
        .prepare("UPDATE auth_email_verifications SET consumed_at=? WHERE token_hash=?")
        .run(at, tokenHash(token));
      this.db
        .prepare("UPDATE auth_accounts SET verified_at=?,updated_at=? WHERE owner_id=?")
        .run(at, at, ownerId);
      this.db
        .prepare(
          "INSERT INTO identity_actors (actor_id,owner_id,kind,status,created_at,updated_at) VALUES (?,?,'owner','active',?,?)"
        )
        .run(ownerId, ownerId, at, at);
      this.db.exec("COMMIT");
      return ownerId;
    } catch (cause) {
      this.db.exec("ROLLBACK");
      throw cause;
    }
  }

  authenticateEmail(email: string, password: string): string | null {
    const normalized = normalizedEmail(email);
    const row = normalized
      ? (this.db
          .prepare("SELECT owner_id,password_hash,verified_at FROM auth_accounts WHERE email=?")
          .get(normalized) as Row | undefined)
      : undefined;
    const matches = verifyPassword(
      password,
      typeof row?.password_hash === "string" ? row.password_hash : null
    );
    return matches && row?.verified_at ? String(row.owner_id) : null;
  }

  methods(ownerId: string): { email: boolean; google: boolean } | null {
    const row = this.db
      .prepare("SELECT password_hash,google_sub FROM auth_accounts WHERE owner_id=?")
      .get(ownerId) as Row | undefined;
    return row ? { email: Boolean(row.password_hash), google: Boolean(row.google_sub) } : null;
  }

  requestEmailChange(
    ownerId: string,
    currentPassword: string,
    desiredEmail: string
  ): string | null {
    const newEmail = normalizedEmail(desiredEmail);
    if (!newEmail) throw Error("INVALID_EMAIL");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      if (
        this.db
          .prepare(
            "SELECT 1 FROM kosmora_owner_data_lifecycle WHERE owner_id=? AND state<>'active'"
          )
          .get(ownerId)
      )
        throw Error("OWNER_DATA_FENCED");
      const current = this.db
        .prepare(
          "SELECT email,password_hash FROM auth_accounts WHERE owner_id=? AND verified_at IS NOT NULL"
        )
        .get(ownerId) as Row | undefined;
      if (
        typeof current?.password_hash !== "string" ||
        !verifyPassword(currentPassword, current.password_hash) ||
        current.email === newEmail ||
        this.db.prepare("SELECT 1 FROM auth_accounts WHERE email=?").get(newEmail)
      ) {
        this.db.exec("ROLLBACK");
        return null;
      }
      const token = randomBytes(32).toString("base64url");
      const at = new Date(this.now()).toISOString();
      this.db.prepare("DELETE FROM auth_email_changes WHERE owner_id=?").run(ownerId);
      this.db
        .prepare(
          "INSERT INTO auth_email_changes(token_hash,owner_id,new_email,expires_at,created_at) VALUES(?,?,?,?,?)"
        )
        .run(
          tokenHash(token),
          ownerId,
          newEmail,
          new Date(this.now() + EMAIL_CHANGE_TTL).toISOString(),
          at
        );
      this.db.exec("COMMIT");
      return token;
    } catch (cause) {
      this.db.exec("ROLLBACK");
      throw cause;
    }
  }

  confirmEmailChange(token: string, revoke: (ownerId: string) => void): boolean {
    if (!/^[A-Za-z0-9_-]{43}$/u.test(token)) return false;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const row = this.db
        .prepare(
          "SELECT owner_id,new_email FROM auth_email_changes WHERE token_hash=? AND expires_at>?"
        )
        .get(tokenHash(token), new Date(this.now()).toISOString()) as Row | undefined;
      if (!row) {
        this.db.exec("ROLLBACK");
        return false;
      }
      const ownerId = String(row.owner_id),
        email = String(row.new_email);
      if (
        this.db
          .prepare(
            "SELECT 1 FROM kosmora_owner_data_lifecycle WHERE owner_id=? AND state<>'active'"
          )
          .get(ownerId) ||
        this.db.prepare("SELECT 1 FROM auth_accounts WHERE email=?").get(email)
      ) {
        this.db.exec("ROLLBACK");
        return false;
      }
      const at = new Date(this.now()).toISOString();
      const updated = this.db
        .prepare(
          "UPDATE auth_accounts SET email=?,updated_at=? WHERE owner_id=? AND verified_at IS NOT NULL AND password_hash IS NOT NULL"
        )
        .run(email, at, ownerId);
      if (updated.changes !== 1) {
        this.db.exec("ROLLBACK");
        return false;
      }
      this.db.prepare("DELETE FROM auth_email_changes WHERE owner_id=?").run(ownerId);
      this.db.prepare("DELETE FROM auth_password_resets WHERE owner_id=?").run(ownerId);
      revoke(ownerId);
      this.db.exec("COMMIT");
      return true;
    } catch (cause) {
      this.db.exec("ROLLBACK");
      throw cause;
    }
  }

  authenticateGoogle(email: string, subject: string): string | null {
    const normalized = normalizedEmail(email);
    if (!normalized || !/^[A-Za-z0-9_-]{1,255}$/u.test(subject)) return null;
    const bySubject = this.db
      .prepare("SELECT owner_id FROM auth_accounts WHERE google_sub=?")
      .get(subject) as Row | undefined;
    if (bySubject) return String(bySubject.owner_id);
    // An email match does not authorize implicit linking of a second login method.
    if (this.db.prepare("SELECT 1 FROM auth_accounts WHERE email=?").get(normalized)) return null;
    const ownerId = randomUUID();
    const at = new Date(this.now()).toISOString();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db
        .prepare(
          "INSERT INTO auth_accounts (owner_id,email,password_hash,google_sub,verified_at,created_at,updated_at) VALUES (?,?,NULL,?,?,?,?)"
        )
        .run(ownerId, normalized, subject, at, at, at);
      this.db
        .prepare(
          "INSERT INTO identity_actors (actor_id,owner_id,kind,status,created_at,updated_at) VALUES (?,?,'owner','active',?,?)"
        )
        .run(ownerId, ownerId, at, at);
      this.db.exec("COMMIT");
      return ownerId;
    } catch (cause) {
      this.db.exec("ROLLBACK");
      throw cause;
    }
  }

  linkGoogle(ownerId: string, subject: string): boolean {
    if (!/^[A-Za-z0-9_-]{1,255}$/u.test(subject)) return false;
    try {
      const result = this.db
        .prepare(
          "UPDATE auth_accounts SET google_sub=?,updated_at=? WHERE owner_id=? AND verified_at IS NOT NULL AND google_sub IS NULL"
        )
        .run(subject, new Date(this.now()).toISOString(), ownerId);
      return result.changes === 1;
    } catch {
      return false;
    }
  }

  addPassword(ownerId: string, password: string): boolean {
    const passwordHash = hashPassword(password);
    const result = this.db
      .prepare(
        "UPDATE auth_accounts SET password_hash=?,updated_at=? WHERE owner_id=? AND verified_at IS NOT NULL AND password_hash IS NULL"
      )
      .run(passwordHash, new Date(this.now()).toISOString(), ownerId);
    return result.changes === 1;
  }

  requestPasswordReset(email: string): string | null {
    const normalized = normalizedEmail(email);
    if (!normalized) return null;
    const account = this.db
      .prepare("SELECT owner_id FROM auth_accounts WHERE email=? AND verified_at IS NOT NULL")
      .get(normalized) as Row | undefined;
    if (!account) return null;
    const ownerId = String(account.owner_id);
    const token = randomBytes(32).toString("base64url");
    const at = new Date(this.now()).toISOString();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("DELETE FROM auth_password_resets WHERE owner_id=?").run(ownerId);
      this.db
        .prepare(
          "INSERT INTO auth_password_resets (token_hash,owner_id,expires_at,created_at) VALUES (?,?,?,?)"
        )
        .run(tokenHash(token), ownerId, new Date(this.now() + RECOVERY_TTL).toISOString(), at);
      this.db.exec("COMMIT");
      return token;
    } catch (cause) {
      this.db.exec("ROLLBACK");
      throw cause;
    }
  }

  resetPassword(token: string, password: string, revoke: (ownerId: string) => void): boolean {
    if (!/^[A-Za-z0-9_-]{43}$/u.test(token)) return false;
    const passwordHash = hashPassword(password);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const row = this.db
        .prepare(
          "SELECT owner_id FROM auth_password_resets WHERE token_hash=? AND consumed_at IS NULL AND expires_at>?"
        )
        .get(tokenHash(token), new Date(this.now()).toISOString()) as Row | undefined;
      if (!row) {
        this.db.exec("ROLLBACK");
        return false;
      }
      const ownerId = String(row.owner_id);
      const at = new Date(this.now()).toISOString();
      this.db
        .prepare(
          "UPDATE auth_accounts SET password_hash=?,updated_at=? WHERE owner_id=? AND verified_at IS NOT NULL"
        )
        .run(passwordHash, at, ownerId);
      this.db
        .prepare("UPDATE auth_password_resets SET consumed_at=? WHERE token_hash=?")
        .run(at, tokenHash(token));
      revoke(ownerId);
      this.db.exec("COMMIT");
      return true;
    } catch (cause) {
      this.db.exec("ROLLBACK");
      throw cause;
    }
  }

  changePassword(
    ownerId: string,
    currentPassword: string,
    newPassword: string,
    revoke: (ownerId: string) => void
  ): boolean {
    const passwordHash = hashPassword(newPassword);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const row = this.db
        .prepare(
          "SELECT password_hash FROM auth_accounts WHERE owner_id=? AND verified_at IS NOT NULL"
        )
        .get(ownerId) as Row | undefined;
      if (
        typeof row?.password_hash !== "string" ||
        !verifyPassword(currentPassword, row.password_hash)
      ) {
        this.db.exec("ROLLBACK");
        return false;
      }
      this.db
        .prepare("UPDATE auth_accounts SET password_hash=?,updated_at=? WHERE owner_id=?")
        .run(passwordHash, new Date(this.now()).toISOString(), ownerId);
      this.db.prepare("DELETE FROM auth_password_resets WHERE owner_id=?").run(ownerId);
      revoke(ownerId);
      this.db.exec("COMMIT");
      return true;
    } catch (cause) {
      this.db.exec("ROLLBACK");
      throw cause;
    }
  }

  removeMethod(
    ownerId: string,
    method: "email" | "google",
    password: string,
    revoke: (ownerId: string) => void
  ): boolean {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const row = this.db
        .prepare(
          "SELECT password_hash,google_sub FROM auth_accounts WHERE owner_id=? AND verified_at IS NOT NULL"
        )
        .get(ownerId) as Row | undefined;
      if (
        typeof row?.password_hash !== "string" ||
        !row.google_sub ||
        !verifyPassword(password, row.password_hash)
      ) {
        this.db.exec("ROLLBACK");
        return false;
      }
      const column = method === "email" ? "password_hash" : "google_sub";
      this.db
        .prepare(`UPDATE auth_accounts SET ${column}=NULL,updated_at=? WHERE owner_id=?`)
        .run(new Date(this.now()).toISOString(), ownerId);
      this.db.prepare("DELETE FROM auth_password_resets WHERE owner_id=?").run(ownerId);
      revoke(ownerId);
      this.db.exec("COMMIT");
      return true;
    } catch (cause) {
      this.db.exec("ROLLBACK");
      throw cause;
    }
  }
}
