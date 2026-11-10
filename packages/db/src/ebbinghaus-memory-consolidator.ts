import { DatabaseSync } from "node:sqlite";

export interface MemoryRetentionRecord {
  memoryId: string;
  ownerId: string;
  summaryText: string;
  tier: "episodic" | "semantic_consolidated" | "archived_cold";
  importance: number; // [0..1]
  recallCount: number;
  stabilityHours: number;
  lastRecalledAtMs: number;
  currentRetentionScore: number; // R(t) = exp(-deltaHours / stabilityHours)
}

export interface ConsolidationSweepReport {
  promotedToSemanticIds: string[];
  archivedColdIds: string[];
  activeRetainedCount: number;
}

/**
 * Ebbinghaus Forgetting-Curve & Episodic-to-Semantic Memory Consolidator.
 * Models memory retention R(t) = exp(-delta_t / S), reinforces stability S on recall
 * (SuperMemo SM-2 style spaced repetition), promotes recurring high-value episodic memories
 * into permanent semantic knowledge, and archives decayed one-off traces.
 */
export class EbbinghausMemoryConsolidator {
  private readonly sqlite: DatabaseSync;

  constructor(sqlite: DatabaseSync) {
    this.sqlite = sqlite;
    this.ensureTable();
  }

  private ensureTable(): void {
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS kosmora_memory_retention_traces (
        memory_id TEXT PRIMARY KEY NOT NULL,
        owner_id TEXT NOT NULL,
        summary_text TEXT NOT NULL,
        tier TEXT NOT NULL DEFAULT 'episodic',
        importance REAL NOT NULL DEFAULT 0.5,
        recall_count INTEGER NOT NULL DEFAULT 1,
        stability_hours REAL NOT NULL DEFAULT 24.0,
        last_recalled_at_ms INTEGER NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  }

  public static computeRetentionScore(
    lastRecalledAtMs: number,
    nowMs: number,
    stabilityHours: number
  ): number {
    const elapsedHours = Math.max(0, (nowMs - lastRecalledAtMs) / 3_600_000);
    const s = Math.max(1, stabilityHours);
    return Number(Math.exp(-elapsedHours / s).toFixed(4));
  }

  public recordMemoryTrace(params: {
    memoryId: string;
    ownerId: string;
    summaryText: string;
    importance?: number;
    nowMs?: number;
  }): MemoryRetentionRecord {
    const nowMs = params.nowMs ?? Date.now();
    const importance = Math.min(1, Math.max(0.05, params.importance ?? 0.5));
    // Initial stability scales from 12 hours (low importance) up to 96 hours (high importance)
    const initialStabilityHours = Number((12 + importance * 84).toFixed(2));

    this.sqlite
      .prepare(
        `INSERT INTO kosmora_memory_retention_traces
          (memory_id, owner_id, summary_text, tier, importance, recall_count, stability_hours, last_recalled_at_ms, updated_at)
         VALUES (?, ?, ?, 'episodic', ?, 1, ?, ?, ?)
         ON CONFLICT(memory_id) DO UPDATE SET
          summary_text = excluded.summary_text,
          importance = MAX(kosmora_memory_retention_traces.importance, excluded.importance),
          updated_at = excluded.updated_at`
      )
      .run(
        params.memoryId,
        params.ownerId,
        params.summaryText,
        importance,
        initialStabilityHours,
        nowMs,
        new Date(nowMs).toISOString()
      );

    return this.getMemoryTrace(params.memoryId, nowMs)!;
  }

  /**
   * Reinforces a memory upon recall: multiplies stability S by (1.8 + 0.5 * importance)
   * and promotes to 'semantic_consolidated' once recallCount >= 3.
   */
  public reinforceOnRecall(memoryId: string, nowMs = Date.now()): MemoryRetentionRecord | null {
    const existing = this.getMemoryTrace(memoryId, nowMs);
    if (!existing) return null;

    const nextRecallCount = existing.recallCount + 1;
    const multiplier = 1.8 + 0.5 * existing.importance;
    const nextStabilityHours = Number(
      Math.min(8760, existing.stabilityHours * multiplier).toFixed(2)
    );
    const nextTier =
      nextRecallCount >= 3 || existing.importance >= 0.9
        ? "semantic_consolidated"
        : existing.tier === "archived_cold"
          ? "episodic"
          : existing.tier;

    this.sqlite
      .prepare(
        `UPDATE kosmora_memory_retention_traces
         SET recall_count = ?, stability_hours = ?, tier = ?, last_recalled_at_ms = ?, updated_at = ?
         WHERE memory_id = ?`
      )
      .run(
        nextRecallCount,
        nextStabilityHours,
        nextTier,
        nowMs,
        new Date(nowMs).toISOString(),
        memoryId
      );

    return this.getMemoryTrace(memoryId, nowMs);
  }

  public getMemoryTrace(memoryId: string, nowMs = Date.now()): MemoryRetentionRecord | null {
    const row = this.sqlite
      .prepare(
        `SELECT memory_id, owner_id, summary_text, tier, importance, recall_count, stability_hours, last_recalled_at_ms
         FROM kosmora_memory_retention_traces WHERE memory_id = ?`
      )
      .get(memoryId) as
      | {
          memory_id: string;
          owner_id: string;
          summary_text: string;
          tier: MemoryRetentionRecord["tier"];
          importance: number;
          recall_count: number;
          stability_hours: number;
          last_recalled_at_ms: number;
        }
      | undefined;

    if (!row) return null;

    return {
      memoryId: row.memory_id,
      ownerId: row.owner_id,
      summaryText: row.summary_text,
      tier: row.tier,
      importance: row.importance,
      recallCount: row.recall_count,
      stabilityHours: row.stability_hours,
      lastRecalledAtMs: row.last_recalled_at_ms,
      currentRetentionScore: EbbinghausMemoryConsolidator.computeRetentionScore(
        row.last_recalled_at_ms,
        nowMs,
        row.stability_hours
      )
    };
  }

  /**
   * Runs a consolidation sweep across an owner's memories at `nowMs`:
   * - Episodic memories with recallCount >= 3 are promoted to `semantic_consolidated`.
   * - Episodic memories whose retention R(t) < archiveThreshold (e.g. 0.20) are moved to `archived_cold`.
   */
  public runConsolidationSweep(
    ownerId: string,
    nowMs = Date.now(),
    archiveRetentionThreshold = 0.2
  ): ConsolidationSweepReport {
    const rows = this.sqlite
      .prepare(
        `SELECT memory_id FROM kosmora_memory_retention_traces WHERE owner_id = ?`
      )
      .all(ownerId) as Array<{ memory_id: string }>;

    const promotedToSemanticIds: string[] = [];
    const archivedColdIds: string[] = [];
    let activeRetainedCount = 0;

    for (const r of rows) {
      const rec = this.getMemoryTrace(r.memory_id, nowMs);
      if (!rec) continue;

      if (rec.tier === "episodic" && (rec.recallCount >= 3 || rec.importance >= 0.9)) {
        this.sqlite
          .prepare(
            `UPDATE kosmora_memory_retention_traces SET tier = 'semantic_consolidated', updated_at = ? WHERE memory_id = ?`
          )
          .run(new Date(nowMs).toISOString(), rec.memoryId);
        promotedToSemanticIds.push(rec.memoryId);
        activeRetainedCount++;
      } else if (
        rec.tier === "episodic" &&
        rec.currentRetentionScore < archiveRetentionThreshold
      ) {
        this.sqlite
          .prepare(
            `UPDATE kosmora_memory_retention_traces SET tier = 'archived_cold', updated_at = ? WHERE memory_id = ?`
          )
          .run(new Date(nowMs).toISOString(), rec.memoryId);
        archivedColdIds.push(rec.memoryId);
      } else if (rec.tier !== "archived_cold") {
        activeRetainedCount++;
      }
    }

    return {
      promotedToSemanticIds,
      archivedColdIds,
      activeRetainedCount
    };
  }
}
