import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { IdentityContext, StepUpProof, StepUpPurpose } from "@cosmora/contracts";

type SqlRow = Record<string, unknown>;

export interface StepUpProofStoreOptions {
  now?: () => number;
  tokenBytes?: number;
}

export interface IssueStepUpProofInput {
  identity: IdentityContext;
  purpose: StepUpPurpose;
  challenge: string;
  ttlMs: number;
}

export interface ConsumeStepUpProofInput {
  token: string;
  identity: IdentityContext;
  purpose: StepUpPurpose;
  challenge: string;
}

export interface IssuedStepUpProof {
  token: string;
  proof: StepUpProof;
}

export class StepUpProofConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StepUpProofConflictError";
  }
}

const MIN_PROOF_TTL_MS = 30_000;
const MAX_PROOF_TTL_MS = 10 * 60_000;
const DEFAULT_TOKEN_BYTES = 32;

export const hashStepUpProofToken = (token: string): string =>
  createHash("sha256").update(token, "utf8").digest("hex");

export const hashStepUpChallenge = (challenge: string): string =>
  createHash("sha256").update(challenge, "utf8").digest("hex");

const nullableText = (value: unknown): string | null => (typeof value === "string" ? value : null);

const asProof = (row: SqlRow): StepUpProof => ({
  proof_id: String(row.proof_id),
  owner_id: String(row.owner_id),
  actor_id: String(row.actor_id),
  session_id: String(row.session_id),
  purpose: row.purpose as StepUpPurpose,
  challenge_hash: String(row.challenge_hash),
  status: row.status as StepUpProof["status"],
  issued_at: String(row.issued_at),
  expires_at: String(row.expires_at),
  consumed_at: nullableText(row.consumed_at)
});

export class StepUpProofStore {
  readonly #sqlite: DatabaseSync;
  readonly #now: () => number;
  readonly #tokenBytes: number;

  constructor(sqlite: DatabaseSync, options: StepUpProofStoreOptions = {}) {
    this.#sqlite = sqlite;
    this.#now = options.now ?? Date.now;
    this.#tokenBytes = options.tokenBytes ?? DEFAULT_TOKEN_BYTES;
    if (!Number.isInteger(this.#tokenBytes) || this.#tokenBytes < 32) {
      throw new Error("Step-up proof tokens require at least 32 random bytes");
    }
  }

  issueProof(input: IssueStepUpProofInput): IssuedStepUpProof {
    this.#validateBinding(input.challenge, input.ttlMs);
    const nowMs = this.#nowMs();
    const session = this.#sqlite
      .prepare(
        `SELECT s.expires_at, s.status AS session_status, a.status AS actor_status
         FROM identity_sessions s
         JOIN identity_actors a ON a.actor_id = s.actor_id
         WHERE s.session_id = ? AND s.owner_id = ? AND s.actor_id = ?`
      )
      .get(input.identity.session_id, input.identity.owner_id, input.identity.actor_id) as
      SqlRow | undefined;
    if (
      !session ||
      session.session_status !== "active" ||
      session.actor_status !== "active" ||
      Date.parse(String(session.expires_at)) <= nowMs
    ) {
      throw new StepUpProofConflictError("Cannot issue proof for an inactive identity session");
    }

    const issuedAt = new Date(nowMs).toISOString();
    const expiresAt = new Date(
      Math.min(nowMs + input.ttlMs, Date.parse(String(session.expires_at)))
    ).toISOString();
    const proofId = randomUUID();
    const token = `cosmora_stepup_${randomBytes(this.#tokenBytes).toString("base64url")}`;
    const tokenHash = hashStepUpProofToken(token);
    const challengeHash = hashStepUpChallenge(input.challenge);

    this.#sqlite.exec("BEGIN IMMEDIATE;");
    try {
      this.#sqlite
        .prepare(
          `INSERT INTO step_up_proofs
            (proof_id, owner_id, actor_id, session_id, token_hash, purpose, challenge_hash, status,
             issued_at, expires_at, consumed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, NULL)`
        )
        .run(
          proofId,
          input.identity.owner_id,
          input.identity.actor_id,
          input.identity.session_id,
          tokenHash,
          input.purpose,
          challengeHash,
          issuedAt,
          expiresAt
        );
      this.#recordAudit(input.identity, "step_up.issued", "success", "STEP_UP_ISSUED", issuedAt);
      this.#sqlite.exec("COMMIT;");
    } catch (error) {
      this.#sqlite.exec("ROLLBACK;");
      throw error;
    }

    return {
      token,
      proof: this.getProof(proofId, input.identity.owner_id) as StepUpProof
    };
  }

  consumeProof(input: ConsumeStepUpProofInput): boolean {
    const nowMs = this.#nowMs();
    const timestamp = new Date(nowMs).toISOString();
    if (
      !/^cosmora_stepup_[A-Za-z0-9_-]{43,}$/.test(input.token) ||
      input.challenge.length === 0 ||
      input.challenge.length > 512
    ) {
      this.#recordAudit(input.identity, "step_up.rejected", "denied", "STEP_UP_INVALID", timestamp);
      return false;
    }

    const tokenHash = hashStepUpProofToken(input.token);
    const row = this.#sqlite
      .prepare(
        `SELECT proof_id, owner_id, actor_id, session_id, purpose, challenge_hash, status,
          issued_at, expires_at, consumed_at
         FROM step_up_proofs WHERE token_hash = ?`
      )
      .get(tokenHash) as SqlRow | undefined;
    if (!row) {
      this.#recordAudit(input.identity, "step_up.rejected", "denied", "STEP_UP_UNKNOWN", timestamp);
      return false;
    }

    const proof = asProof(row);
    const bindingMatches =
      proof.owner_id === input.identity.owner_id &&
      proof.actor_id === input.identity.actor_id &&
      proof.session_id === input.identity.session_id &&
      proof.purpose === input.purpose &&
      proof.challenge_hash === hashStepUpChallenge(input.challenge);
    if (!bindingMatches || proof.status !== "active") {
      this.#recordAudit(
        input.identity,
        "step_up.rejected",
        "denied",
        bindingMatches ? "STEP_UP_REPLAYED" : "STEP_UP_BINDING_MISMATCH",
        timestamp
      );
      return false;
    }

    if (Date.parse(proof.expires_at) <= nowMs) {
      this.#sqlite
        .prepare(
          "UPDATE step_up_proofs SET status = 'expired' WHERE proof_id = ? AND status = 'active'"
        )
        .run(proof.proof_id);
      this.#recordAudit(input.identity, "step_up.rejected", "denied", "STEP_UP_EXPIRED", timestamp);
      return false;
    }

    const activeIdentity = this.#sqlite
      .prepare(
        `SELECT 1 AS ok
         FROM identity_sessions s
         JOIN identity_actors a ON a.actor_id = s.actor_id
         WHERE s.session_id = ? AND s.owner_id = ? AND s.actor_id = ?
           AND s.status = 'active' AND a.status = 'active' AND s.expires_at > ?`
      )
      .get(input.identity.session_id, input.identity.owner_id, input.identity.actor_id, timestamp);
    if (!activeIdentity) {
      this.#recordAudit(
        input.identity,
        "step_up.rejected",
        "denied",
        "STEP_UP_SESSION_INVALID",
        timestamp
      );
      return false;
    }

    this.#sqlite.exec("BEGIN IMMEDIATE;");
    try {
      const result = this.#sqlite
        .prepare(
          `UPDATE step_up_proofs SET status = 'consumed', consumed_at = ?
           WHERE proof_id = ? AND status = 'active'`
        )
        .run(timestamp, proof.proof_id);
      if (Number(result.changes) !== 1) {
        this.#recordAudit(
          input.identity,
          "step_up.rejected",
          "denied",
          "STEP_UP_REPLAYED",
          timestamp
        );
        this.#sqlite.exec("COMMIT;");
        return false;
      }
      this.#recordAudit(
        input.identity,
        "step_up.consumed",
        "success",
        "STEP_UP_CONSUMED",
        timestamp
      );
      this.#sqlite.exec("COMMIT;");
      return true;
    } catch (error) {
      this.#sqlite.exec("ROLLBACK;");
      throw error;
    }
  }

  getProof(proofId: string, ownerId: string): StepUpProof | null {
    const row = this.#sqlite
      .prepare(
        `SELECT proof_id, owner_id, actor_id, session_id, purpose, challenge_hash, status,
          issued_at, expires_at, consumed_at
         FROM step_up_proofs WHERE proof_id = ? AND owner_id = ?`
      )
      .get(proofId, ownerId) as SqlRow | undefined;
    return row ? asProof(row) : null;
  }

  #validateBinding(challenge: string, ttlMs: number): void {
    if (challenge.length === 0 || challenge.length > 512) {
      throw new Error("Step-up challenge length is outside the allowed range");
    }
    if (!Number.isFinite(ttlMs) || ttlMs < MIN_PROOF_TTL_MS || ttlMs > MAX_PROOF_TTL_MS) {
      throw new Error("Step-up proof TTL is outside the allowed range");
    }
  }

  #recordAudit(
    identity: IdentityContext,
    eventType: "step_up.issued" | "step_up.consumed" | "step_up.rejected",
    outcome: "success" | "denied",
    reasonCode: string,
    timestamp: string
  ): void {
    this.#sqlite
      .prepare(
        `INSERT INTO identity_audit_events
          (event_id, owner_id, actor_id, session_id, event_type, outcome, reason_code, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        randomUUID(),
        identity.owner_id,
        identity.actor_id,
        identity.session_id,
        eventType,
        outcome,
        reasonCode,
        timestamp
      );
  }

  #nowMs(): number {
    const value = this.#now();
    if (!Number.isFinite(value)) throw new Error("Invalid StepUpProofStore clock");
    return value;
  }
}
