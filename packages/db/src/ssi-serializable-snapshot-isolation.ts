import { DatabaseSync } from "node:sqlite";

export interface SsiCommitDecision {
  committed: boolean;
  txId: string;
  abortedAsDangerousPivot: boolean;
  errorCode: "OK" | "SQLSTATE_40001_SERIALIZATION_FAILURE";
}

/**
 * Cahill / Fekete (PostgreSQL-Style) Serializable Snapshot Isolation (SSI) Dependency Manager.
 * Tracks SIREAD locks, Write locks, and rw-antidependency edges (T_reader --rw--> T_writer).
 * Detects the SSI "Dangerous Structure" (T_in --rw--> T_pivot --rw--> T_out) and aborts the pivot
 * transaction with `SQLSTATE_40001_SERIALIZATION_FAILURE` to prevent Write Skew anomalies!
 */
export class CahillSerializableSnapshotIsolationManager {
  private readonly sqlite: DatabaseSync;
  private readonly sireadByResource = new Map<string, Set<string>>(); // resourceKey -> Set<txId>
  private readonly writesByResource = new Map<string, Set<string>>(); // resourceKey -> Set<txId>

  constructor(sqlite: DatabaseSync) {
    this.sqlite = sqlite;
    this.ensureTable();
  }

  private ensureTable(): void {
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS kosmora_ssi_rw_antidependencies (
        reader_tx_id TEXT NOT NULL,
        writer_tx_id TEXT NOT NULL,
        resource_key TEXT NOT NULL,
        PRIMARY KEY (reader_tx_id, writer_tx_id, resource_key)
      );
    `);
  }

  public recordRead(txId: string, resourceKey: string): void {
    if (!this.sireadByResource.has(resourceKey)) {
      this.sireadByResource.set(resourceKey, new Set());
    }
    this.sireadByResource.get(resourceKey)!.add(txId);

    // If another concurrent transaction already wrote to resourceKey, record rw-antidependency: txId --rw--> writer
    for (const writerTx of this.writesByResource.get(resourceKey) ?? []) {
      if (writerTx !== txId) {
        this.recordRwEdge(txId, writerTx, resourceKey);
      }
    }
  }

  public recordWrite(txId: string, resourceKey: string): void {
    if (!this.writesByResource.has(resourceKey)) {
      this.writesByResource.set(resourceKey, new Set());
    }
    this.writesByResource.get(resourceKey)!.add(txId);

    // For every concurrent transaction that read resourceKey, record rw-antidependency: reader --rw--> txId
    for (const readerTx of this.sireadByResource.get(resourceKey) ?? []) {
      if (readerTx !== txId) {
        this.recordRwEdge(readerTx, txId, resourceKey);
      }
    }
  }

  private recordRwEdge(readerTxId: string, writerTxId: string, resourceKey: string): void {
    this.sqlite
      .prepare(
        `INSERT OR IGNORE INTO kosmora_ssi_rw_antidependencies
          (reader_tx_id, writer_tx_id, resource_key)
         VALUES (?, ?, ?)`
      )
      .run(readerTxId, writerTxId, resourceKey);
  }

  /**
   * Attempts to commit `txId`. Under Cahill's SSI theorem, if `txId` is a pivot with both an incoming
   * rw-antidependency (`T_in --rw--> txId`) AND an outgoing rw-antidependency (`txId --rw--> T_out`),
   * a serialization anomaly (e.g., Write Skew) may occur, so `txId` is aborted with 40001!
   */
  public tryCommitTransaction(txId: string): SsiCommitDecision {
    const incomingRow = this.sqlite
      .prepare(
        `SELECT COUNT(*) AS cnt FROM kosmora_ssi_rw_antidependencies WHERE writer_tx_id = ?`
      )
      .get(txId) as { cnt: number };

    const outgoingRow = this.sqlite
      .prepare(
        `SELECT COUNT(*) AS cnt FROM kosmora_ssi_rw_antidependencies WHERE reader_tx_id = ?`
      )
      .get(txId) as { cnt: number };

    const hasIncomingRw = (incomingRow?.cnt ?? 0) > 0;
    const hasOutgoingRw = (outgoingRow?.cnt ?? 0) > 0;

    if (hasIncomingRw && hasOutgoingRw) {
      return {
        committed: false,
        txId,
        abortedAsDangerousPivot: true,
        errorCode: "SQLSTATE_40001_SERIALIZATION_FAILURE"
      };
    }

    return {
      committed: true,
      txId,
      abortedAsDangerousPivot: false,
      errorCode: "OK"
    };
  }
}
