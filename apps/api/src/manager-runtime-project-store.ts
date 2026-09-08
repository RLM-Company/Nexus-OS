import type { DatabaseSync } from "node:sqlite";
import { ProjectStore, type StoredMessage } from "@cosmora/db";

export interface QueuedManagerRun {
  run_id: string;
  project_id: string;
  owner_id: string;
}

/**
 * ProjectStore specialization used by the long-lived API process.
 *
 * The base store intentionally remains transport-agnostic for contract/unit tests.
 * This runtime specialization adds an atomic queued-run claim and prevents a second
 * transport/worker from becoming another executor once an assistant message already
 * exists for a running run.
 */
export class ManagerRuntimeProjectStore extends ProjectStore {
  readonly #runtimeSqlite: DatabaseSync;

  constructor(sqlite: DatabaseSync) {
    super(sqlite);
    this.#runtimeSqlite = sqlite;
  }

  listQueuedManagerRuns(limit = 16): QueuedManagerRun[] {
    if (!Number.isInteger(limit) || limit < 1) return [];
    return this.#runtimeSqlite
      .prepare(
        `SELECT r.id AS run_id, r.project_id, p.owner_id
         FROM runs r
         JOIN projects p ON p.id = r.project_id
         WHERE r.status = 'queued' AND p.status = 'ACTIVE'
         ORDER BY r.created_at ASC
         LIMIT ?`
      )
      .all(limit) as unknown as QueuedManagerRun[];
  }

  claimQueuedManagerRun(runId: string): boolean {
    const result = this.#runtimeSqlite
      .prepare(
        `UPDATE runs SET status = 'running', updated_at = ?
         WHERE id = ? AND status = 'queued'`
      )
      .run(new Date().toISOString(), runId);
    return Number(result.changes) === 1;
  }

  override startAssistantMessage(runId: string, ownerId?: string): StoredMessage | null {
    const run = this.getRun(runId, ownerId);
    const existing = this.getAssistantMessage(runId, ownerId);
    if (run?.status === "running" && existing) return null;
    return super.startAssistantMessage(runId, ownerId);
  }
}
