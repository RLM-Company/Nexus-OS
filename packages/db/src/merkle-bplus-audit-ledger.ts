import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

export interface AuditLedgerEntry {
  sequenceNumber: number;
  actorId: string;
  actionType: string;
  payloadJson: string;
  previousHash: string;
  entryHash: string;
  createdAtIso: string;
}

export interface LedgerIntegrityReport {
  valid: boolean;
  totalEntriesVerified: number;
  tamperedSequenceNumber: number | null;
  merkleRootHash: string;
}

/**
 * Append-Only Cryptographic Hash-Chained & Merkle-Rooted Tamper-Evident Audit Ledger.
 * Detects any unauthorized modification, deletion, or reordering of historical audit rows in SQLite.
 */
export class TamperEvidentAuditLedger {
  private readonly sqlite: DatabaseSync;
  private readonly ledgerNamespace: string;

  constructor(sqlite: DatabaseSync, ledgerNamespace = "default_audit") {
    this.sqlite = sqlite;
    this.ledgerNamespace = ledgerNamespace;
    this.ensureTable();
  }

  private ensureTable(): void {
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS kosmora_tamper_evident_ledger (
        ledger_namespace TEXT NOT NULL,
        seq_no INTEGER NOT NULL,
        actor_id TEXT NOT NULL,
        action_type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        previous_hash TEXT NOT NULL,
        entry_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (ledger_namespace, seq_no)
      );
    `);
  }

  public static computeEntryHash(params: {
    ledgerNamespace: string;
    sequenceNumber: number;
    actorId: string;
    actionType: string;
    payloadJson: string;
    previousHash: string;
  }): string {
    return createHash("sha256")
      .update(
        `${params.ledgerNamespace}|${params.sequenceNumber}|${params.previousHash}|${params.actorId}|${params.actionType}|${params.payloadJson}`,
        "utf8"
      )
      .digest("hex");
  }

  public static computeMerkleRoot(hashes: string[]): string {
    if (hashes.length === 0) {
      return createHash("sha256").update("EMPTY_MERKLE_LEDGER", "utf8").digest("hex");
    }
    let layer = [...hashes];
    while (layer.length > 1) {
      const next: string[] = [];
      for (let i = 0; i < layer.length; i += 2) {
        const left = layer[i]!;
        const right = layer[i + 1] ?? left;
        next.push(
          createHash("sha256").update(`${left}:${right}`, "utf8").digest("hex")
        );
      }
      layer = next;
    }
    return layer[0]!;
  }

  public appendAuditEntry(params: {
    actorId: string;
    actionType: string;
    payload: Record<string, unknown>;
  }): AuditLedgerEntry {
    const lastRow = this.sqlite
      .prepare(
        `SELECT seq_no, entry_hash
         FROM kosmora_tamper_evident_ledger
         WHERE ledger_namespace = ?
         ORDER BY seq_no DESC LIMIT 1`
      )
      .get(this.ledgerNamespace) as { seq_no: number; entry_hash: string } | undefined;

    const sequenceNumber = (lastRow?.seq_no ?? 0) + 1;
    const previousHash = lastRow?.entry_hash ?? "0".repeat(64);
    const payloadJson = JSON.stringify(params.payload);
    const createdAtIso = new Date().toISOString();

    const entryHash = TamperEvidentAuditLedger.computeEntryHash({
      ledgerNamespace: this.ledgerNamespace,
      sequenceNumber,
      actorId: params.actorId,
      actionType: params.actionType,
      payloadJson,
      previousHash
    });

    this.sqlite
      .prepare(
        `INSERT INTO kosmora_tamper_evident_ledger
          (ledger_namespace, seq_no, actor_id, action_type, payload_json, previous_hash, entry_hash, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        this.ledgerNamespace,
        sequenceNumber,
        params.actorId,
        params.actionType,
        payloadJson,
        previousHash,
        entryHash,
        createdAtIso
      );

    return {
      sequenceNumber,
      actorId: params.actorId,
      actionType: params.actionType,
      payloadJson,
      previousHash,
      entryHash,
      createdAtIso
    };
  }

  public verifyLedgerIntegrity(): LedgerIntegrityReport {
    const rows = this.sqlite
      .prepare(
        `SELECT seq_no, actor_id, action_type, payload_json, previous_hash, entry_hash
         FROM kosmora_tamper_evident_ledger
         WHERE ledger_namespace = ?
         ORDER BY seq_no ASC`
      )
      .all(this.ledgerNamespace) as Array<{
      seq_no: number;
      actor_id: string;
      action_type: string;
      payload_json: string;
      previous_hash: string;
      entry_hash: string;
    }>;

    let expectedPrevHash = "0".repeat(64);
    const entryHashes: string[] = [];

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]!;
      const expectedSeq = i + 1;
      const recomputed = TamperEvidentAuditLedger.computeEntryHash({
        ledgerNamespace: this.ledgerNamespace,
        sequenceNumber: r.seq_no,
        actorId: r.actor_id,
        actionType: r.action_type,
        payloadJson: r.payload_json,
        previousHash: r.previous_hash
      });

      if (
        r.seq_no !== expectedSeq ||
        r.previous_hash !== expectedPrevHash ||
        r.entry_hash !== recomputed
      ) {
        return {
          valid: false,
          totalEntriesVerified: i,
          tamperedSequenceNumber: r.seq_no,
          merkleRootHash: TamperEvidentAuditLedger.computeMerkleRoot(entryHashes)
        };
      }

      expectedPrevHash = r.entry_hash;
      entryHashes.push(r.entry_hash);
    }

    return {
      valid: true,
      totalEntriesVerified: rows.length,
      tamperedSequenceNumber: null,
      merkleRootHash: TamperEvidentAuditLedger.computeMerkleRoot(entryHashes)
    };
  }
}
