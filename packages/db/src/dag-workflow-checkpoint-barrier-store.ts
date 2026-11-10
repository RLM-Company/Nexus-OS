import { DatabaseSync } from "node:sqlite";

export interface BarrierAlignmentOutcome {
  operatorId: string;
  epochId: number;
  alignedChannelsCount: number;
  totalRequiredChannels: number;
  checkpointCommitted: boolean;
}

/**
 * Apache Flink-Style Asynchronous Barrier Snapshotting (ABS) Coordinator backed by SQLite.
 * Tracks barrier arrivals across all upstream input channels of a streaming DAG operator
 * and commits a consistent epoch checkpoint immediately once all `requiredChannels` have
 * delivered their barrier for `epochId`.
 */
export class ChandyLamportDagBarrierCheckpointStore {
  private readonly db: DatabaseSync;

  public constructor(db: DatabaseSync) {
    this.db = db;
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS kosmora_dag_checkpoint_barriers (
        operator_id TEXT NOT NULL,
        epoch_id INTEGER NOT NULL,
        channel_id TEXT NOT NULL,
        arrived_at_ms INTEGER NOT NULL,
        PRIMARY KEY (operator_id, epoch_id, channel_id)
      );
      CREATE TABLE IF NOT EXISTS kosmora_dag_committed_checkpoints (
        operator_id TEXT NOT NULL,
        epoch_id INTEGER NOT NULL,
        state_snapshot_json TEXT NOT NULL,
        committed_at_ms INTEGER NOT NULL,
        PRIMARY KEY (operator_id, epoch_id)
      );
    `);
  }

  public recordBarrierArrival(params: {
    operatorId: string;
    epochId: number;
    channelId: string;
    requiredChannels: string[];
    operatorStateSnapshot: Record<string, unknown>;
    nowMs?: number;
  }): BarrierAlignmentOutcome {
    const now = params.nowMs ?? Date.now();
    this.db
      .prepare(
        `INSERT OR IGNORE INTO kosmora_dag_checkpoint_barriers
         (operator_id, epoch_id, channel_id, arrived_at_ms)
         VALUES (?, ?, ?, ?)`
      )
      .run(params.operatorId, params.epochId, params.channelId, now);

    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS cnt
         FROM kosmora_dag_checkpoint_barriers
         WHERE operator_id = ? AND epoch_id = ?`
      )
      .get(params.operatorId, params.epochId) as { cnt: number };

    const alignedCount = row.cnt;
    const totalReq = params.requiredChannels.length;
    const committed = alignedCount >= totalReq;

    if (committed) {
      this.db
        .prepare(
          `INSERT OR REPLACE INTO kosmora_dag_committed_checkpoints
           (operator_id, epoch_id, state_snapshot_json, committed_at_ms)
           VALUES (?, ?, ?, ?)`
        )
        .run(
          params.operatorId,
          params.epochId,
          JSON.stringify(params.operatorStateSnapshot),
          now
        );
    }

    return {
      operatorId: params.operatorId,
      epochId: params.epochId,
      alignedChannelsCount: alignedCount,
      totalRequiredChannels: totalReq,
      checkpointCommitted: committed
    };
  }
}
