import { DatabaseSync } from "node:sqlite";

export interface LeaseAcquisitionResult {
  granted: boolean;
  resourceKey: string;
  holderId: string;
  fencingToken: number;
  expiresAtMs: number;
}

/**
 * Kleppmann-Style Distributed Lock Manager with Monotonic Fencing Tokens.
 * Prevents split-brain / zombie GC-paused workers from corrupting shared resources
 * by enforcing strictly increasing `fencing_token` numbers on every guarded write.
 */
export class FencingTokenLeaseManager {
  private readonly sqlite: DatabaseSync;
  private monotonicTokenSeq = 0;

  constructor(sqlite: DatabaseSync) {
    this.sqlite = sqlite;
    this.ensureTables();
  }

  private ensureTables(): void {
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS kosmora_fencing_leases (
        resource_key TEXT PRIMARY KEY NOT NULL,
        holder_id TEXT NOT NULL,
        fencing_token INTEGER NOT NULL,
        expires_at_ms INTEGER NOT NULL,
        last_verified_token INTEGER NOT NULL DEFAULT 0
      );
    `);
  }

  public acquireOrRenewLease(params: {
    resourceKey: string;
    holderId: string;
    ttlMs: number;
    nowMs: number;
  }): LeaseAcquisitionResult {
    const existing = this.sqlite
      .prepare(
        `SELECT holder_id, fencing_token, expires_at_ms, last_verified_token
         FROM kosmora_fencing_leases WHERE resource_key = ?`
      )
      .get(params.resourceKey) as
      | {
          holder_id: string;
          fencing_token: number;
          expires_at_ms: number;
          last_verified_token: number;
        }
      | undefined;

    if (
      existing &&
      existing.holder_id !== params.holderId &&
      existing.expires_at_ms > params.nowMs
    ) {
      return {
        granted: false,
        resourceKey: params.resourceKey,
        holderId: existing.holder_id,
        fencingToken: existing.fencing_token,
        expiresAtMs: existing.expires_at_ms
      };
    }

    const nextToken = Math.max(
      ++this.monotonicTokenSeq,
      (existing?.fencing_token ?? 0) + 1
    );
    this.monotonicTokenSeq = nextToken;
    const expiresAtMs = params.nowMs + Math.max(100, params.ttlMs);

    this.sqlite
      .prepare(
        `INSERT INTO kosmora_fencing_leases
          (resource_key, holder_id, fencing_token, expires_at_ms, last_verified_token)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(resource_key) DO UPDATE SET
          holder_id = excluded.holder_id,
          fencing_token = excluded.fencing_token,
          expires_at_ms = excluded.expires_at_ms`
      )
      .run(
        params.resourceKey,
        params.holderId,
        nextToken,
        expiresAtMs,
        existing?.last_verified_token ?? 0
      );

    return {
      granted: true,
      resourceKey: params.resourceKey,
      holderId: params.holderId,
      fencingToken: nextToken,
      expiresAtMs
    };
  }

  /**
   * Storage-side Fencing Guard: accepts a write ONLY if `presentedFencingToken >= lease.fencing_token`
   * and `presentedFencingToken >= lease.last_verified_token`. Rejects stale tokens from zombie workers!
   */
  public verifyFencedWrite(resourceKey: string, presentedFencingToken: number): void {
    const row = this.sqlite
      .prepare(
        `SELECT fencing_token, last_verified_token
         FROM kosmora_fencing_leases WHERE resource_key = ?`
      )
      .get(resourceKey) as
      | { fencing_token: number; last_verified_token: number }
      | undefined;

    if (!row) {
      throw new Error(`NO_ACTIVE_LEASE: ${resourceKey}`);
    }

    const minAllowed = Math.max(row.fencing_token, row.last_verified_token);
    if (presentedFencingToken < minAllowed) {
      throw new Error(
        `STALE_FENCING_TOKEN_REJECTED: presented token ${presentedFencingToken} < active token ${minAllowed}`
      );
    }

    this.sqlite
      .prepare(
        `UPDATE kosmora_fencing_leases SET last_verified_token = ? WHERE resource_key = ?`
      )
      .run(presentedFencingToken, resourceKey);
  }
}
