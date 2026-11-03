/**
 * Kosmora / Nexus-OS Temporal Bitemporal Knowledge Graph & Time-Travel Query Engine (Wave 20)
 *
 * Tracks subject-predicate-object triples with bitemporal intervals:
 * - Valid Time (`valid_from`, `valid_to`): when the fact was true in the real world.
 * - Transaction Time (`recorded_at`, `superseded_at`): when the fact was stored/superseded in the system.
 *
 * Capabilities:
 * 1. Non-destructive temporal superseding: updating a fact's object closes the prior interval
 *    (`valid_to = effectiveAt`, `superseded_at = now`) and opens a new active triple linked via `supersedes_id`.
 * 2. Point-in-time "time-travel" queries (`queryStateAsOf`): reconstructs exact factual state at any
 *    historical timestamp `T`.
 * 3. Multi-hop temporal lineage (`getFactEvolutionChain`): returns the complete chronological audit trail
 *    of how a project metric, budget, or deadline evolved over time.
 */

import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

export interface BitemporalFactTriple {
  id: string;
  ownerId: string;
  subject: string;
  predicate: string;
  objectValue: string;
  sourceDocId?: string;
  validFrom: string;
  validTo: string | null; // null means currently valid
  recordedAt: string;
  supersededAt: string | null;
  supersedesId: string | null;
}

export class TemporalKnowledgeGraph {
  constructor(private readonly sqlite: DatabaseSync) {
    this.ensureSchema();
  }

  ensureSchema(): void {
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS kosmora_temporal_knowledge_graph (
        id TEXT PRIMARY KEY NOT NULL,
        owner_id TEXT NOT NULL,
        subject TEXT NOT NULL,
        predicate TEXT NOT NULL,
        object_value TEXT NOT NULL,
        source_doc_id TEXT,
        valid_from TEXT NOT NULL,
        valid_to TEXT,
        recorded_at TEXT NOT NULL,
        superseded_at TEXT,
        supersedes_id TEXT
      );
      CREATE INDEX IF NOT EXISTS kosmora_temporal_kg_owner_subj_pred_idx
        ON kosmora_temporal_knowledge_graph(owner_id, subject, predicate, valid_from ASC);
    `);
  }

  /**
   * Asserts a fact triple `(subject, predicate, objectValue)` effective at `validFrom`.
   * If an active triple for `(ownerId, subject, predicate)` already exists with a different value,
   * closes the old triple's `valid_to` and `superseded_at` and links the new triple via `supersedes_id`.
   */
  public assertFactTriple(options: {
    ownerId: string;
    subject: string;
    predicate: string;
    objectValue: string;
    sourceDocId?: string;
    validFrom?: string;
    recordedAt?: string;
  }): BitemporalFactTriple {
    const validFrom = options.validFrom ?? new Date().toISOString();
    const recordedAt = options.recordedAt ?? validFrom;
    const subjectNorm = options.subject.trim();
    const predicateNorm = options.predicate.trim();
    const objectNorm = options.objectValue.trim();

    // Find currently active fact for (ownerId, subject, predicate)
    const activeRow = this.sqlite
      .prepare(
        `SELECT * FROM kosmora_temporal_knowledge_graph
         WHERE owner_id = ? AND subject = ? AND predicate = ? AND valid_to IS NULL AND superseded_at IS NULL
         ORDER BY valid_from DESC LIMIT 1`
      )
      .get(options.ownerId, subjectNorm, predicateNorm) as any;

    let supersedesId: string | null = null;

    if (activeRow) {
      if (activeRow.object_value === objectNorm) {
        return this.mapRow(activeRow);
      }
      supersedesId = activeRow.id;
      this.sqlite
        .prepare(
          `UPDATE kosmora_temporal_knowledge_graph
           SET valid_to = ?, superseded_at = ?
           WHERE id = ? AND owner_id = ?`
        )
        .run(validFrom, recordedAt, activeRow.id, options.ownerId);
    }

    const id = `tkg-${randomUUID()}`;
    this.sqlite
      .prepare(
        `INSERT INTO kosmora_temporal_knowledge_graph (
          id, owner_id, subject, predicate, object_value, source_doc_id,
          valid_from, valid_to, recorded_at, superseded_at, supersedes_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, ?)`
      )
      .run(
        id,
        options.ownerId,
        subjectNorm,
        predicateNorm,
        objectNorm,
        options.sourceDocId ?? null,
        validFrom,
        recordedAt,
        supersedesId
      );

    return {
      id,
      ownerId: options.ownerId,
      subject: subjectNorm,
      predicate: predicateNorm,
      objectValue: objectNorm,
      sourceDocId: options.sourceDocId,
      validFrom,
      validTo: null,
      recordedAt,
      supersededAt: null,
      supersedesId
    };
  }

  /**
   * Time-travel query: returns all facts valid at the exact point in time `asOfIso`.
   */
  public queryStateAsOf(options: {
    ownerId: string;
    subject?: string;
    predicate?: string;
    asOfIso: string;
  }): BitemporalFactTriple[] {
    let sql = `
      SELECT * FROM kosmora_temporal_knowledge_graph
      WHERE owner_id = ?
        AND valid_from <= ?
        AND (valid_to IS NULL OR valid_to > ?)
    `;
    const params: any[] = [options.ownerId, options.asOfIso, options.asOfIso];

    if (options.subject) {
      sql += " AND subject = ?";
      params.push(options.subject.trim());
    }
    if (options.predicate) {
      sql += " AND predicate = ?";
      params.push(options.predicate.trim());
    }
    sql += " ORDER BY valid_from ASC";

    const rows = this.sqlite.prepare(sql).all(...params) as any[];
    return rows.map((r) => this.mapRow(r));
  }

  /**
   * Returns the complete chronological evolution chain for a `(subject, predicate)` pair.
   */
  public getFactEvolutionChain(
    ownerId: string,
    subject: string,
    predicate: string
  ): BitemporalFactTriple[] {
    const rows = this.sqlite
      .prepare(
        `SELECT * FROM kosmora_temporal_knowledge_graph
         WHERE owner_id = ? AND subject = ? AND predicate = ?
         ORDER BY valid_from ASC, recorded_at ASC`
      )
      .all(ownerId, subject.trim(), predicate.trim()) as any[];

    return rows.map((r) => this.mapRow(r));
  }

  private mapRow(r: any): BitemporalFactTriple {
    return {
      id: r.id,
      ownerId: r.owner_id,
      subject: r.subject,
      predicate: r.predicate,
      objectValue: r.object_value,
      sourceDocId: r.source_doc_id ?? undefined,
      validFrom: r.valid_from,
      validTo: r.valid_to ?? null,
      recordedAt: r.recorded_at,
      supersededAt: r.superseded_at ?? null,
      supersedesId: r.supersedes_id ?? null
    };
  }
}
