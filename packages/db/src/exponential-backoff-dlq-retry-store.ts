import { DatabaseSync } from "node:sqlite";

export interface RetryTaskRecord {
  taskId: string;
  attemptCount: number;
  maxAttempts: number;
  status: "READY" | "BACKOFF_SCHEDULED" | "DEAD_LETTER_QUARANTINED" | "COMPLETED";
  nextRetryDelayMs: number;
  lastError: string | null;
}

/**
 * AWS-Style Decorrelated Jitter Exponential Backoff & Dead-Letter Queue (DLQ) Store backed by SQLite.
 * Computes bounded decorrelated backoff sleep_i = min(capMs, baseMs + u * (prevSleepMs * 3 - baseMs))
 * and automatically quarantines poison-pill tasks into DEAD_LETTER_QUARANTINED once
 * attemptCount reaches maxAttempts.
 */
export class DecorrelatedJitterDlqRetryStore {
  private readonly db: DatabaseSync;
  private readonly baseDelayMs: number;
  private readonly capDelayMs: number;

  public constructor(
    db: DatabaseSync,
    options?: { baseDelayMs?: number; capDelayMs?: number }
  ) {
    this.db = db;
    this.baseDelayMs = options?.baseDelayMs ?? 100;
    this.capDelayMs = options?.capDelayMs ?? 30_000;
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS kosmora_dlq_retry_tasks (
        task_id TEXT PRIMARY KEY,
        attempt_count INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL,
        status TEXT NOT NULL,
        prev_delay_ms INTEGER NOT NULL,
        last_error TEXT
      );
    `);
  }

  public enqueueTask(taskId: string, maxAttempts: number = 3): RetryTaskRecord {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO kosmora_dlq_retry_tasks
         (task_id, attempt_count, max_attempts, status, prev_delay_ms, last_error)
         VALUES (?, 0, ?, 'READY', ?, NULL)`
      )
      .run(taskId, maxAttempts, this.baseDelayMs);

    return {
      taskId,
      attemptCount: 0,
      maxAttempts,
      status: "READY",
      nextRetryDelayMs: 0,
      lastError: null
    };
  }

  public recordFailure(
    taskId: string,
    errorMessage: string,
    deterministicJitterU: number = 0.5
  ): RetryTaskRecord {
    const row = this.db
      .prepare(
        `SELECT attempt_count, max_attempts, prev_delay_ms
         FROM kosmora_dlq_retry_tasks
         WHERE task_id = ?`
      )
      .get(taskId) as
      | { attempt_count: number; max_attempts: number; prev_delay_ms: number }
      | undefined;

    if (!row) {
      throw new Error(`Unknown retry task: ${taskId}`);
    }

    const nextAttempt = row.attempt_count + 1;
    if (nextAttempt >= row.max_attempts) {
      this.db
        .prepare(
          `UPDATE kosmora_dlq_retry_tasks
           SET attempt_count = ?, status = 'DEAD_LETTER_QUARANTINED', prev_delay_ms = 0, last_error = ?
           WHERE task_id = ?`
        )
        .run(nextAttempt, errorMessage, taskId);

      return {
        taskId,
        attemptCount: nextAttempt,
        maxAttempts: row.max_attempts,
        status: "DEAD_LETTER_QUARANTINED",
        nextRetryDelayMs: 0,
        lastError: errorMessage
      };
    }

    const upper = Math.max(this.baseDelayMs, row.prev_delay_ms * 3);
    const rawDelay = Math.round(
      this.baseDelayMs + deterministicJitterU * (upper - this.baseDelayMs)
    );
    const boundedDelay = Math.min(this.capDelayMs, Math.max(this.baseDelayMs, rawDelay));

    this.db
      .prepare(
        `UPDATE kosmora_dlq_retry_tasks
         SET attempt_count = ?, status = 'BACKOFF_SCHEDULED', prev_delay_ms = ?, last_error = ?
         WHERE task_id = ?`
      )
      .run(nextAttempt, boundedDelay, errorMessage, taskId);

    return {
      taskId,
      attemptCount: nextAttempt,
      maxAttempts: row.max_attempts,
      status: "BACKOFF_SCHEDULED",
      nextRetryDelayMs: boundedDelay,
      lastError: errorMessage
    };
  }
}
