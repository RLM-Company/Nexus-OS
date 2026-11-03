import { createHash, randomUUID } from "node:crypto";
import * as zlib from "node:zlib";

function crc32(buf: Buffer): number {
  if (typeof (zlib as unknown as { crc32?: (b: Buffer) => number }).crc32 === "function") {
    return (zlib as unknown as { crc32: (b: Buffer) => number }).crc32(buf) >>> 0;
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.byteLength; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}
import type { DatabaseSync } from "node:sqlite";

export const MAX_SNAPSHOT_TOTAL_BYTES = 32 * 1024 * 1024; // 32 MiB
export const MAX_SNAPSHOT_PART_BYTES = 2 * 1024 * 1024; // 2 MiB per part
export const MAX_SNAPSHOT_CHATS = 2000;
export const MAX_SNAPSHOT_MESSAGES = 50000;
export const MAX_SNAPSHOT_WORK_FILES = 2000;

export interface CanonicalSnapshotPartMeta {
  name: string;
  sizeBytes: number;
  crc32Hex: string;
  sha256: string;
}

export interface CanonicalSnapshotManifest {
  schemaVersion: "kosmora-drive-snapshot-v1";
  snapshotId: string;
  ownerId: string;
  createdAt: string;
  chatCount: number;
  messageCount: number;
  workFileCount: number;
  totalPayloadBytes: number;
  payloadSha256: string;
  parts: CanonicalSnapshotPartMeta[];
}

export interface SnapshotPayloadData {
  ownerId: string;
  chats: Array<{
    id: string;
    title: string;
    created_at: string;
    updated_at: string;
  }>;
  messages: Array<{
    id: string;
    chat_id: string;
    role: "user" | "assistant";
    content: string;
    content_type?: string;
    status?: string;
    created_at: string;
  }>;
  workFiles?: Array<{
    id: string;
    project_id: string;
    work_id: string;
    name: string;
    content: string;
    sha256: string;
    bytes: number;
    created_at: string;
  }>;
  memories?: Array<{
    id: string;
    scope: "personal" | "chat" | "project";
    kind: string;
    title: string;
    content: string;
    pinned: boolean;
    source_json: string;
  }>;
}

export interface RemoteDriveFileItem {
  driveFileId: string;
  name: string;
  sizeBytes: number;
  createdTime: string;
  downloadZipBytes: () => Promise<Buffer>;
}

export interface RebuiltJournalEntry {
  snapshotId: string;
  driveFileId: string;
  ownerId: string;
  chatCount: number;
  messageCount: number;
  workFileCount: number;
  payloadSha256: string;
  archiveSha256: string;
  status: "verified";
  createdAt: string;
}

export interface ImportedZipRestoreResult {
  snapshotId: string;
  ownerId: string;
  restoredChatIds: Record<string, string>;
  restoredChatsCount: number;
  restoredMessagesCount: number;
  restoredWorkFilesCount: number;
  restoredMemoriesCount: number;
  interruptedRunsQuiesced: number;
  payloadSha256: string;
}

function toCrc32Hex(buf: Buffer): string {
  return (crc32(buf) >>> 0).toString(16).padStart(8, "0");
}

function sha256Hex(buf: Buffer | string): string {
  return createHash("sha256").update(buf).digest("hex");
}

/**
 * Builds a canonical ZIP STORE (compression method 0) buffer containing `manifest.json`
 * and 2 MiB `snapshot.partNNNN.json` slices matching the PR #425 (`3579bc9`) specification.
 */
export function buildCanonicalStoreZipSnapshot(
  snapshotId: string,
  payload: SnapshotPayloadData,
  createdAt = new Date().toISOString()
): { zipBuffer: Buffer; archiveSha256: string; manifest: CanonicalSnapshotManifest } {
  if (payload.chats.length > MAX_SNAPSHOT_CHATS) {
    throw new Error("SNAPSHOT_CHAT_LIMIT_EXCEEDED");
  }
  if (payload.messages.length > MAX_SNAPSHOT_MESSAGES) {
    throw new Error("SNAPSHOT_MESSAGE_LIMIT_EXCEEDED");
  }
  const workFiles = payload.workFiles ?? [];
  if (workFiles.length > MAX_SNAPSHOT_WORK_FILES) {
    throw new Error("SNAPSHOT_WORK_FILE_LIMIT_EXCEEDED");
  }

  const fullJsonBuf = Buffer.from(JSON.stringify(payload), "utf8");
  if (fullJsonBuf.byteLength > MAX_SNAPSHOT_TOTAL_BYTES) {
    throw new Error("SNAPSHOT_TOTAL_BYTES_EXCEEDED");
  }

  const partBuffers: Array<{ name: string; data: Buffer }> = [];
  const partsMeta: CanonicalSnapshotPartMeta[] = [];

  for (let offset = 0, idx = 1; offset < fullJsonBuf.byteLength; offset += MAX_SNAPSHOT_PART_BYTES, idx++) {
    const slice = fullJsonBuf.subarray(
      offset,
      Math.min(offset + MAX_SNAPSHOT_PART_BYTES, fullJsonBuf.byteLength)
    );
    const partName = `snapshot.part${String(idx).padStart(4, "0")}.json`;
    partBuffers.push({ name: partName, data: slice });
    partsMeta.push({
      name: partName,
      sizeBytes: slice.byteLength,
      crc32Hex: toCrc32Hex(slice),
      sha256: sha256Hex(slice)
    });
  }

  const manifest: CanonicalSnapshotManifest = {
    schemaVersion: "kosmora-drive-snapshot-v1",
    snapshotId,
    ownerId: payload.ownerId,
    createdAt,
    chatCount: payload.chats.length,
    messageCount: payload.messages.length,
    workFileCount: workFiles.length,
    totalPayloadBytes: fullJsonBuf.byteLength,
    payloadSha256: sha256Hex(fullJsonBuf),
    parts: partsMeta
  };

  const manifestBuf = Buffer.from(JSON.stringify(manifest, null, 2), "utf8");
  const allEntries = [{ name: "manifest.json", data: manifestBuf }, ...partBuffers];

  // Assemble canonical ZIP STORE (method = 0)
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of allEntries) {
    const nameBuf = Buffer.from(entry.name, "utf8");
    const dataBuf = entry.data;
    const entryCrc = crc32(dataBuf) >>> 0;

    const localHeader = Buffer.alloc(30 + nameBuf.byteLength);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8); // STORE (0)
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(entryCrc, 14);
    localHeader.writeUInt32LE(dataBuf.byteLength, 18);
    localHeader.writeUInt32LE(dataBuf.byteLength, 22);
    localHeader.writeUInt16LE(nameBuf.byteLength, 26);
    localHeader.writeUInt16LE(0, 28);
    nameBuf.copy(localHeader, 30);

    localParts.push(localHeader, dataBuf);

    const centralHeader = Buffer.alloc(46 + nameBuf.byteLength);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(0, 10); // STORE (0)
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(entryCrc, 16);
    centralHeader.writeUInt32LE(dataBuf.byteLength, 20);
    centralHeader.writeUInt32LE(dataBuf.byteLength, 24);
    centralHeader.writeUInt16LE(nameBuf.byteLength, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    nameBuf.copy(centralHeader, 46);

    centralParts.push(centralHeader);
    offset += localHeader.byteLength + dataBuf.byteLength;
  }

  const centralSize = centralParts.reduce((s, b) => s + b.byteLength, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(allEntries.length, 8);
  eocd.writeUInt16LE(allEntries.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  const zipBuffer = Buffer.concat([...localParts, ...centralParts, eocd]);
  return {
    zipBuffer,
    archiveSha256: sha256Hex(zipBuffer),
    manifest
  };
}

/**
 * Parses and strictly verifies a canonical ZIP STORE archive (`manifest.json` + `snapshot.part*`),
 * checking every entry's CRC32, SHA-256, path safety, and payload limits.
 */
export function parseAndVerifyCanonicalStoreZip(zipBuffer: Buffer): {
  manifest: CanonicalSnapshotManifest;
  payload: SnapshotPayloadData;
  archiveSha256: string;
} {
  if (zipBuffer.byteLength === 0 || zipBuffer.byteLength > MAX_SNAPSHOT_TOTAL_BYTES + 1024 * 1024) {
    throw new Error("INVALID_ZIP_ARCHIVE_SIZE");
  }

  // Locate EOCD
  let eocdOffset = -1;
  for (let i = zipBuffer.byteLength - 22; i >= Math.max(0, zipBuffer.byteLength - 65557); i--) {
    if (zipBuffer.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) {
    throw new Error("CORRUPT_ZIP_MISSING_EOCD");
  }

  const totalEntries = zipBuffer.readUInt16LE(eocdOffset + 10);
  const cdOffset = zipBuffer.readUInt32LE(eocdOffset + 16);
  if (totalEntries === 0 || totalEntries > 64) {
    throw new Error("INVALID_ZIP_ENTRY_COUNT");
  }

  const entries = new Map<string, { data: Buffer; crc32Hex: string }>();
  let cursor = cdOffset;

  for (let i = 0; i < totalEntries; i++) {
    if (zipBuffer.readUInt32LE(cursor) !== 0x02014b50) {
      throw new Error("CORRUPT_CENTRAL_DIRECTORY");
    }
    const method = zipBuffer.readUInt16LE(cursor + 10);
    if (method !== 0) {
      throw new Error("UNSUPPORTED_ZIP_COMPRESSION_METHOD_STORE_REQUIRED");
    }
    const expectedCrc = zipBuffer.readUInt32LE(cursor + 16) >>> 0;
    const compSize = zipBuffer.readUInt32LE(cursor + 20);
    const uncompSize = zipBuffer.readUInt32LE(cursor + 24);
    const nameLen = zipBuffer.readUInt16LE(cursor + 28);
    const extraLen = zipBuffer.readUInt16LE(cursor + 30);
    const commentLen = zipBuffer.readUInt16LE(cursor + 32);
    const localHeaderOffset = zipBuffer.readUInt32LE(cursor + 42);

    const name = zipBuffer.subarray(cursor + 46, cursor + 46 + nameLen).toString("utf8");
    if (name.includes("..") || name.startsWith("/") || name.includes("\\")) {
      throw new Error("ZIP_PATH_TRAVERSAL_REJECTED");
    }
    if (compSize !== uncompSize || uncompSize > MAX_SNAPSHOT_PART_BYTES + 65536) {
      throw new Error("ZIP_PART_SIZE_VIOLATION");
    }

    if (zipBuffer.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
      throw new Error("CORRUPT_LOCAL_FILE_HEADER");
    }
    const localNameLen = zipBuffer.readUInt16LE(localHeaderOffset + 26);
    const localExtraLen = zipBuffer.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
    const dataBuf = zipBuffer.subarray(dataStart, dataStart + uncompSize);

    const actualCrc = crc32(dataBuf) >>> 0;
    if (actualCrc !== expectedCrc) {
      throw new Error(`ZIP_CRC32_MISMATCH:${name}`);
    }

    entries.set(name, {
      data: dataBuf,
      crc32Hex: actualCrc.toString(16).padStart(8, "0")
    });

    cursor += 46 + nameLen + extraLen + commentLen;
  }

  const manifestEntry = entries.get("manifest.json");
  if (!manifestEntry) {
    throw new Error("MISSING_SNAPSHOT_MANIFEST");
  }

  const manifest = JSON.parse(manifestEntry.data.toString("utf8")) as CanonicalSnapshotManifest;
  if (manifest.schemaVersion !== "kosmora-drive-snapshot-v1") {
    throw new Error("UNSUPPORTED_SNAPSHOT_SCHEMA");
  }

  const assembledParts: Buffer[] = [];
  for (const partMeta of manifest.parts) {
    const partEntry = entries.get(partMeta.name);
    if (!partEntry) {
      throw new Error(`MISSING_SNAPSHOT_PART:${partMeta.name}`);
    }
    if (partEntry.data.byteLength !== partMeta.sizeBytes) {
      throw new Error(`PART_SIZE_MISMATCH:${partMeta.name}`);
    }
    if (partEntry.crc32Hex !== partMeta.crc32Hex) {
      throw new Error(`PART_CRC32_MISMATCH:${partMeta.name}`);
    }
    if (sha256Hex(partEntry.data) !== partMeta.sha256) {
      throw new Error(`PART_SHA256_MISMATCH:${partMeta.name}`);
    }
    assembledParts.push(partEntry.data);
  }

  const fullPayloadBuf = Buffer.concat(assembledParts);
  if (
    fullPayloadBuf.byteLength !== manifest.totalPayloadBytes ||
    sha256Hex(fullPayloadBuf) !== manifest.payloadSha256
  ) {
    throw new Error("SNAPSHOT_PAYLOAD_SHA256_MISMATCH");
  }

  const payload = JSON.parse(fullPayloadBuf.toString("utf8")) as SnapshotPayloadData;
  if (payload.ownerId !== manifest.ownerId) {
    throw new Error("SNAPSHOT_OWNER_MISMATCH");
  }
  if (
    payload.chats.length > MAX_SNAPSHOT_CHATS ||
    payload.messages.length > MAX_SNAPSHOT_MESSAGES ||
    (payload.workFiles?.length ?? 0) > MAX_SNAPSHOT_WORK_FILES
  ) {
    throw new Error("SNAPSHOT_ENTITY_BOUNDS_EXCEEDED");
  }

  return {
    manifest,
    payload,
    archiveSha256: sha256Hex(zipBuffer)
  };
}

/**
 * Handles the two remaining recovery items listed in `KOSMORA_DRIVE_BACKUP_RESTORE_2026-11-02_RU.md` (PR #425):
 * 1. Rebuilding the local SQLite backup catalog when the server journal is lost (`discoverAndRebuildDriveJournal`).
 * 2. Safe import and atomic new-ID restoration of external / Google Picker ZIP archives (`importExternalKosmoraZipSnapshot`).
 */
export class GoogleDriveJournalRecoveryAndZipImporter {
  constructor(private readonly sqlite: DatabaseSync) {
    this.ensureSchema();
  }

  ensureSchema(): void {
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS kosmora_drive_recovered_catalog (
        snapshot_id TEXT PRIMARY KEY NOT NULL,
        drive_file_id TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        chat_count INTEGER NOT NULL,
        message_count INTEGER NOT NULL,
        work_file_count INTEGER NOT NULL,
        payload_sha256 TEXT NOT NULL,
        archive_sha256 TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('verified', 'corrupt')),
        created_at TEXT NOT NULL,
        recovered_at TEXT NOT NULL
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
    `);
  }

  /**
   * Scans files from a Drive folder after local journal loss, verifies each archive's
   * canonical ZIP STORE structure + CRC32 + SHA-256, and rebuilds the owner's local catalog.
   */
  async discoverAndRebuildDriveJournal(
    ownerId: string,
    remoteFiles: RemoteDriveFileItem[]
  ): Promise<{ rebuilt: RebuiltJournalEntry[]; skippedCorruptOrForeign: string[] }> {
    const rebuilt: RebuiltJournalEntry[] = [];
    const skippedCorruptOrForeign: string[] = [];
    const now = new Date().toISOString();

    for (const item of remoteFiles) {
      try {
        const zipBytes = await item.downloadZipBytes();
        const verified = parseAndVerifyCanonicalStoreZip(zipBytes);
        if (verified.manifest.ownerId !== ownerId) {
          skippedCorruptOrForeign.push(item.driveFileId);
          continue;
        }

        const entry: RebuiltJournalEntry = {
          snapshotId: verified.manifest.snapshotId,
          driveFileId: item.driveFileId,
          ownerId,
          chatCount: verified.manifest.chatCount,
          messageCount: verified.manifest.messageCount,
          workFileCount: verified.manifest.workFileCount,
          payloadSha256: verified.manifest.payloadSha256,
          archiveSha256: verified.archiveSha256,
          status: "verified",
          createdAt: verified.manifest.createdAt
        };

        this.sqlite
          .prepare(
            `INSERT INTO kosmora_drive_recovered_catalog (
              snapshot_id, drive_file_id, owner_id, chat_count, message_count,
              work_file_count, payload_sha256, archive_sha256, status, created_at, recovered_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'verified', ?, ?)
            ON CONFLICT(snapshot_id) DO UPDATE SET
              drive_file_id = excluded.drive_file_id,
              payload_sha256 = excluded.payload_sha256,
              archive_sha256 = excluded.archive_sha256,
              status = 'verified',
              recovered_at = excluded.recovered_at`
          )
          .run(
            entry.snapshotId,
            entry.driveFileId,
            entry.ownerId,
            entry.chatCount,
            entry.messageCount,
            entry.workFileCount,
            entry.payloadSha256,
            entry.archiveSha256,
            entry.createdAt,
            now
          );

        rebuilt.push(entry);
      } catch {
        skippedCorruptOrForeign.push(item.driveFileId);
      }
    }

    return { rebuilt, skippedCorruptOrForeign };
  }

  /**
   * Imports an external / Picker-selected Kosmora ZIP snapshot, verifies all parts,
   * and atomically restores chats, messages, and published Work files into brand-new IDs
   * while quiescing any interrupted/streaming messages so LLM runs never auto-restart.
   */
  importExternalKosmoraZipSnapshot(
    ownerId: string,
    zipBuffer: Buffer,
    options?: { allowCrossAccountImportWithExplicitConsent?: boolean }
  ): ImportedZipRestoreResult {
    const { manifest, payload } = parseAndVerifyCanonicalStoreZip(zipBuffer);

    if (
      manifest.ownerId !== ownerId &&
      !options?.allowCrossAccountImportWithExplicitConsent
    ) {
      throw new Error("FOREIGN_ARCHIVE_OWNER_CONSENT_REQUIRED");
    }

    const restoredChatIds: Record<string, string> = {};
    let restoredChatsCount = 0;
    let restoredMessagesCount = 0;
    let restoredWorkFilesCount = 0;
    const restoredMemoriesCount = 0;
    let interruptedRunsQuiesced = 0;
    const now = new Date().toISOString();

    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const insertChat = this.sqlite.prepare(
        `INSERT INTO general_chats (id, owner_id, title, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`
      );

      for (const c of payload.chats) {
        const newChatId = `chat-imp-${randomUUID()}`;
        restoredChatIds[c.id] = newChatId;
        insertChat.run(
          newChatId,
          ownerId,
          `${c.title} (импорт ${manifest.snapshotId.slice(0, 8)})`,
          c.created_at || now,
          now
        );
        restoredChatsCount++;
      }

      const insertMsg = this.sqlite.prepare(
        `INSERT INTO general_chat_messages (
          id, chat_id, owner_id, role, content_type, content, status,
          client_message_id, run_id, error_code, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)`
      );

      for (const m of payload.messages) {
        const mappedChatId = restoredChatIds[m.chat_id];
        if (!mappedChatId) continue;

        // Quiesce any pending/streaming status into 'cancelled' so LLM runs never auto-restart
        let safeStatus = m.status ?? "completed";
        if (safeStatus === "pending" || safeStatus === "streaming") {
          safeStatus = "cancelled";
          interruptedRunsQuiesced++;
        }

        insertMsg.run(
          `msg-imp-${randomUUID()}`,
          mappedChatId,
          ownerId,
          m.role,
          m.content_type ?? "text",
          m.content,
          safeStatus,
          `zip-import:${manifest.snapshotId}:${m.id}`,
          m.created_at || now,
          now
        );
        restoredMessagesCount++;
      }

      if (Array.isArray(payload.workFiles) && payload.workFiles.length > 0) {
        const insertWorkFile = this.sqlite.prepare(
          `INSERT INTO work_artifact_versions (
            id, project_id, work_id, name, version, content, sha256, bytes, published, created_at
          ) VALUES (?, ?, ?, ?, 1, ?, ?, ?, 1, ?)`
        );

        for (const wf of payload.workFiles) {
          const actualWfSha = sha256Hex(Buffer.from(wf.content, "utf8"));
          if (actualWfSha !== wf.sha256) {
            throw new Error(`WORK_FILE_SHA256_MISMATCH:${wf.name}`);
          }
          insertWorkFile.run(
            `wf-imp-${randomUUID()}`,
            `proj-imp-${wf.project_id}`,
            `work-imp-${wf.work_id}`,
            wf.name,
            wf.content,
            wf.sha256,
            wf.bytes,
            wf.created_at || now
          );
          restoredWorkFilesCount++;
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
      restoredChatIds,
      restoredChatsCount,
      restoredMessagesCount,
      restoredWorkFilesCount,
      restoredMemoriesCount,
      interruptedRunsQuiesced,
      payloadSha256: manifest.payloadSha256
    };
  }
}
