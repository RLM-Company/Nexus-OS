import { DatabaseSync } from "node:sqlite";

export interface TokenRingState {
  ringId: string;
  orderedMembers: string[];
  currentHolderNodeId: string;
  epochSequence: number;
}

/**
 * Distributed Sense-Reversing Barrier & Leased Token-Ring Coordinator backed by SQLite.
 * Coordinates cyclic privilege passing around an ordered logical ring of nodes with monotonic
 * epoch sequence numbers and multi-worker phase barriers.
 */
export class DistributedBarrierAndTokenRingStore {
  private readonly db: DatabaseSync;

  public constructor(db: DatabaseSync) {
    this.db = db;
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS kosmora_token_ring_holders (
        ring_id TEXT PRIMARY KEY,
        members_json TEXT NOT NULL,
        holder_index INTEGER NOT NULL,
        epoch_sequence INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS kosmora_barrier_phases (
        barrier_id TEXT NOT NULL,
        phase_number INTEGER NOT NULL,
        worker_id TEXT NOT NULL,
        PRIMARY KEY (barrier_id, phase_number, worker_id)
      );
    `);
  }

  public initRing(ringId: string, orderedMembers: string[]): TokenRingState {
    if (orderedMembers.length === 0) {
      throw new Error("Token ring requires at least 1 member");
    }
    this.db
      .prepare(
        `INSERT OR REPLACE INTO kosmora_token_ring_holders
         (ring_id, members_json, holder_index, epoch_sequence)
         VALUES (?, ?, 0, 1)`
      )
      .run(ringId, JSON.stringify(orderedMembers));

    return {
      ringId,
      orderedMembers,
      currentHolderNodeId: orderedMembers[0]!,
      epochSequence: 1
    };
  }

  public passTokenToNext(ringId: string): TokenRingState {
    const row = this.db
      .prepare(
        `SELECT members_json, holder_index, epoch_sequence
         FROM kosmora_token_ring_holders
         WHERE ring_id = ?`
      )
      .get(ringId) as
      | { members_json: string; holder_index: number; epoch_sequence: number }
      | undefined;

    if (!row) throw new Error(`Unknown token ring: ${ringId}`);
    const members = JSON.parse(row.members_json) as string[];
    const nextIdx = (row.holder_index + 1) % members.length;
    const nextEpoch = row.epoch_sequence + 1;

    this.db
      .prepare(
        `UPDATE kosmora_token_ring_holders
         SET holder_index = ?, epoch_sequence = ?
         WHERE ring_id = ?`
      )
      .run(nextIdx, nextEpoch, ringId);

    return {
      ringId,
      orderedMembers: members,
      currentHolderNodeId: members[nextIdx]!,
      epochSequence: nextEpoch
    };
  }

  public arriveAtBarrier(
    barrierId: string,
    phaseNumber: number,
    workerId: string,
    expectedPartySize: number
  ): { arrivedCount: number; barrierReleased: boolean } {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO kosmora_barrier_phases (barrier_id, phase_number, worker_id)
         VALUES (?, ?, ?)`
      )
      .run(barrierId, phaseNumber, workerId);

    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS cnt
         FROM kosmora_barrier_phases
         WHERE barrier_id = ? AND phase_number = ?`
      )
      .get(barrierId, phaseNumber) as { cnt: number };

    return {
      arrivedCount: row.cnt,
      barrierReleased: row.cnt >= expectedPartySize
    };
  }
}
