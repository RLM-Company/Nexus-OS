import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type {
  ActorKind,
  AuthenticationAssurance,
  IdentityActor,
  IdentityAuditEvent,
  IdentityContext,
  IdentitySession
} from "@cosmora/contracts";

type SqlRow = Record<string, unknown>;

export interface IdentityStoreOptions {
  now?: () => number;
  tokenBytes?: number;
}

export interface IssueSessionInput {
  ownerId: string;
  actorId: string;
  assurance: AuthenticationAssurance;
  ttlMs: number;
}

export interface IssuedIdentitySession {
  token: string;
  session: IdentitySession;
}

export class IdentityStoreConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IdentityStoreConflictError";
  }
}

const MIN_SESSION_TTL_MS = 60_000;
const MAX_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
const DEFAULT_TOKEN_BYTES = 32;

const nullableText = (value: unknown): string | null => (typeof value === "string" ? value : null);

const asActor = (row: SqlRow): IdentityActor => ({
  actor_id: String(row.actor_id),
  owner_id: String(row.owner_id),
  kind: row.kind as ActorKind,
  status: row.status as IdentityActor["status"],
  created_at: String(row.created_at),
  updated_at: String(row.updated_at)
});

const asSession = (row: SqlRow): IdentitySession => ({
  session_id: String(row.session_id),
  owner_id: String(row.owner_id),
  actor_id: String(row.actor_id),
  assurance: row.assurance as AuthenticationAssurance,
  status: row.status as IdentitySession["status"],
  issued_at: String(row.issued_at),
  expires_at: String(row.expires_at),
  last_seen_at: String(row.last_seen_at),
  revoked_at: nullableText(row.revoked_at),
  revoked_by: nullableText(row.revoked_by),
  revoke_reason: nullableText(row.revoke_reason)
});

const asAuditEvent = (row: SqlRow): IdentityAuditEvent => ({
  event_id: String(row.event_id),
  owner_id: String(row.owner_id),
  actor_id: String(row.actor_id),
  session_id: nullableText(row.session_id),
  event_type: row.event_type as IdentityAuditEvent["event_type"],
  outcome: row.outcome as IdentityAuditEvent["outcome"],
  reason_code: nullableText(row.reason_code),
  created_at: String(row.created_at)
});

export const hashIdentitySessionToken = (token: string): string =>
  createHash("sha256").update(token, "utf8").digest("hex");

export class IdentityStore {
  readonly #sqlite: DatabaseSync;
  readonly #now: () => number;
  readonly #tokenBytes: number;

  constructor(sqlite: DatabaseSync, options: IdentityStoreOptions = {}) {
    this.#sqlite = sqlite;
    this.#now = options.now ?? Date.now;
    this.#tokenBytes = options.tokenBytes ?? DEFAULT_TOKEN_BYTES;
    if (!Number.isInteger(this.#tokenBytes) || this.#tokenBytes < 32) {
      throw new Error("Identity session tokens require at least 32 random bytes");
    }
  }

  registerActor(ownerId: string, actorId: string, kind: ActorKind): IdentityActor {
    const existing = this.#sqlite
      .prepare("SELECT owner_id FROM identity_actors WHERE actor_id = ?")
      .get(actorId) as { owner_id?: string } | undefined;
    if (existing && existing.owner_id !== ownerId) {
      throw new IdentityStoreConflictError("Actor id is already bound to another owner");
    }
    if (!existing) {
      const timestamp = this.#nowIso();
      this.#sqlite
        .prepare(
          `INSERT INTO identity_actors
            (actor_id, owner_id, kind, status, created_at, updated_at)
           VALUES (?, ?, ?, 'active', ?, ?)`
        )
        .run(actorId, ownerId, kind, timestamp, timestamp);
    }
    return this.getActor(actorId, ownerId) as IdentityActor;
  }

  getActor(actorId: string, ownerId: string): IdentityActor | null {
    const row = this.#sqlite
      .prepare(
        `SELECT actor_id, owner_id, kind, status, created_at, updated_at
         FROM identity_actors WHERE actor_id = ? AND owner_id = ?`
      )
      .get(actorId, ownerId) as SqlRow | undefined;
    return row ? asActor(row) : null;
  }

  issueSession(input: IssueSessionInput): IssuedIdentitySession {
    if (
      !Number.isFinite(input.ttlMs) ||
      input.ttlMs < MIN_SESSION_TTL_MS ||
      input.ttlMs > MAX_SESSION_TTL_MS
    ) {
      throw new Error("Identity session TTL is outside the allowed range");
    }
    const actor = this.getActor(input.actorId, input.ownerId);
    if (!actor || actor.status !== "active") {
      throw new IdentityStoreConflictError("Cannot issue a session for an inactive actor");
    }

    const issuedAtMs = this.#nowMs();
    const issuedAt = new Date(issuedAtMs).toISOString();
    const expiresAt = new Date(issuedAtMs + input.ttlMs).toISOString();
    const sessionId = randomUUID();
    const token = `cosmora_session_${randomBytes(this.#tokenBytes).toString("base64url")}`;
    const tokenHash = hashIdentitySessionToken(token);

    this.#sqlite.exec("BEGIN IMMEDIATE;");
    try {
      this.#sqlite
        .prepare(
          `INSERT INTO identity_sessions
            (session_id, owner_id, actor_id, token_hash, assurance, status, issued_at, expires_at,
             last_seen_at, revoked_at, revoked_by, revoke_reason)
           VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, NULL, NULL, NULL)`
        )
        .run(
          sessionId,
          input.ownerId,
          input.actorId,
          tokenHash,
          input.assurance,
          issuedAt,
          expiresAt,
          issuedAt
        );
      this.#recordAudit(
        input.ownerId,
        input.actorId,
        sessionId,
        "session.issued",
        "success",
        null,
        issuedAt
      );
      this.#sqlite.exec("COMMIT;");
    } catch (error) {
      this.#sqlite.exec("ROLLBACK;");
      throw error;
    }

    return {
      token,
      session: this.getSession(sessionId, input.ownerId) as IdentitySession
    };
  }

  resolveSession(token: string): IdentityContext | null {
    if (!/^cosmora_session_[A-Za-z0-9_-]{43,}$/.test(token)) return null;
    const row = this.#sqlite
      .prepare(
        `SELECT s.session_id, s.owner_id, s.actor_id, s.assurance, s.status, s.issued_at,
           s.expires_at, a.kind AS actor_kind, a.status AS actor_status
         FROM identity_sessions s
         JOIN identity_actors a ON a.actor_id = s.actor_id
         WHERE s.token_hash = ?`
      )
      .get(hashIdentitySessionToken(token)) as SqlRow | undefined;
    if (!row || row.status !== "active" || row.actor_status !== "active") return null;

    const nowMs = this.#nowMs();
    if (Date.parse(String(row.expires_at)) <= nowMs) {
      const timestamp = new Date(nowMs).toISOString();
      const result = this.#sqlite
        .prepare(
          `UPDATE identity_sessions SET status = 'expired'
           WHERE session_id = ? AND status = 'active'`
        )
        .run(String(row.session_id));
      if (Number(result.changes) === 1) {
        this.#recordAudit(
          String(row.owner_id),
          String(row.actor_id),
          String(row.session_id),
          "session.expired",
          "denied",
          "SESSION_EXPIRED",
          timestamp
        );
      }
      return null;
    }

    const lastSeenAt = new Date(nowMs).toISOString();
    this.#sqlite
      .prepare("UPDATE identity_sessions SET last_seen_at = ? WHERE session_id = ?")
      .run(lastSeenAt, String(row.session_id));
    return {
      owner_id: String(row.owner_id),
      actor_id: String(row.actor_id),
      actor_kind: row.actor_kind as ActorKind,
      session_id: String(row.session_id),
      assurance: row.assurance as AuthenticationAssurance,
      authenticated_at: String(row.issued_at),
      expires_at: String(row.expires_at)
    };
  }

  getSession(sessionId: string, ownerId: string): IdentitySession | null {
    const row = this.#sqlite
      .prepare(
        `SELECT session_id, owner_id, actor_id, assurance, status, issued_at, expires_at,
           last_seen_at, revoked_at, revoked_by, revoke_reason
         FROM identity_sessions WHERE session_id = ? AND owner_id = ?`
      )
      .get(sessionId, ownerId) as SqlRow | undefined;
    return row ? asSession(row) : null;
  }

  listSessions(ownerId: string): IdentitySession[] {
    const timestamp = this.#nowIso();
    const expired = this.#sqlite
      .prepare(
        `SELECT session_id, actor_id FROM identity_sessions
         WHERE owner_id = ? AND status = 'active' AND expires_at <= ?`
      )
      .all(ownerId, timestamp) as unknown as SqlRow[];

    if (expired.length > 0) {
      this.#sqlite.exec("BEGIN IMMEDIATE;");
      try {
        for (const session of expired) {
          const result = this.#sqlite
            .prepare(
              `UPDATE identity_sessions SET status = 'expired'
               WHERE session_id = ? AND owner_id = ? AND status = 'active'`
            )
            .run(String(session.session_id), ownerId);
          if (Number(result.changes) === 1) {
            this.#recordAudit(
              ownerId,
              String(session.actor_id),
              String(session.session_id),
              "session.expired",
              "denied",
              "SESSION_EXPIRED",
              timestamp
            );
          }
        }
        this.#sqlite.exec("COMMIT;");
      } catch (error) {
        this.#sqlite.exec("ROLLBACK;");
        throw error;
      }
    }

    const rows = this.#sqlite
      .prepare(
        `SELECT session_id, owner_id, actor_id, assurance, status, issued_at, expires_at,
           last_seen_at, revoked_at, revoked_by, revoke_reason
         FROM identity_sessions WHERE owner_id = ? ORDER BY issued_at DESC`
      )
      .all(ownerId) as unknown as SqlRow[];
    return rows.map(asSession);
  }

  revokeSession(sessionId: string, ownerId: string, revokedBy: string, reason: string): boolean {
    const session = this.getSession(sessionId, ownerId);
    if (!session || session.status !== "active") return false;
    const timestamp = this.#nowIso();
    this.#sqlite.exec("BEGIN IMMEDIATE;");
    try {
      const result = this.#sqlite
        .prepare(
          `UPDATE identity_sessions
           SET status = 'revoked', revoked_at = ?, revoked_by = ?, revoke_reason = ?
           WHERE session_id = ? AND owner_id = ? AND status = 'active'`
        )
        .run(timestamp, revokedBy, reason, sessionId, ownerId);
      if (Number(result.changes) !== 1) {
        this.#sqlite.exec("ROLLBACK;");
        return false;
      }
      this.#recordAudit(
        ownerId,
        revokedBy,
        sessionId,
        "session.revoked",
        "success",
        "OWNER_REVOKED",
        timestamp
      );
      this.#sqlite.exec("COMMIT;");
      return true;
    } catch (error) {
      this.#sqlite.exec("ROLLBACK;");
      throw error;
    }
  }

  revokeAllOwnerSessions(ownerId: string, revokedBy: string, reason: string): number {
    const timestamp = this.#nowIso();
    const result = this.#sqlite
      .prepare(
        `UPDATE identity_sessions
         SET status = 'revoked', revoked_at = ?, revoked_by = ?, revoke_reason = ?
         WHERE owner_id = ? AND status = 'active'`
      )
      .run(timestamp, revokedBy, reason, ownerId);
    const count = Number(result.changes);
    if (count > 0) {
      this.#recordAudit(
        ownerId,
        revokedBy,
        null,
        "session.revoked",
        "success",
        "OWNER_REVOKED_ALL",
        timestamp
      );
    }
    return count;
  }

  disableActor(actorId: string, ownerId: string, disabledBy: string, reason: string): boolean {
    const actor = this.getActor(actorId, ownerId);
    if (!actor || actor.status !== "active") return false;
    const timestamp = this.#nowIso();
    this.#sqlite.exec("BEGIN IMMEDIATE;");
    try {
      this.#sqlite
        .prepare(
          `UPDATE identity_actors SET status = 'disabled', updated_at = ?
           WHERE actor_id = ? AND owner_id = ? AND status = 'active'`
        )
        .run(timestamp, actorId, ownerId);
      this.#sqlite
        .prepare(
          `UPDATE identity_sessions
           SET status = 'revoked', revoked_at = ?, revoked_by = ?, revoke_reason = ?
           WHERE actor_id = ? AND owner_id = ? AND status = 'active'`
        )
        .run(timestamp, disabledBy, reason, actorId, ownerId);
      this.#recordAudit(
        ownerId,
        disabledBy,
        null,
        "actor.disabled",
        "success",
        "ACTOR_DISABLED",
        timestamp
      );
      this.#sqlite.exec("COMMIT;");
      return true;
    } catch (error) {
      this.#sqlite.exec("ROLLBACK;");
      throw error;
    }
  }

  listRecentAuditEvents(ownerId: string, limit: number): IdentityAuditEvent[] {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new Error("Identity audit limit must be an integer between 1 and 100");
    }
    const rows = this.#sqlite
      .prepare(
        `SELECT event_id, owner_id, actor_id, session_id, event_type, outcome, reason_code,
           created_at
         FROM identity_audit_events
         WHERE owner_id = ?
         ORDER BY created_at DESC, rowid DESC
         LIMIT ?`
      )
      .all(ownerId, limit) as unknown as SqlRow[];
    return rows.map(asAuditEvent);
  }

  listRecentOwnerSessionEvents(
    ownerId: string,
    actorId: string,
    limit: number
  ): IdentityAuditEvent[] {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new Error("Session audit limit must be between 1 and 100");
    const rows = this.#sqlite
      .prepare(
        `SELECT event_id, owner_id, actor_id, session_id, event_type, outcome, reason_code, created_at
       FROM identity_audit_events
       WHERE owner_id=? AND actor_id=? AND event_type IN ('session.issued','session.revoked','session.expired','login.failed')
       ORDER BY created_at DESC, rowid DESC LIMIT ?`
      )
      .all(ownerId, actorId, limit) as unknown as SqlRow[];
    return rows.map(asAuditEvent);
  }

  recordFailedOwnerEmailLogin(ownerId: string): void {
    if (this.getActor(ownerId, ownerId)?.status !== "active") return;
    const now = this.#nowMs();
    this.#sqlite
      .prepare(
        `INSERT INTO identity_audit_events
          (event_id, owner_id, actor_id, session_id, event_type, outcome, reason_code, created_at)
         SELECT ?, ?, ?, NULL, 'login.failed', 'denied', 'BAD_CREDENTIALS', ?
         WHERE NOT EXISTS (
           SELECT 1 FROM identity_audit_events
           WHERE owner_id=? AND actor_id=? AND event_type='login.failed' AND created_at>=?
         )`
      )
      .run(
        randomUUID(),
        ownerId,
        ownerId,
        new Date(now).toISOString(),
        ownerId,
        ownerId,
        new Date(now - 60_000).toISOString()
      );
  }

  listAuditEvents(ownerId: string): IdentityAuditEvent[] {
    const rows = this.#sqlite
      .prepare(
        `SELECT event_id, owner_id, actor_id, session_id, event_type, outcome, reason_code,
           created_at
         FROM identity_audit_events WHERE owner_id = ? ORDER BY created_at ASC, rowid ASC`
      )
      .all(ownerId) as unknown as SqlRow[];
    return rows.map(asAuditEvent);
  }

  #recordAudit(
    ownerId: string,
    actorId: string,
    sessionId: string | null,
    eventType: IdentityAuditEvent["event_type"],
    outcome: IdentityAuditEvent["outcome"],
    reasonCode: string | null,
    createdAt: string
  ): void {
    this.#sqlite
      .prepare(
        `INSERT INTO identity_audit_events
          (event_id, owner_id, actor_id, session_id, event_type, outcome, reason_code, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(randomUUID(), ownerId, actorId, sessionId, eventType, outcome, reasonCode, createdAt);
  }

  #nowMs(): number {
    const value = this.#now();
    if (!Number.isFinite(value)) throw new Error("Invalid IdentityStore clock");
    return value;
  }

  #nowIso(): string {
    return new Date(this.#nowMs()).toISOString();
  }
}
