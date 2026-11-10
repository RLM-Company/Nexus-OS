import { DatabaseSync } from "node:sqlite";

export type WalRecordType = "BEGIN" | "UPDATE" | "COMMIT" | "ABORT" | "CLR";

export interface AriesWalRecord {
  lsn: number;
  txId: string;
  type: WalRecordType;
  pageId?: string;
  beforeImage?: string;
  afterImage?: string;
  undoNextLsn?: number;
}

export interface AriesRecoveryReport {
  committedTransactions: string[];
  loserTransactionsRolledBack: string[];
  redoOperationsApplied: number;
  undoClrRecordsWritten: number;
  recoveredPageState: Record<string, string>;
}

/**
 * Mohan's ARIES (Algorithms for Recovery and Isolation Exploiting Semantics)
 * Three-Phase Write-Ahead Log Recovery Engine (Analysis Pass -> Redo Pass -> Undo Pass with CLRs).
 */
export class AriesWriteAheadRedoUndoRecoveryEngine {
  private readonly sqlite: DatabaseSync;
  private lsnCounter = 0;

  constructor(sqlite: DatabaseSync) {
    this.sqlite = sqlite;
    this.ensureTable();
  }

  private ensureTable(): void {
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS kosmora_aries_wal_records (
        lsn INTEGER PRIMARY KEY NOT NULL,
        tx_id TEXT NOT NULL,
        record_type TEXT NOT NULL,
        page_id TEXT,
        before_image TEXT,
        after_image TEXT,
        undo_next_lsn INTEGER
      );
    `);
  }

  public appendWalRecord(record: Omit<AriesWalRecord, "lsn">): AriesWalRecord {
    const lsn = ++this.lsnCounter;
    this.sqlite
      .prepare(
        `INSERT INTO kosmora_aries_wal_records
          (lsn, tx_id, record_type, page_id, before_image, after_image, undo_next_lsn)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        lsn,
        record.txId,
        record.type,
        record.pageId ?? null,
        record.beforeImage ?? null,
        record.afterImage ?? null,
        record.undoNextLsn ?? null
      );
    return { lsn, ...record };
  }

  public runCrashRecovery(): AriesRecoveryReport {
    const logRows = this.sqlite
      .prepare(
        `SELECT lsn, tx_id, record_type, page_id, before_image, after_image, undo_next_lsn
         FROM kosmora_aries_wal_records
         ORDER BY lsn ASC`
      )
      .all() as Array<{
      lsn: number;
      tx_id: string;
      record_type: WalRecordType;
      page_id: string | null;
      before_image: string | null;
      after_image: string | null;
      undo_next_lsn: number | null;
    }>;

    // PHASE 1: ANALYSIS PASS
    const activeLoserTxs = new Set<string>();
    const committedTxs = new Set<string>();

    for (const r of logRows) {
      if (r.record_type === "BEGIN" || r.record_type === "UPDATE") {
        if (!committedTxs.has(r.tx_id)) {
          activeLoserTxs.add(r.tx_id);
        }
      } else if (r.record_type === "COMMIT") {
        activeLoserTxs.delete(r.tx_id);
        committedTxs.add(r.tx_id);
      } else if (r.record_type === "ABORT") {
        activeLoserTxs.add(r.tx_id);
      }
    }

    // PHASE 2: REDO PASS (Repeat History forward across all UPDATE and CLR records)
    const recoveredPageState: Record<string, string> = {};
    let redoOperationsApplied = 0;

    for (const r of logRows) {
      if ((r.record_type === "UPDATE" || r.record_type === "CLR") && r.page_id && r.after_image !== null) {
        recoveredPageState[r.page_id] = r.after_image;
        redoOperationsApplied++;
      }
    }

    // PHASE 3: UNDO PASS (Roll back uncommitted loser transactions in reverse LSN order and emit CLRs)
    let undoClrRecordsWritten = 0;
    for (let i = logRows.length - 1; i >= 0; i--) {
      const r = logRows[i]!;
      if (activeLoserTxs.has(r.tx_id) && r.record_type === "UPDATE" && r.page_id && r.before_image !== null) {
        recoveredPageState[r.page_id] = r.before_image;
        this.appendWalRecord({
          txId: r.tx_id,
          type: "CLR",
          pageId: r.page_id,
          afterImage: r.before_image,
          undoNextLsn: r.lsn - 1
        });
        undoClrRecordsWritten++;
      }
    }

    return {
      committedTransactions: Array.from(committedTxs).sort(),
      loserTransactionsRolledBack: Array.from(activeLoserTxs).sort(),
      redoOperationsApplied,
      undoClrRecordsWritten,
      recoveredPageState
    };
  }
}
