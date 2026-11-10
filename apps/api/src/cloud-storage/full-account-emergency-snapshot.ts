import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  buildCanonicalStoreZipSnapshot,
  parseAndVerifyCanonicalStoreZip,
  type CanonicalSnapshotManifest,
  type SnapshotPayloadData
} from "./google-drive-journal-recovery-and-zip-import.ts";

export interface FullAccountEmergencySnapshotSummary {
  snapshotId: string;
  ownerId: string;
  archiveSha256: string;
  payloadSha256: string;
  zipSizeBytes: number;
  partCount: number;
  counts: {
    chats: number;
    messages: number;
    workFiles: number;
    memories: number;
  };
}

export interface FullAccountRestoreResult {
  snapshotId: string;
  ownerId: string;
  restoredChats: number;
  restoredMessages: number;
  restoredWorkFiles: number;
  restoredMemories: number;
  interruptedMessagesQuiesced: number;
}

/**
 * Full-Account Emergency Snapshot Builder & Atomic Restorer
 * (closes the scope limitation in `KOSMORA_DRIVE_BACKUP_RESTORE_2026-11-02_RU.md` where snapshots
 * only covered selected individual chats/results rather than a complete owner account disaster recovery dump).
 */
export class FullAccountEmergencySnapshotService {
  constructor(private readonly sqlite: DatabaseSync) {
    this.ensureSchema();
  }

  ensureSchema(): void {
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS general_chats (
        id TEXT PRIMARY KEY NOT NULL,
        owner_id TEXT NOT NULL,
        title TEXT NOT NULL,
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
      CREATE TABLE IF NOT EXISTS work_artifact_versions (
        id TEXT PRIMARY KEY NOT NULL,
        project_id TEXT NOT NULL,
        work_id TEXT NOT NULL,
        name TEXT NOT NULL,
        version INTEGER NOT NULL,
        content TEXT NOT NULL,
        sha256 TEXT NOT NULL,
        bytes INTEGER NOT NULL,
        published INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL
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

  exportFullAccountEmergencyZip(
    ownerId: string,
    snapshotId = `emergency-${Date.now()}`
  ): {
    zipBuffer: Buffer;
    manifest: CanonicalSnapshotManifest;
    summary: FullAccountEmergencySnapshotSummary;
  } {
    const chats = this.sqlite
      .prepare(
        "SELECT id, title, created_at, updated_at FROM general_chats WHERE owner_id = ? ORDER BY created_at ASC, id ASC"
      )
      .all(ownerId) as SnapshotPayloadData["chats"];

    const messages = this.sqlite
      .prepare(
        "SELECT id, chat_id, role, content, content_type, status, created_at FROM general_chat_messages WHERE owner_id = ? ORDER BY created_at ASC, id ASC"
      )
      .all(ownerId) as SnapshotPayloadData["messages"];

    const workFiles = this.sqlite
      .prepare(
        "SELECT id, project_id, work_id, name, content, sha256, bytes, created_at FROM work_artifact_versions WHERE published = 1 ORDER BY created_at ASC, id ASC"
      )
      .all() as NonNullable<SnapshotPayloadData["workFiles"]>;

    const rawMemories = this.sqlite
      .prepare(
        "SELECT id, scope, kind, title, content, pinned, source_json FROM context_memory_entries WHERE owner_id = ? ORDER BY created_at ASC, id ASC"
      )
      .all(ownerId) as Array<{
      id: string;
      scope: "personal" | "chat" | "project";
      kind: string;
      title: string;
      content: string;
      pinned: number;
      source_json: string;
    }>;

    const memories = rawMemories.map((m) => ({
      ...m,
      pinned: Boolean(m.pinned)
    }));

    const payload: SnapshotPayloadData = {
      ownerId,
      chats,
      messages,
      workFiles,
      memories
    };

    const { zipBuffer, archiveSha256, manifest } = buildCanonicalStoreZipSnapshot(
      snapshotId,
      payload
    );

    return {
      zipBuffer,
      manifest,
      summary: {
        snapshotId,
        ownerId,
        archiveSha256,
        payloadSha256: manifest.payloadSha256,
        zipSizeBytes: zipBuffer.byteLength,
        partCount: manifest.parts.length,
        counts: {
          chats: chats.length,
          messages: messages.length,
          workFiles: workFiles.length,
          memories: memories.length
        }
      }
    };
  }

  restoreFullAccountEmergencyZip(
    ownerId: string,
    zipBuffer: Buffer
  ): FullAccountRestoreResult {
    const { manifest, payload } = parseAndVerifyCanonicalStoreZip(zipBuffer);
    if (manifest.ownerId !== ownerId || payload.ownerId !== ownerId) {
      throw new Error("EMERGENCY_SNAPSHOT_OWNER_MISMATCH");
    }

    let restoredChats = 0;
    let restoredMessages = 0;
    let restoredWorkFiles = 0;
    let restoredMemories = 0;
    let interruptedMessagesQuiesced = 0;
    const now = new Date().toISOString();

    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const insertChat = this.sqlite.prepare(
        `INSERT OR IGNORE INTO general_chats (id, owner_id, title, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`
      );
      for (const c of payload.chats) {
        const res = insertChat.run(c.id, ownerId, c.title, c.created_at, c.updated_at);
        if (res.changes > 0) restoredChats++;
      }

      const insertMsg = this.sqlite.prepare(
        `INSERT OR IGNORE INTO general_chat_messages (
          id, chat_id, owner_id, role, content_type, content, status,
          client_message_id, run_id, error_code, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?)`
      );
      for (const m of payload.messages) {
        let status = m.status ?? "completed";
        if (status === "pending" || status === "streaming") {
          status = "cancelled";
          interruptedMessagesQuiesced++;
        }
        const res = insertMsg.run(
          m.id,
          m.chat_id,
          ownerId,
          m.role,
          m.content_type ?? "text",
          m.content,
          status,
          m.created_at,
          now
        );
        if (res.changes > 0) restoredMessages++;
      }

      if (Array.isArray(payload.workFiles)) {
        const insertWf = this.sqlite.prepare(
          `INSERT OR IGNORE INTO work_artifact_versions (
            id, project_id, work_id, name, version, content, sha256, bytes, published, created_at
          ) VALUES (?, ?, ?, ?, 1, ?, ?, ?, 1, ?)`
        );
        for (const wf of payload.workFiles) {
          const actualSha = createHash("sha256").update(wf.content, "utf8").digest("hex");
          if (actualSha !== wf.sha256) {
            throw new Error(`EMERGENCY_WORK_FILE_SHA256_MISMATCH:${wf.name}`);
          }
          const res = insertWf.run(
            wf.id,
            wf.project_id,
            wf.work_id,
            wf.name,
            wf.content,
            wf.sha256,
            wf.bytes,
            wf.created_at
          );
          if (res.changes > 0) restoredWorkFiles++;
        }
      }

      if (Array.isArray(payload.memories)) {
        const insertMem = this.sqlite.prepare(
          `INSERT OR IGNORE INTO context_memory_entries (
            id, owner_id, scope, chat_id, project_id, kind, title, content, pinned,
            expires_at, source_chat_message_id, source_project_message_id, source_json,
            version, created_at, updated_at, creation_key, creation_sha256
          ) VALUES (?, ?, ?, NULL, NULL, ?, ?, ?, ?, NULL, NULL, NULL, ?, 1, ?, ?, ?, ?)`
        );
        for (const mem of payload.memories) {
          const sha = createHash("sha256").update(mem.content, "utf8").digest("hex");
          const res = insertMem.run(
            mem.id,
            ownerId,
            mem.scope,
            mem.kind,
            mem.title,
            mem.content,
            Number(Boolean(mem.pinned)),
            mem.source_json || "{}",
            now,
            now,
            `emergency-restore:${mem.id}`,
            sha
          );
          if (res.changes > 0) restoredMemories++;
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
      snapshotId: manifest.snapshotId,
      ownerId,
      restoredChats,
      restoredMessages,
      restoredWorkFiles,
      restoredMemories,
      interruptedMessagesQuiesced
    };
  }
}
