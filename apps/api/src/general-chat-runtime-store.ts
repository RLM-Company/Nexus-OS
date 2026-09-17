import type { DatabaseSync } from "node:sqlite";
import { GeneralChatStore, type StoredGeneralChatMessage } from "@cosmora/db";

export interface QueuedGeneralChatRun {
  run_id: string;
  chat_id: string;
  owner_id: string;
}

/**
 * GeneralChatStore specialization used by the long-lived API process.
 *
 * The atomic claim makes the server coordinator the only executor for a queued
 * chat run. The assistant-message guard also prevents an observer or a second
 * coordinator instance from attaching another execution to a claimed run.
 */
export class GeneralChatRuntimeStore extends GeneralChatStore {
  readonly #runtimeSqlite: DatabaseSync;

  constructor(sqlite: DatabaseSync) {
    super(sqlite);
    this.#runtimeSqlite = sqlite;
  }

  listQueuedGeneralChatRuns(limit = 16): QueuedGeneralChatRun[] {
    if (!Number.isInteger(limit) || limit < 1) return [];
    return this.#runtimeSqlite
      .prepare(
        `SELECT r.id AS run_id, r.chat_id, c.owner_id
         FROM general_chat_runs r
         JOIN general_chats c ON c.id = r.chat_id
         WHERE r.status = 'queued'
         ORDER BY r.created_at ASC
         LIMIT ?`
      )
      .all(limit) as unknown as QueuedGeneralChatRun[];
  }

  claimQueuedGeneralChatRun(runId: string): boolean {
    const result = this.#runtimeSqlite
      .prepare(
        `UPDATE general_chat_runs SET status = 'running', updated_at = ?
         WHERE id = ? AND status = 'queued'`
      )
      .run(new Date().toISOString(), runId);
    return Number(result.changes) === 1;
  }

  override startAssistantMessage(runId: string, ownerId?: string): StoredGeneralChatMessage | null {
    const run = this.getRun(runId, ownerId);
    const existing = this.getAssistantMessage(runId, ownerId);
    if (run?.status === "running" && existing) return null;
    return super.startAssistantMessage(runId, ownerId);
  }
}
