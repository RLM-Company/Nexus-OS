import { DatabaseSync } from "node:sqlite";

export interface MvccTupleRecord<TValue = Record<string, unknown>> {
  key: string;
  value: TValue;
  xminTxId: number;
  xmaxTxId: number | null;
}

/**
 * Multi-Version Concurrency Control (MVCC) Snapshot-Isolated B+Tree Range Index Store.
 * Stores versioned tuples with `[xmin_tx, xmax_tx)` visibility intervals so readers at any
 * historical or active `snapshotTxId` see a consistent point-in-time view without locking writers.
 */
export class BPlusTreeMvccIndexEngine<TValue = Record<string, unknown>> {
  private readonly sqlite: DatabaseSync;
  private readonly indexName: string;
  private txCounter = 0;

  constructor(sqlite: DatabaseSync, indexName = "default_bptree") {
    this.sqlite = sqlite;
    this.indexName = indexName;
    this.ensureTable();
  }

  private ensureTable(): void {
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS kosmora_mvcc_bptree_records (
        index_name TEXT NOT NULL,
        record_key TEXT NOT NULL,
        xmin_tx INTEGER NOT NULL,
        xmax_tx INTEGER,
        value_json TEXT NOT NULL,
        PRIMARY KEY (index_name, record_key, xmin_tx)
      );
      CREATE INDEX IF NOT EXISTS idx_kosmora_mvcc_bptree_range
        ON kosmora_mvcc_bptree_records (index_name, record_key, xmin_tx, xmax_tx);
    `);
  }

  public beginTransaction(): number {
    return ++this.txCounter;
  }

  public upsertKey(txId: number, key: string, value: TValue): void {
    if (txId > this.txCounter) {
      this.txCounter = txId;
    }

    // Mark any currently live version (xmax_tx IS NULL) for this key as expired at txId
    this.sqlite
      .prepare(
        `UPDATE kosmora_mvcc_bptree_records
         SET xmax_tx = ?
         WHERE index_name = ? AND record_key = ? AND xmax_tx IS NULL AND xmin_tx < ?`
      )
      .run(txId, this.indexName, key, txId);

    this.sqlite
      .prepare(
        `INSERT INTO kosmora_mvcc_bptree_records
          (index_name, record_key, xmin_tx, xmax_tx, value_json)
         VALUES (?, ?, ?, NULL, ?)
         ON CONFLICT(index_name, record_key, xmin_tx) DO UPDATE SET
          value_json = excluded.value_json,
          xmax_tx = NULL`
      )
      .run(this.indexName, key, txId, JSON.stringify(value));
  }

  public deleteKey(txId: number, key: string): number {
    if (txId > this.txCounter) {
      this.txCounter = txId;
    }
    const res = this.sqlite
      .prepare(
        `UPDATE kosmora_mvcc_bptree_records
         SET xmax_tx = ?
         WHERE index_name = ? AND record_key = ? AND xmax_tx IS NULL AND xmin_tx <= ?`
      )
      .run(txId, this.indexName, key, txId);
    return Number(res.changes ?? 0);
  }

  /**
   * Snapshot-isolated B+Tree range scan over `[startKey, endKey]` visible at `snapshotTxId`:
   * A tuple is visible iff `xmin_tx <= snapshotTxId AND (xmax_tx IS NULL OR xmax_tx > snapshotTxId)`.
   */
  public scanRangeAtSnapshot(params: {
    startKey: string;
    endKey: string;
    snapshotTxId: number;
  }): MvccTupleRecord<TValue>[] {
    const rows = this.sqlite
      .prepare(
        `SELECT record_key, xmin_tx, xmax_tx, value_json
         FROM kosmora_mvcc_bptree_records
         WHERE index_name = ?
           AND record_key >= ?
           AND record_key <= ?
           AND xmin_tx <= ?
           AND (xmax_tx IS NULL OR xmax_tx > ?)
         ORDER BY record_key ASC, xmin_tx DESC`
      )
      .all(
        this.indexName,
        params.startKey,
        params.endKey,
        params.snapshotTxId,
        params.snapshotTxId
      ) as Array<{
      record_key: string;
      xmin_tx: number;
      xmax_tx: number | null;
      value_json: string;
    }>;

    return rows.map((r) => ({
      key: r.record_key,
      value: JSON.parse(r.value_json) as TValue,
      xminTxId: r.xmin_tx,
      xmaxTxId: r.xmax_tx
    }));
  }

  /**
   * Vacuum garbage collection: purges dead tuple versions whose `xmax_tx <= oldestActiveTxId`.
   */
  public vacuumObsoleteVersions(oldestActiveTxId: number): number {
    const res = this.sqlite
      .prepare(
        `DELETE FROM kosmora_mvcc_bptree_records
         WHERE index_name = ? AND xmax_tx IS NOT NULL AND xmax_tx <= ?`
      )
      .run(this.indexName, oldestActiveTxId);
    return Number(res.changes ?? 0);
  }
}
