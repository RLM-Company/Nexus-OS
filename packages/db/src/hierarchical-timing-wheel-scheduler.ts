import { DatabaseSync } from "node:sqlite";

export interface ScheduledWheelTimer {
  timerId: string;
  slotIndex: number;
  roundsRemaining: number;
  dueAtTick: number;
  taskPayloadJson: string;
}

/**
 * Varghese & Lauck Hashed & Hierarchical Timing Wheel Scheduler backed by SQLite.
 * Schedules timers into circular wheel slots (`slot = dueAtTick % wheelSize`) with rotation
 * round counters (`rounds = floor((dueAtTick - currentTick) / wheelSize)`), enabling O(1) timer
 * insertion and deterministic tick advancement.
 */
export class HierarchicalTimingWheelStore {
  private readonly sqlite: DatabaseSync;
  public readonly wheelSlotCount: number;
  public currentTick = 0;

  constructor(sqlite: DatabaseSync, wheelSlotCount = 64, initialTick = 0) {
    this.sqlite = sqlite;
    this.wheelSlotCount = Math.max(8, wheelSlotCount);
    this.currentTick = initialTick;
    this.ensureTable();
  }

  private ensureTable(): void {
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS kosmora_timing_wheel_timers (
        timer_id TEXT PRIMARY KEY NOT NULL,
        slot_index INTEGER NOT NULL,
        rounds_remaining INTEGER NOT NULL,
        due_at_tick INTEGER NOT NULL,
        task_payload_json TEXT NOT NULL,
        fired INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_kosmora_timing_wheel_slot
        ON kosmora_timing_wheel_timers (fired, slot_index, rounds_remaining);
    `);
  }

  public scheduleTimer(
    timerId: string,
    delayTicks: number,
    payload: Record<string, unknown>
  ): ScheduledWheelTimer {
    const safeDelay = Math.max(1, Math.floor(delayTicks));
    const dueAtTick = this.currentTick + safeDelay;
    const slotIndex = dueAtTick % this.wheelSlotCount;
    const roundsRemaining = Math.floor((safeDelay - 1) / this.wheelSlotCount);
    const taskPayloadJson = JSON.stringify(payload);

    this.sqlite
      .prepare(
        `INSERT INTO kosmora_timing_wheel_timers
          (timer_id, slot_index, rounds_remaining, due_at_tick, task_payload_json, fired)
         VALUES (?, ?, ?, ?, ?, 0)
         ON CONFLICT(timer_id) DO UPDATE SET
          slot_index = excluded.slot_index,
          rounds_remaining = excluded.rounds_remaining,
          due_at_tick = excluded.due_at_tick,
          task_payload_json = excluded.task_payload_json,
          fired = 0`
      )
      .run(timerId, slotIndex, roundsRemaining, dueAtTick, taskPayloadJson);

    return {
      timerId,
      slotIndex,
      roundsRemaining,
      dueAtTick,
      taskPayloadJson
    };
  }

  public advanceTick(): Array<{ timerId: string; payload: Record<string, unknown> }> {
    this.currentTick++;
    const currentSlot = this.currentTick % this.wheelSlotCount;

    const dueRows = this.sqlite
      .prepare(
        `SELECT timer_id, task_payload_json
         FROM kosmora_timing_wheel_timers
         WHERE fired = 0 AND slot_index = ? AND rounds_remaining <= 0
         ORDER BY timer_id ASC`
      )
      .all(currentSlot) as Array<{ timer_id: string; task_payload_json: string }>;

    if (dueRows.length > 0) {
      this.sqlite
        .prepare(
          `UPDATE kosmora_timing_wheel_timers
           SET fired = 1
           WHERE fired = 0 AND slot_index = ? AND rounds_remaining <= 0`
        )
        .run(currentSlot);
    }

    // Decrement rounds_remaining for timers in this slot that still have > 0 rounds
    this.sqlite
      .prepare(
        `UPDATE kosmora_timing_wheel_timers
         SET rounds_remaining = rounds_remaining - 1
         WHERE fired = 0 AND slot_index = ? AND rounds_remaining > 0`
      )
      .run(currentSlot);

    return dueRows.map((r) => ({
      timerId: r.timer_id,
      payload: JSON.parse(r.task_payload_json) as Record<string, unknown>
    }));
  }
}
