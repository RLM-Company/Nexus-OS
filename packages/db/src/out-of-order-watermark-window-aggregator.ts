import { DatabaseSync } from "node:sqlite";

export interface TumblingWindowResult {
  windowStartMs: number;
  windowEndMs: number;
  eventCount: number;
  sumValue: number;
  maxValue: number;
  closedByWatermark: boolean;
}

/**
 * Google MillWheel / Apache Flink-Style Low-Watermark Out-of-Order Event-Time Window Aggregator.
 * Accumulates out-of-order events into fixed-size event-time windows `[wStart, wEnd)` up to
 * `allowedLatenessMs`, routing events older than `currentWatermark - allowedLatenessMs` to the
 * Late-Data Side Output!
 */
export class DataflowWatermarkWindowAggregator {
  private readonly sqlite: DatabaseSync;
  public readonly windowSizeMs: number;
  public readonly allowedLatenessMs: number;
  public currentWatermarkMs = 0;
  public readonly lateSideOutputEvents: Array<{ eventTimeMs: number; value: number }> = [];

  constructor(
    sqlite: DatabaseSync,
    params?: { windowSizeMs?: number; allowedLatenessMs?: number }
  ) {
    this.sqlite = sqlite;
    this.windowSizeMs = Math.max(100, params?.windowSizeMs ?? 1000);
    this.allowedLatenessMs = Math.max(0, params?.allowedLatenessMs ?? 200);
    this.ensureTable();
  }

  private ensureTable(): void {
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS kosmora_event_time_windows (
        window_start_ms INTEGER PRIMARY KEY NOT NULL,
        window_end_ms INTEGER NOT NULL,
        event_count INTEGER NOT NULL,
        sum_value REAL NOT NULL,
        max_value REAL NOT NULL
      );
    `);
  }

  public ingestEvent(eventTimeMs: number, value: number): {
    acceptedIntoWindow: boolean;
    routedToLateSideOutput: boolean;
    windowStartMs: number;
  } {
    const windowStartMs =
      Math.floor(eventTimeMs / this.windowSizeMs) * this.windowSizeMs;
    const windowEndMs = windowStartMs + this.windowSizeMs;

    // Check if window has already passed the watermark + allowedLatenessMs horizon
    if (windowEndMs + this.allowedLatenessMs < this.currentWatermarkMs) {
      this.lateSideOutputEvents.push({ eventTimeMs, value });
      return {
        acceptedIntoWindow: false,
        routedToLateSideOutput: true,
        windowStartMs
      };
    }

    this.sqlite
      .prepare(
        `INSERT INTO kosmora_event_time_windows
          (window_start_ms, window_end_ms, event_count, sum_value, max_value)
         VALUES (?, ?, 1, ?, ?)
         ON CONFLICT(window_start_ms) DO UPDATE SET
          event_count = event_count + 1,
          sum_value = sum_value + excluded.sum_value,
          max_value = MAX(max_value, excluded.max_value)`
      )
      .run(windowStartMs, windowEndMs, value, value);

    return {
      acceptedIntoWindow: true,
      routedToLateSideOutput: false,
      windowStartMs
    };
  }

  public advanceWatermark(newWatermarkMs: number): TumblingWindowResult[] {
    this.currentWatermarkMs = Math.max(this.currentWatermarkMs, newWatermarkMs);

    const rows = this.sqlite
      .prepare(
        `SELECT window_start_ms, window_end_ms, event_count, sum_value, max_value
         FROM kosmora_event_time_windows
         ORDER BY window_start_ms ASC`
      )
      .all() as Array<{
      window_start_ms: number;
      window_end_ms: number;
      event_count: number;
      sum_value: number;
      max_value: number;
    }>;

    return rows.map((r) => ({
      windowStartMs: r.window_start_ms,
      windowEndMs: r.window_end_ms,
      eventCount: r.event_count,
      sumValue: Number(r.sum_value.toFixed(6)),
      maxValue: Number(r.max_value.toFixed(6)),
      closedByWatermark:
        r.window_end_ms + this.allowedLatenessMs <= this.currentWatermarkMs
    }));
  }
}
