import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

export interface IdempotencyExecutionOutcome<T> {
  status: "executed_fresh" | "replayed_cached" | "rejected_payload_mismatch" | "rejected_in_flight_conflict";
  httpStatusCode: 200 | 409 | 422;
  payloadFingerprintSha256: string;
  responseBody: T | null;
}

/**
 * Transactional IETF Idempotency-Key Deduplication & Response Replay Ledger backed by SQLite.
 * Enforces strict at-most-once execution semantics:
 * - Same key + same payload fingerprint => deterministic 200 OK replay
 * - Same key + mutated payload fingerprint => 422 Unprocessable Entity
 * - Same key currently leased in-flight => 409 Conflict
 */
export class TransactionalIdempotencyKeyLedger {
  private readonly db: DatabaseSync;

  public constructor(db: DatabaseSync) {
    this.db = db;
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS kosmora_idempotency_key_ledger (
        idempotency_key TEXT PRIMARY KEY,
        payload_sha256 TEXT NOT NULL,
        execution_state TEXT NOT NULL,
        response_json TEXT,
        created_at_ms INTEGER NOT NULL,
        updated_at_ms INTEGER NOT NULL
      );
    `);
  }

  public static computePayloadFingerprint(payload: unknown): string {
    return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  }

  public beginOrReplay<T>(
    idempotencyKey: string,
    requestPayload: unknown,
    nowMs: number = Date.now()
  ): {
    alreadyResolved: boolean;
    outcome?: IdempotencyExecutionOutcome<T>;
  } {
    const fingerprint = TransactionalIdempotencyKeyLedger.computePayloadFingerprint(requestPayload);
    const existing = this.db
      .prepare(
        `SELECT payload_sha256, execution_state, response_json
         FROM kosmora_idempotency_key_ledger
         WHERE idempotency_key = ?`
      )
      .get(idempotencyKey) as
      | { payload_sha256: string; execution_state: string; response_json: string | null }
      | undefined;

    if (existing) {
      if (existing.payload_sha256 !== fingerprint) {
        return {
          alreadyResolved: true,
          outcome: {
            status: "rejected_payload_mismatch",
            httpStatusCode: 422,
            payloadFingerprintSha256: fingerprint,
            responseBody: null
          }
        };
      }
      if (existing.execution_state === "IN_FLIGHT") {
        return {
          alreadyResolved: true,
          outcome: {
            status: "rejected_in_flight_conflict",
            httpStatusCode: 409,
            payloadFingerprintSha256: fingerprint,
            responseBody: null
          }
        };
      }
      return {
        alreadyResolved: true,
        outcome: {
          status: "replayed_cached",
          httpStatusCode: 200,
          payloadFingerprintSha256: fingerprint,
          responseBody: existing.response_json ? (JSON.parse(existing.response_json) as T) : null
        }
      };
    }

    this.db
      .prepare(
        `INSERT INTO kosmora_idempotency_key_ledger
         (idempotency_key, payload_sha256, execution_state, response_json, created_at_ms, updated_at_ms)
         VALUES (?, ?, 'IN_FLIGHT', NULL, ?, ?)`
      )
      .run(idempotencyKey, fingerprint, nowMs, nowMs);

    return { alreadyResolved: false };
  }

  public completeExecution<T>(
    idempotencyKey: string,
    responseBody: T,
    nowMs: number = Date.now()
  ): IdempotencyExecutionOutcome<T> {
    const row = this.db
      .prepare(`SELECT payload_sha256 FROM kosmora_idempotency_key_ledger WHERE idempotency_key = ?`)
      .get(idempotencyKey) as { payload_sha256: string } | undefined;

    if (!row) {
      throw new Error(`Unknown idempotency key '${idempotencyKey}'`);
    }

    this.db
      .prepare(
        `UPDATE kosmora_idempotency_key_ledger
         SET execution_state = 'COMPLETED', response_json = ?, updated_at_ms = ?
         WHERE idempotency_key = ?`
      )
      .run(JSON.stringify(responseBody), nowMs, idempotencyKey);

    return {
      status: "executed_fresh",
      httpStatusCode: 200,
      payloadFingerprintSha256: row.payload_sha256,
      responseBody
    };
  }
}
