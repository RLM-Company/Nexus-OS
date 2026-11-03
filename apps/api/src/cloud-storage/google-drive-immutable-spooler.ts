import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { join, resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";

export interface SpoolEntryMetadata {
  ownerId: string;
  backupId: string;
  sha256: string;
  sizeBytes: number;
  spoolFilePath: string;
  createdAt: string;
}

export interface RetryPolicyOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

export interface DriveUploadResult {
  driveFileId: string;
  md5Checksum?: string;
}

export interface QuotaAndRetentionResult {
  prunedSpoolFiles: number;
  prunedDriveBackups: string[];
  activeSpoolBytes: number;
}

export interface RestoredNewChatResult {
  newChatId: string;
  originalChatId: string;
  ownerId: string;
  title: string;
  restoredMessagesCount: number;
  provenanceBackupId: string;
  provenanceSha256: string;
}

const DEFAULT_MAX_OWNER_SPOOL_BYTES = 128 * 1024 * 1024; // 128 MiB
const DEFAULT_MAX_RETAINED_BACKUPS = 10;

export function isTransientDriveError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const status = (err as { status?: number; statusCode?: number }).status ??
    (err as { statusCode?: number }).statusCode;
  const code = String((err as { code?: string }).code ?? "");
  if (status === 429 || status === 408 || status === 500 || status === 502 || status === 503 || status === 504) {
    return true;
  }
  return (
    code === "ETIMEDOUT" ||
    code === "ECONNRESET" ||
    code === "EAI_AGAIN" ||
    code === "DRIVE_TIMEOUT" ||
    code === "DRIVE_RATE_LIMITED"
  );
}

/**
 * Immutable Archive Spooler, Retry Engine, Quota Pruner, and Fork-Into-New-Chat Restorer
 * for Google Drive Backups (closes the remaining items in PR #425 `KOSMORA_GOOGLE_DRIVE_2026-11-01_RU.md`).
 */
export class GoogleDriveImmutableSpooler {
  private readonly spoolRoot: string;
  private readonly maxOwnerSpoolBytes: number;
  private readonly maxRetainedBackups: number;

  constructor(
    private readonly sqlite: DatabaseSync,
    options: {
      spoolRoot: string;
      maxOwnerSpoolBytes?: number;
      maxRetainedBackups?: number;
    }
  ) {
    this.spoolRoot = resolve(options.spoolRoot);
    this.maxOwnerSpoolBytes = options.maxOwnerSpoolBytes ?? DEFAULT_MAX_OWNER_SPOOL_BYTES;
    this.maxRetainedBackups = options.maxRetainedBackups ?? DEFAULT_MAX_RETAINED_BACKUPS;
    mkdirSync(this.spoolRoot, { recursive: true });
    this.ensureSchema();
  }

  ensureSchema(): void {
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS kosmora_drive_spool_journal (
        backup_id TEXT PRIMARY KEY NOT NULL,
        owner_id TEXT NOT NULL,
        sha256 TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        spool_path TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('spooled', 'uploading', 'completed', 'failed', 'purged')),
        attempts INTEGER NOT NULL DEFAULT 0,
        drive_file_id TEXT,
        last_error_code TEXT,
        pinned INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
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
    `);
  }

  private ownerSpoolDir(ownerId: string): string {
    const safeOwner = ownerId.replace(/[^A-Za-z0-9_-]/g, "_");
    const dir = join(this.spoolRoot, safeOwner);
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  getOwnerActiveSpoolBytes(ownerId: string): number {
    const dir = this.ownerSpoolDir(ownerId);
    if (!existsSync(dir)) return 0;
    let total = 0;
    for (const entry of readdirSync(dir)) {
      if (!entry.endsWith(".spool")) continue;
      try {
        const st = statSync(join(dir, entry));
        if (st.isFile()) total += st.size;
      } catch {
        // ignore concurrent unlink
      }
    }
    return total;
  }

  /**
   * Writes an immutable archive payload to disk before any network upload attempt
   * so retries never require the caller to re-supply the payload bytes.
   */
  spoolArchive(options: {
    ownerId: string;
    backupId: string;
    payload: Buffer;
    pinned?: boolean;
  }): SpoolEntryMetadata {
    const sizeBytes = options.payload.byteLength;
    if (sizeBytes === 0) {
      throw new Error("EMPTY_ARCHIVE_PAYLOAD");
    }

    const currentSpool = this.getOwnerActiveSpoolBytes(options.ownerId);
    if (currentSpool + sizeBytes > this.maxOwnerSpoolBytes) {
      throw new Error("DRIVE_SPOOL_QUOTA_EXCEEDED");
    }

    const sha256 = createHash("sha256").update(options.payload).digest("hex");
    const safeBackupId = options.backupId.replace(/[^A-Za-z0-9_-]/g, "_");
    const spoolFilePath = join(
      this.ownerSpoolDir(options.ownerId),
      `${safeBackupId}-${sha256}.spool`
    );

    writeFileSync(spoolFilePath, options.payload, { mode: 0o600 });
    const now = new Date().toISOString();

    this.sqlite
      .prepare(
        `INSERT INTO kosmora_drive_spool_journal (
          backup_id, owner_id, sha256, size_bytes, spool_path, status, attempts,
          drive_file_id, last_error_code, pinned, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'spooled', 0, NULL, NULL, ?, ?, ?)
        ON CONFLICT(backup_id) DO UPDATE SET
          sha256 = excluded.sha256,
          size_bytes = excluded.size_bytes,
          spool_path = excluded.spool_path,
          status = 'spooled',
          updated_at = excluded.updated_at`
      )
      .run(
        options.backupId,
        options.ownerId,
        sha256,
        sizeBytes,
        spoolFilePath,
        Number(Boolean(options.pinned)),
        now,
        now
      );

    return {
      ownerId: options.ownerId,
      backupId: options.backupId,
      sha256,
      sizeBytes,
      spoolFilePath,
      createdAt: now
    };
  }

  /**
   * Reads and verifies the immutable spooled bytes, then executes the upload with
   * bounded exponential backoff on transient timeouts/rate-limits.
   */
  async dispatchOrRetrySpooledBackup(
    ownerId: string,
    backupId: string,
    uploader: (payload: Buffer, sha256: string, attempt: number) => Promise<DriveUploadResult>,
    retryOptions: RetryPolicyOptions = {}
  ): Promise<{ driveFileId: string; attemptsUsed: number; sha256: string }> {
    const row = this.sqlite
      .prepare(
        "SELECT * FROM kosmora_drive_spool_journal WHERE backup_id = ? AND owner_id = ?"
      )
      .get(backupId, ownerId) as
      | {
          backup_id: string;
          owner_id: string;
          sha256: string;
          size_bytes: number;
          spool_path: string;
          status: string;
          attempts: number;
        }
      | undefined;

    if (!row) {
      throw new Error("SPOOL_BACKUP_NOT_FOUND");
    }
    if (!existsSync(row.spool_path)) {
      throw new Error("SPOOL_PAYLOAD_MISSING_ON_DISK");
    }

    const payload = readFileSync(row.spool_path);
    const actualSha256 = createHash("sha256").update(payload).digest("hex");
    if (actualSha256 !== row.sha256 || payload.byteLength !== row.size_bytes) {
      throw new Error("SPOOL_PAYLOAD_CORRUPTED");
    }

    const maxAttempts = Math.min(Math.max(retryOptions.maxAttempts ?? 3, 1), 5);
    const baseDelayMs = Math.max(retryOptions.baseDelayMs ?? 25, 5);
    const maxDelayMs = Math.max(retryOptions.maxDelayMs ?? 500, baseDelayMs);

    let lastError: unknown = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const totalAttempts = row.attempts + attempt;
      this.sqlite
        .prepare(
          "UPDATE kosmora_drive_spool_journal SET status = 'uploading', attempts = ?, updated_at = ? WHERE backup_id = ? AND owner_id = ?"
        )
        .run(totalAttempts, new Date().toISOString(), backupId, ownerId);

      try {
        const result = await uploader(payload, actualSha256, totalAttempts);
        this.sqlite
          .prepare(
            `UPDATE kosmora_drive_spool_journal
             SET status = 'completed', drive_file_id = ?, last_error_code = NULL, updated_at = ?
             WHERE backup_id = ? AND owner_id = ?`
          )
          .run(result.driveFileId, new Date().toISOString(), backupId, ownerId);

        // Remove local spool file once confirmed uploaded to Google Drive
        try {
          unlinkSync(row.spool_path);
        } catch {
          // ignore if already removed
        }

        return {
          driveFileId: result.driveFileId,
          attemptsUsed: totalAttempts,
          sha256: actualSha256
        };
      } catch (err) {
        lastError = err;
        const errCode =
          err && typeof err === "object" && "code" in err
            ? String((err as { code?: unknown }).code)
            : "UPLOAD_ERROR";

        this.sqlite
          .prepare(
            `UPDATE kosmora_drive_spool_journal
             SET status = 'failed', last_error_code = ?, updated_at = ?
             WHERE backup_id = ? AND owner_id = ?`
          )
          .run(errCode, new Date().toISOString(), backupId, ownerId);

        if (!isTransientDriveError(err) || attempt === maxAttempts) {
          throw err;
        }

        const backoff = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, attempt - 1));
        await new Promise((resolveDelay) => setTimeout(resolveDelay, backoff));
      }
    }

    throw lastError ?? new Error("UPLOAD_FAILED");
  }

  /**
   * Prunes old completed backups beyond `maxRetainedBackups` (skipping pinned backups)
   * and cleans up orphaned spool files.
   */
  async enforceQuotaAndPruneOldArchives(
    ownerId: string,
    deleteRemoteFile?: (driveFileId: string) => Promise<void>
  ): Promise<QuotaAndRetentionResult> {
    const completedRows = this.sqlite
      .prepare(
        `SELECT backup_id, drive_file_id, spool_path, pinned, created_at
         FROM kosmora_drive_spool_journal
         WHERE owner_id = ? AND status = 'completed'
         ORDER BY created_at DESC, backup_id DESC`
      )
      .all(ownerId) as Array<{
      backup_id: string;
      drive_file_id: string | null;
      spool_path: string;
      pinned: number;
      created_at: string;
    }>;

    const prunedDriveBackups: string[] = [];
    let prunedSpoolFiles = 0;
    let unpinnedSeen = 0;

    for (const row of completedRows) {
      if (row.pinned === 1) continue;
      unpinnedSeen++;
      if (unpinnedSeen <= this.maxRetainedBackups) continue;

      if (row.drive_file_id && deleteRemoteFile) {
        await deleteRemoteFile(row.drive_file_id);
      }
      if (existsSync(row.spool_path)) {
        try {
          unlinkSync(row.spool_path);
          prunedSpoolFiles++;
        } catch {
          // ignore
        }
      }
      this.sqlite
        .prepare(
          "UPDATE kosmora_drive_spool_journal SET status = 'purged', updated_at = ? WHERE backup_id = ? AND owner_id = ?"
        )
        .run(new Date().toISOString(), row.backup_id, ownerId);
      prunedDriveBackups.push(row.backup_id);
    }

    return {
      prunedSpoolFiles,
      prunedDriveBackups,
      activeSpoolBytes: this.getOwnerActiveSpoolBytes(ownerId)
    };
  }

  /**
   * Restores a backed-up chat conversation into a brand-new isolated chat (`restore into a new chat`)
   * without overwriting or mutating the original chat ID even if it still exists on the server.
   */
  restoreArchiveIntoNewChat(options: {
    ownerId: string;
    backupId: string;
    expectedSha256: string;
    archiveJsonBytes: Buffer;
  }): RestoredNewChatResult {
    const actualSha256 = createHash("sha256").update(options.archiveJsonBytes).digest("hex");
    if (actualSha256 !== options.expectedSha256) {
      throw new Error("ARCHIVE_RESTORE_SHA256_MISMATCH");
    }

    const parsed = JSON.parse(options.archiveJsonBytes.toString("utf8")) as {
      ownerId: string;
      chat: { id: string; title: string; created_at?: string };
      messages: Array<{
        id: string;
        role: "user" | "assistant";
        content: string;
        content_type?: string;
        created_at?: string;
      }>;
    };

    if (parsed.ownerId !== options.ownerId) {
      throw new Error("ARCHIVE_OWNER_MISMATCH");
    }

    const newChatId = `chat-restored-${randomUUID()}`;
    const now = new Date().toISOString();
    const dateShort = now.slice(0, 10);
    const newTitle = `${parsed.chat.title} (восстановлено из Drive ${dateShort})`;

    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      this.sqlite
        .prepare(
          `INSERT INTO general_chats (id, owner_id, title, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?)`
        )
        .run(newChatId, options.ownerId, newTitle, now, now);

      const insertMsg = this.sqlite.prepare(
        `INSERT INTO general_chat_messages (
          id, chat_id, owner_id, role, content_type, content, status,
          client_message_id, run_id, error_code, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'completed', ?, NULL, NULL, ?, ?)`
      );

      let restoredMessagesCount = 0;
      for (const m of parsed.messages) {
        const newMsgId = `msg-restored-${randomUUID()}`;
        const msgCreated = m.created_at ?? now;
        insertMsg.run(
          newMsgId,
          newChatId,
          options.ownerId,
          m.role,
          m.content_type ?? "text",
          m.content,
          `drive-restore:${options.backupId}:${m.id}`,
          msgCreated,
          now
        );
        restoredMessagesCount++;
      }

      this.sqlite.exec("COMMIT");
      return {
        newChatId,
        originalChatId: parsed.chat.id,
        ownerId: options.ownerId,
        title: newTitle,
        restoredMessagesCount,
        provenanceBackupId: options.backupId,
        provenanceSha256: actualSha256
      };
    } catch (err) {
      try {
        this.sqlite.exec("ROLLBACK");
      } catch {
        // ignore
      }
      throw err;
    }
  }

  purgeOwnerSpool(ownerId: string): void {
    const dir = this.ownerSpoolDir(ownerId);
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
    this.sqlite
      .prepare("DELETE FROM kosmora_drive_spool_journal WHERE owner_id = ?")
      .run(ownerId);
  }
}
