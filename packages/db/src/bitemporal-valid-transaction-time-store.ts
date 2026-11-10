import { DatabaseSync } from "node:sqlite";

export interface BitemporalFactRecord {
  entityKey: string;
  payloadValue: string;
  validFromMs: number;
  validToMs: number;
  txRecordedAtMs: number;
  txSupersededAtMs: number;
}

/**
 * Richard Snodgrass SQL:2011 Bitemporal Valid-Time & Transaction-Time Store backed by SQLite.
 * Maintains two orthogonal temporal dimensions for every fact:
 * 1. Valid Time [valid_from_ms, valid_to_ms): when the fact was true in the real domain.
 * 2. Transaction Time [tx_recorded_at_ms, tx_superseded_at_ms): when the database believed the fact.
 * Supports non-destructive retroactive corrections and exact `queryAsOf(validTime, transactionTime)`.
 */
export class BitemporalValidAndTransactionTimeStore {
  public static readonly INFINITY_MS = 9_000_000_000_000_000;
  private readonly db: DatabaseSync;

  public constructor(db: DatabaseSync) {
    this.db = db;
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS kosmora_bitemporal_facts (
        fact_row_id INTEGER PRIMARY KEY AUTOINCREMENT,
        entity_key TEXT NOT NULL,
        payload_value TEXT NOT NULL,
        valid_from_ms INTEGER NOT NULL,
        valid_to_ms INTEGER NOT NULL,
        tx_recorded_at_ms INTEGER NOT NULL,
        tx_superseded_at_ms INTEGER NOT NULL
      );
    `);
  }

  public upsertValidPeriod(params: {
    entityKey: string;
    payloadValue: string;
    validFromMs: number;
    validToMs?: number;
    txNowMs: number;
  }): void {
    const inf = BitemporalValidAndTransactionTimeStore.INFINITY_MS;
    const validTo = params.validToMs ?? inf;

    // Find all currently active rows (tx_superseded_at_ms = INF) for entityKey that overlap [validFromMs, validTo)
    const overlapping = this.db
      .prepare(
        `SELECT fact_row_id, payload_value, valid_from_ms, valid_to_ms, tx_recorded_at_ms
         FROM kosmora_bitemporal_facts
         WHERE entity_key = ?
           AND tx_superseded_at_ms = ?
           AND valid_from_ms < ?
           AND valid_to_ms > ?`
      )
      .all(params.entityKey, inf, validTo, params.validFromMs) as Array<{
      fact_row_id: number;
      payload_value: string;
      valid_from_ms: number;
      valid_to_ms: number;
      tx_recorded_at_ms: number;
    }>;

    const supersedeStmt = this.db.prepare(
      `UPDATE kosmora_bitemporal_facts SET tx_superseded_at_ms = ? WHERE fact_row_id = ?`
    );
    const insertStmt = this.db.prepare(
      `INSERT INTO kosmora_bitemporal_facts
       (entity_key, payload_value, valid_from_ms, valid_to_ms, tx_recorded_at_ms, tx_superseded_at_ms)
       VALUES (?, ?, ?, ?, ?, ?)`
    );

    for (const row of overlapping) {
      supersedeStmt.run(params.txNowMs, row.fact_row_id);
      // Preserve non-overlapping left slice [row.valid_from_ms, params.validFromMs)
      if (row.valid_from_ms < params.validFromMs) {
        insertStmt.run(
          params.entityKey,
          row.payload_value,
          row.valid_from_ms,
          params.validFromMs,
          params.txNowMs,
          inf
        );
      }
      // Preserve non-overlapping right slice [validTo, row.valid_to_ms)
      if (row.valid_to_ms > validTo) {
        insertStmt.run(
          params.entityKey,
          row.payload_value,
          validTo,
          row.valid_to_ms,
          params.txNowMs,
          inf
        );
      }
    }

    insertStmt.run(
      params.entityKey,
      params.payloadValue,
      params.validFromMs,
      validTo,
      params.txNowMs,
      inf
    );
  }

  public queryAsOf(
    entityKey: string,
    validTimeMs: number,
    transactionTimeMs: number
  ): BitemporalFactRecord | null {
    const row = this.db
      .prepare(
        `SELECT entity_key, payload_value, valid_from_ms, valid_to_ms, tx_recorded_at_ms, tx_superseded_at_ms
         FROM kosmora_bitemporal_facts
         WHERE entity_key = ?
           AND valid_from_ms <= ? AND valid_to_ms > ?
           AND tx_recorded_at_ms <= ? AND tx_superseded_at_ms > ?
         ORDER BY fact_row_id DESC
         LIMIT 1`
      )
      .get(entityKey, validTimeMs, validTimeMs, transactionTimeMs, transactionTimeMs) as
      | {
          entity_key: string;
          payload_value: string;
          valid_from_ms: number;
          valid_to_ms: number;
          tx_recorded_at_ms: number;
          tx_superseded_at_ms: number;
        }
      | undefined;

    if (!row) return null;
    return {
      entityKey: row.entity_key,
      payloadValue: row.payload_value,
      validFromMs: row.valid_from_ms,
      validToMs: row.valid_to_ms,
      txRecordedAtMs: row.tx_recorded_at_ms,
      txSupersededAtMs: row.tx_superseded_at_ms
    };
  }
}
