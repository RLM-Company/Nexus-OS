import { DatabaseSync } from "node:sqlite";

export interface SlidingRateDecision {
  allowed: boolean;
  estimatedSlidingWindowCount: number;
  limitMaxRequests: number;
  remainingQuota: number;
  windowProgressRatio: number;
}

/**
 * Cloudflare / Stripe-Style Hybrid Sliding-Window Counter Rate Governor backed by SQLite.
 * Approximates a true sliding window in O(1) state using weighted interpolation between the
 * previous fixed window and current fixed window:
 *   count = prevWindowCount * (1 - elapsedInCurrentWindow / windowMs) + currentWindowCount
 * eliminating the 2x boundary burst spike of naive fixed-window counters.
 */
export class SlidingWindowLogAndCounterGovernor {
  private readonly sqlite: DatabaseSync;
  public readonly windowDurationMs: number;
  public readonly limitMaxRequests: number;

  constructor(
    sqlite: DatabaseSync,
    params?: { windowDurationMs?: number; limitMaxRequests?: number }
  ) {
    this.sqlite = sqlite;
    this.windowDurationMs = Math.max(100, params?.windowDurationMs ?? 60_000);
    this.limitMaxRequests = Math.max(1, params?.limitMaxRequests ?? 100);
    this.ensureTable();
  }

  private ensureTable(): void {
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS kosmora_sliding_window_counters (
        subject_key TEXT NOT NULL,
        window_id INTEGER NOT NULL,
        request_count INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (subject_key, window_id)
      );
    `);
  }

  public checkAndConsume(
    subjectKey: string,
    nowMs: number,
    costUnits = 1
  ): SlidingRateDecision {
    const currentWindowId = Math.floor(nowMs / this.windowDurationMs);
    const prevWindowId = currentWindowId - 1;
    const elapsedInCurrent = nowMs - currentWindowId * this.windowDurationMs;
    const windowProgressRatio = Math.min(
      1,
      Math.max(0, elapsedInCurrent / this.windowDurationMs)
    );

    const prevRow = this.sqlite
      .prepare(
        `SELECT request_count FROM kosmora_sliding_window_counters
         WHERE subject_key = ? AND window_id = ?`
      )
      .get(subjectKey, prevWindowId) as { request_count: number } | undefined;

    const currRow = this.sqlite
      .prepare(
        `SELECT request_count FROM kosmora_sliding_window_counters
         WHERE subject_key = ? AND window_id = ?`
      )
      .get(subjectKey, currentWindowId) as { request_count: number } | undefined;

    const prevCount = prevRow?.request_count ?? 0;
    const currCount = currRow?.request_count ?? 0;

    const weightedPrev = prevCount * (1.0 - windowProgressRatio);
    const projectedCount = weightedPrev + currCount + costUnits;

    if (projectedCount > this.limitMaxRequests) {
      return {
        allowed: false,
        estimatedSlidingWindowCount: Number((weightedPrev + currCount).toFixed(4)),
        limitMaxRequests: this.limitMaxRequests,
        remainingQuota: Number(
          Math.max(0, this.limitMaxRequests - (weightedPrev + currCount)).toFixed(4)
        ),
        windowProgressRatio: Number(windowProgressRatio.toFixed(4))
      };
    }

    this.sqlite
      .prepare(
        `INSERT INTO kosmora_sliding_window_counters
          (subject_key, window_id, request_count)
         VALUES (?, ?, ?)
         ON CONFLICT(subject_key, window_id) DO UPDATE SET
          request_count = request_count + excluded.request_count`
      )
      .run(subjectKey, currentWindowId, costUnits);

    return {
      allowed: true,
      estimatedSlidingWindowCount: Number(projectedCount.toFixed(4)),
      limitMaxRequests: this.limitMaxRequests,
      remainingQuota: Number(Math.max(0, this.limitMaxRequests - projectedCount).toFixed(4)),
      windowProgressRatio: Number(windowProgressRatio.toFixed(4))
    };
  }
}
