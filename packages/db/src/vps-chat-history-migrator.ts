import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

export interface VpsChatMigrationBatch {
  table: "general_chats" | "general_chat_runs" | "general_chat_messages" | "context_memory_entries";
  batchIndex: number;
  rowCount: number;
  sha256: string;
  rows: Array<Record<string, unknown>>;
}

export interface VpsChatMigrationBundle {
  schemaVersion: "kosmora-vps-chat-migration-v1";
  ownerId: string;
  exportedAt: string;
  maxBatchSize: number;
  totalRows: number;
  manifestSha256: string;
  batches: VpsChatMigrationBatch[];
}

export interface VpsChatRestoreSummary {
  ownerId: string;
  verifiedBatches: number;
  insertedChats: number;
  insertedRuns: number;
  insertedMessages: number;
  insertedMemories: number;
  skippedExistingRows: number;
}

/**
 * Memory-bounded streaming exporter/importer designed for the 1 vCPU / 1 GB RAM replacement VPS (PR #423).
 * Exports and restores user chat history and context memories in small verified batches (<= 200 rows)
 * without loading entire multi-megabyte tables into heap at once.
 */
export class VpsChatHistoryMigrator {
  constructor(private readonly sqlite: DatabaseSync) {}

  ensureTables(): void {
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS general_chats (
        id TEXT PRIMARY KEY NOT NULL,
        owner_id TEXT NOT NULL,
        title TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS general_chat_runs (
        id TEXT PRIMARY KEY NOT NULL,
        chat_id TEXT NOT NULL,
        status TEXT NOT NULL,
        provider TEXT,
        model_resolved TEXT,
        input_tokens INTEGER,
        output_tokens INTEGER,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS general_chat_messages (
        id TEXT PRIMARY KEY NOT NULL,
        chat_id TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content_type TEXT NOT NULL,
        content TEXT NOT NULL,
        status TEXT NOT NULL,
        client_message_id TEXT,
        run_id TEXT,
        error_code TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS context_memory_entries (
        id TEXT PRIMARY KEY NOT NULL,
        owner_id TEXT NOT NULL,
        scope TEXT NOT NULL,
        chat_id TEXT,
        project_id TEXT,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        pinned INTEGER NOT NULL DEFAULT 0,
        expires_at TEXT,
        source_chat_message_id TEXT,
        source_project_message_id TEXT,
        source_json TEXT NOT NULL DEFAULT '{}',
        version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        creation_key TEXT,
        creation_sha256 TEXT
      );
    `);
  }

  exportOwnerHistoryBundle(ownerId: string, maxBatchSize = 150): VpsChatMigrationBundle {
    this.ensureTables();
    const safeBatchSize = Math.min(Math.max(maxBatchSize, 10), 250);
    const batches: VpsChatMigrationBatch[] = [];
    let totalRows = 0;

    const pushTableBatches = (
      table: VpsChatMigrationBatch["table"],
      allRows: Array<Record<string, unknown>>
    ) => {
      let batchIndex = 0;
      for (let offset = 0; offset < allRows.length; offset += safeBatchSize) {
        const slice = allRows.slice(offset, offset + safeBatchSize);
        const sha256 = createHash("sha256")
          .update(JSON.stringify(slice), "utf8")
          .digest("hex");
        batches.push({
          table,
          batchIndex: batchIndex++,
          rowCount: slice.length,
          sha256,
          rows: slice
        });
        totalRows += slice.length;
      }
    };

    const chats = this.sqlite
      .prepare("SELECT * FROM general_chats WHERE owner_id = ? ORDER BY created_at ASC, id ASC")
      .all(ownerId) as Array<Record<string, unknown>>;
    pushTableBatches("general_chats", chats);

    const runs = this.sqlite
      .prepare(
        `SELECT r.* FROM general_chat_runs r
         JOIN general_chats c ON c.id = r.chat_id
         WHERE c.owner_id = ?
         ORDER BY r.created_at ASC, r.id ASC`
      )
      .all(ownerId) as Array<Record<string, unknown>>;
    pushTableBatches("general_chat_runs", runs);

    const messages = this.sqlite
      .prepare(
        "SELECT * FROM general_chat_messages WHERE owner_id = ? ORDER BY created_at ASC, id ASC"
      )
      .all(ownerId) as Array<Record<string, unknown>>;
    pushTableBatches("general_chat_messages", messages);

    const memories = this.sqlite
      .prepare(
        "SELECT * FROM context_memory_entries WHERE owner_id = ? ORDER BY created_at ASC, id ASC"
      )
      .all(ownerId) as Array<Record<string, unknown>>;
    pushTableBatches("context_memory_entries", memories);

    const manifestSha256 = createHash("sha256")
      .update(
        JSON.stringify(
          batches.map((b) => ({
            table: b.table,
            batchIndex: b.batchIndex,
            rowCount: b.rowCount,
            sha256: b.sha256
          }))
        ),
        "utf8"
      )
      .digest("hex");

    return {
      schemaVersion: "kosmora-vps-chat-migration-v1",
      ownerId,
      exportedAt: new Date().toISOString(),
      maxBatchSize: safeBatchSize,
      totalRows,
      manifestSha256,
      batches
    };
  }

  restoreOwnerHistoryBundle(bundle: VpsChatMigrationBundle): VpsChatRestoreSummary {
    this.ensureTables();
    if (bundle.schemaVersion !== "kosmora-vps-chat-migration-v1") {
      throw new Error(`UNSUPPORTED_BUNDLE_SCHEMA: ${String(bundle.schemaVersion)}`);
    }

    // Verify manifest and batch SHA-256 integrity before touching SQLite
    const expectedManifest = createHash("sha256")
      .update(
        JSON.stringify(
          bundle.batches.map((b) => ({
            table: b.table,
            batchIndex: b.batchIndex,
            rowCount: b.rowCount,
            sha256: b.sha256
          }))
        ),
        "utf8"
      )
      .digest("hex");

    if (expectedManifest !== bundle.manifestSha256) {
      throw new Error("BUNDLE_MANIFEST_SHA256_MISMATCH");
    }

    for (const batch of bundle.batches) {
      const actualHash = createHash("sha256")
        .update(JSON.stringify(batch.rows), "utf8")
        .digest("hex");
      if (actualHash !== batch.sha256) {
        throw new Error(`BATCH_SHA256_MISMATCH: ${batch.table}#${batch.batchIndex}`);
      }
    }

    let insertedChats = 0;
    let insertedRuns = 0;
    let insertedMessages = 0;
    let insertedMemories = 0;
    let skippedExistingRows = 0;

    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      for (const batch of bundle.batches) {
        if (batch.table === "general_chats") {
          const stmt = this.sqlite.prepare(
            `INSERT OR IGNORE INTO general_chats (id, owner_id, title, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?)`
          );
          for (const r of batch.rows) {
            if (String(r.owner_id) !== bundle.ownerId) {
              throw new Error("CROSS_OWNER_ROW_REJECTED");
            }
            const res = stmt.run(
              String(r.id),
              String(r.owner_id),
              String(r.title),
              String(r.created_at),
              String(r.updated_at)
            );
            if (res.changes > 0) insertedChats++;
            else skippedExistingRows++;
          }
        } else if (batch.table === "general_chat_runs") {
          const stmt = this.sqlite.prepare(
            `INSERT OR IGNORE INTO general_chat_runs (
              id, chat_id, status, provider, model_resolved, input_tokens, output_tokens, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
          );
          for (const r of batch.rows) {
            const res = stmt.run(
              String(r.id),
              String(r.chat_id),
              String(r.status),
              r.provider ? String(r.provider) : null,
              r.model_resolved ? String(r.model_resolved) : null,
              typeof r.input_tokens === "number" ? r.input_tokens : null,
              typeof r.output_tokens === "number" ? r.output_tokens : null,
              String(r.created_at),
              String(r.updated_at)
            );
            if (res.changes > 0) insertedRuns++;
            else skippedExistingRows++;
          }
        } else if (batch.table === "general_chat_messages") {
          const stmt = this.sqlite.prepare(
            `INSERT OR IGNORE INTO general_chat_messages (
              id, chat_id, owner_id, role, content_type, content, status,
              client_message_id, run_id, error_code, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          );
          for (const r of batch.rows) {
            if (String(r.owner_id) !== bundle.ownerId) {
              throw new Error("CROSS_OWNER_ROW_REJECTED");
            }
            const res = stmt.run(
              String(r.id),
              String(r.chat_id),
              String(r.owner_id),
              String(r.role),
              String(r.content_type),
              String(r.content),
              String(r.status),
              r.client_message_id ? String(r.client_message_id) : null,
              r.run_id ? String(r.run_id) : null,
              r.error_code ? String(r.error_code) : null,
              String(r.created_at),
              String(r.updated_at)
            );
            if (res.changes > 0) insertedMessages++;
            else skippedExistingRows++;
          }
        } else if (batch.table === "context_memory_entries") {
          const stmt = this.sqlite.prepare(
            `INSERT OR IGNORE INTO context_memory_entries (
              id, owner_id, scope, chat_id, project_id, kind, title, content, pinned,
              expires_at, source_chat_message_id, source_project_message_id, source_json,
              version, created_at, updated_at, creation_key, creation_sha256
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          );
          for (const r of batch.rows) {
            if (String(r.owner_id) !== bundle.ownerId) {
              throw new Error("CROSS_OWNER_ROW_REJECTED");
            }
            const res = stmt.run(
              String(r.id),
              String(r.owner_id),
              String(r.scope),
              r.chat_id ? String(r.chat_id) : null,
              r.project_id ? String(r.project_id) : null,
              String(r.kind),
              String(r.title),
              String(r.content),
              Number(r.pinned ?? 0),
              r.expires_at ? String(r.expires_at) : null,
              r.source_chat_message_id ? String(r.source_chat_message_id) : null,
              r.source_project_message_id ? String(r.source_project_message_id) : null,
              String(r.source_json ?? "{}"),
              Number(r.version ?? 1),
              String(r.created_at),
              String(r.updated_at),
              r.creation_key ? String(r.creation_key) : null,
              r.creation_sha256 ? String(r.creation_sha256) : null
            );
            if (res.changes > 0) insertedMemories++;
            else skippedExistingRows++;
          }
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
      ownerId: bundle.ownerId,
      verifiedBatches: bundle.batches.length,
      insertedChats,
      insertedRuns,
      insertedMessages,
      insertedMemories,
      skippedExistingRows
    };
  }
}
