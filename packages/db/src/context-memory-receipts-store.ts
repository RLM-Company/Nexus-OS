import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

export const MAX_RECEIPTS_PER_OWNER = 500;

export interface MemoryReceiptSourceItem {
  entryId: string;
  scope: "personal" | "chat" | "project";
  kind: "fact" | "preference" | "decision" | "constraint" | "hypothesis";
  version: number;
  sourceReference: string | null;
  quoteSha256: string;
}

export interface RecordMemoryUsageReceiptInput {
  ownerId: string;
  targetKind: "chat" | "project" | "koswork";
  targetId: string;
  chatId?: string | null;
  projectId?: string | null;
  runId: string;
  generalRunId?: string | null;
  projectRunId?: string | null;
  requestId: string;
  attempt: number;
  channel: "chat" | "work" | "koswork";
  phase: "prompt_pack" | "compaction" | "critic";
  usedSources: MemoryReceiptSourceItem[];
  omittedCount?: number;
  priorityOmitted?: boolean;
  createdAt?: string;
}

export interface MemoryUsageReceiptView {
  id: string;
  ownerId: string;
  targetKind: string;
  targetId: string;
  chatId: string | null;
  projectId: string | null;
  runId: string;
  requestId: string;
  attempt: number;
  channel: string;
  phase: string;
  usedSources: MemoryReceiptSourceItem[];
  omittedCount: number;
  priorityOmitted: boolean;
  receiptDigestSha256: string;
  createdAt: string;
}

/**
 * Bounded Source Receipts Store (`0059_memory_usage.sql`, PR #424 `KOSMORA_MEMORY_RECEIPTS_2026-11-01_RU.md`):
 * 1. Records cryptographic source receipts (references + SHA-256 quote hashes, never duplicating raw secret strings)
 *    for every chat and Koswork request.
 * 2. Strictly enforces the 500-receipt cap per owner (`MAX_RECEIPTS_PER_OWNER = 500`) by pruning the oldest
 *    receipts atomically inside the insert transaction.
 * 3. Supports owner-scoped listing, filtering by `run_id` / `chat_id` / `project_id`, and full privacy export/delete.
 */
export class ContextMemoryReceiptsStore {
  private readonly maxReceiptsPerOwner: number;

  constructor(
    private readonly sqlite: DatabaseSync,
    options?: { maxReceiptsPerOwner?: number }
  ) {
    this.maxReceiptsPerOwner = Math.min(
      Math.max(options?.maxReceiptsPerOwner ?? MAX_RECEIPTS_PER_OWNER, 5),
      MAX_RECEIPTS_PER_OWNER
    );
    this.ensureSchema();
  }

  ensureSchema(): void {
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS context_memory_usage (
        id TEXT PRIMARY KEY NOT NULL,
        owner_id TEXT NOT NULL,
        target_kind TEXT NOT NULL,
        target_id TEXT NOT NULL,
        chat_id TEXT,
        project_id TEXT,
        run_id TEXT NOT NULL,
        general_run_id TEXT,
        project_run_id TEXT,
        request_id TEXT NOT NULL,
        attempt INTEGER NOT NULL DEFAULT 1,
        channel TEXT NOT NULL,
        phase TEXT NOT NULL,
        snapshot_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS context_memory_usage_owner_created_idx
        ON context_memory_usage(owner_id, created_at DESC, id DESC);
    `);
  }

  recordReceipt(input: RecordMemoryUsageReceiptInput): MemoryUsageReceiptView {
    const id = `rcpt-${randomUUID()}`;
    const createdAt = input.createdAt ?? new Date().toISOString();

    const sanitizedSources: MemoryReceiptSourceItem[] = input.usedSources.map((s) => ({
      entryId: String(s.entryId),
      scope: s.scope,
      kind: s.kind,
      version: Number(s.version ?? 1),
      sourceReference: s.sourceReference ? String(s.sourceReference) : null,
      quoteSha256: String(s.quoteSha256)
    }));

    const receiptDigestSha256 = createHash("sha256")
      .update(
        JSON.stringify({
          ownerId: input.ownerId,
          runId: input.runId,
          requestId: input.requestId,
          attempt: input.attempt,
          sources: sanitizedSources
        }),
        "utf8"
      )
      .digest("hex");

    const snapshotPayload = {
      usedSources: sanitizedSources,
      omittedCount: Number(input.omittedCount ?? 0),
      priorityOmitted: Boolean(input.priorityOmitted ?? false),
      receiptDigestSha256
    };

    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      this.sqlite
        .prepare(
          `INSERT INTO context_memory_usage (
            id, owner_id, target_kind, target_id, chat_id, project_id,
            run_id, general_run_id, project_run_id, request_id, attempt,
            channel, phase, snapshot_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          input.ownerId,
          input.targetKind,
          input.targetId,
          input.chatId ?? null,
          input.projectId ?? null,
          input.runId,
          input.generalRunId ?? null,
          input.projectRunId ?? null,
          input.requestId,
          input.attempt,
          input.channel,
          input.phase,
          JSON.stringify(snapshotPayload),
          createdAt
        );

      // Enforce the strict per-owner receipt ceiling (default 500)
      const excessRows = this.sqlite
        .prepare(
          `SELECT id FROM context_memory_usage
           WHERE owner_id = ?
           ORDER BY created_at DESC, id DESC
           LIMIT -1 OFFSET ?`
        )
        .all(input.ownerId, this.maxReceiptsPerOwner) as Array<{ id: string }>;

      if (excessRows.length > 0) {
        const delStmt = this.sqlite.prepare(
          "DELETE FROM context_memory_usage WHERE id = ? AND owner_id = ?"
        );
        for (const r of excessRows) {
          delStmt.run(r.id, input.ownerId);
        }
      }

      this.sqlite.exec("COMMIT");
    } catch (err) {
      try {
        this.sqlite.exec("ROLLBACK");
      } catch {
        // ignore
      }
      throw err;
    }

    return {
      id,
      ownerId: input.ownerId,
      targetKind: input.targetKind,
      targetId: input.targetId,
      chatId: input.chatId ?? null,
      projectId: input.projectId ?? null,
      runId: input.runId,
      requestId: input.requestId,
      attempt: input.attempt,
      channel: input.channel,
      phase: input.phase,
      usedSources: sanitizedSources,
      omittedCount: snapshotPayload.omittedCount,
      priorityOmitted: snapshotPayload.priorityOmitted,
      receiptDigestSha256,
      createdAt
    };
  }

  listOwnerReceipts(
    ownerId: string,
    filters?: { runId?: string; chatId?: string; projectId?: string; limit?: number }
  ): MemoryUsageReceiptView[] {
    const limit = Math.min(Math.max(filters?.limit ?? 100, 1), MAX_RECEIPTS_PER_OWNER);
    const rows = this.sqlite
      .prepare(
        `SELECT * FROM context_memory_usage
         WHERE owner_id = ?
           AND (? = '' OR run_id = ?)
           AND (? = '' OR COALESCE(chat_id, '') = ?)
           AND (? = '' OR COALESCE(project_id, '') = ?)
         ORDER BY created_at DESC, id DESC
         LIMIT ?`
      )
      .all(
        ownerId,
        filters?.runId ?? "",
        filters?.runId ?? "",
        filters?.chatId ?? "",
        filters?.chatId ?? "",
        filters?.projectId ?? "",
        filters?.projectId ?? "",
        limit
      ) as Array<{
      id: string;
      owner_id: string;
      target_kind: string;
      target_id: string;
      chat_id: string | null;
      project_id: string | null;
      run_id: string;
      request_id: string;
      attempt: number;
      channel: string;
      phase: string;
      snapshot_json: string;
      created_at: string;
    }>;

    return rows.map((r) => {
      const snap = JSON.parse(r.snapshot_json) as {
        usedSources: MemoryReceiptSourceItem[];
        omittedCount: number;
        priorityOmitted: boolean;
        receiptDigestSha256: string;
      };
      return {
        id: r.id,
        ownerId: r.owner_id,
        targetKind: r.target_kind,
        targetId: r.target_id,
        chatId: r.chat_id,
        projectId: r.project_id,
        runId: r.run_id,
        requestId: r.request_id,
        attempt: r.attempt,
        channel: r.channel,
        phase: r.phase,
        usedSources: snap.usedSources ?? [],
        omittedCount: snap.omittedCount ?? 0,
        priorityOmitted: Boolean(snap.priorityOmitted),
        receiptDigestSha256: snap.receiptDigestSha256 ?? "",
        createdAt: r.created_at
      };
    });
  }

  clearOwnerReceipts(ownerId: string): { deletedCount: number } {
    const res = this.sqlite
      .prepare("DELETE FROM context_memory_usage WHERE owner_id = ?")
      .run(ownerId);
    return { deletedCount: res.changes };
  }
}
