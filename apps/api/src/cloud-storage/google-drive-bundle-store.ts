import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { DriveContext } from "./google-drive-store.js";
import type { DrivePayloadCipher } from "./google-drive-payload-cipher.js";
import { DriveStorageError } from "./google-drive.js";
import {
  listDriveResultSources,
  parseSnapshot,
  SNAPSHOT_CHUNK_BYTES,
  snapshotHash,
  snapshotPreview,
  type SnapshotSelection
} from "./google-drive-snapshot.js";
import type { PrivacySection, OriginalBinary } from "../account-settings/privacy/coordinator.js";

export type BundleRow = {
  id: string;
  owner_id: string;
  connection_id: string;
  operation_id: string;
  selection_sha: string;
  bytes: number;
  sha256: string;
  part_count: number;
  parts_json: string;
  preview_json: string;
  payload: Uint8Array | null;
  state: "prepared" | "uploading" | "uncertain" | "verified" | "discarded";
  preview_token: string | null;
  preview_until: number | null;
  preview_epoch: number | null;
  preview_connection: string | null;
  created_at: string;
  updated_at: string;
};
export type RestoreResult = {
  id: string;
  chats: { id: string; title: string }[];
  files: { id: string; name: string }[];
};
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const columns =
  "id,owner_id,connection_id,operation_id,selection_sha,bytes,sha256,part_count,parts_json,preview_json,state,preview_token,preview_until,preview_epoch,preview_connection,created_at,updated_at";
/** Legacy rows without file_ids keep the previous hash. A new explicit file
 * selection is part of the operation identity and cannot reuse another bundle.
 */
export const selectionHash = (s: SnapshotSelection) =>
  hash(
    JSON.stringify(
      s.file_ids === undefined
        ? { ids: s.chat_ids ? [...s.chat_ids].sort() : null, results: s.include_results }
        : {
            ids: s.chat_ids ? [...s.chat_ids].sort() : null,
            files: [...s.file_ids].sort(),
            results: s.include_results
          }
    )
  );
export const bundleView = (r: BundleRow) => ({
  id: r.id,
  state: r.state,
  bytes: r.bytes,
  parts: r.part_count,
  saved_parts: (JSON.parse(r.parts_json) as (string | null)[]).filter(Boolean).length,
  preview: JSON.parse(r.preview_json) as ReturnType<typeof snapshotPreview>,
  created_at: r.created_at,
  can_retry: Boolean(r.payload && r.state !== "discarded" && r.state !== "verified"),
  has_preview: Boolean(r.payload && r.preview_token)
});

export class GoogleDriveBundleStore {
  constructor(
    readonly db: DatabaseSync,
    private readonly cipher?: DrivePayloadCipher,
    private readonly now = Date.now
  ) {}
  private transaction<T>(job: () => T) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const value = job();
      this.db.exec("COMMIT");
      return value;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  assertContext(c: DriveContext) {
    const life = this.db
      .prepare("SELECT state,epoch FROM kosmora_owner_data_lifecycle WHERE owner_id=?")
      .get(c.ownerId) as { state: string; epoch: number } | undefined;
    if ((life?.state ?? "active") !== "active" || (life?.epoch ?? 0) !== c.epoch)
      throw new DriveStorageError("OWNER_DATA_FENCED");
    if (
      !this.db
        .prepare("SELECT 1 FROM kosmora_drive_connections WHERE owner_id=? AND connection_id=?")
        .get(c.ownerId, c.connectionId)
    )
      throw new DriveStorageError("DRIVE_CONNECTION_CHANGED");
  }
  get(owner: string, id: string, withPayload = false): BundleRow {
    const row = this.db
      .prepare(
        `SELECT ${columns},${withPayload ? "payload" : "CASE WHEN payload IS NULL THEN NULL ELSE x'01' END AS payload"} FROM drive_snapshots WHERE owner_id=? AND id=?`
      )
      .get(owner, id) as BundleRow | undefined;
    if (!row) throw new DriveStorageError("BACKUP_NOT_FOUND");
    return row;
  }
  find(owner: string, operation: string): BundleRow | null {
    return (
      (this.db
        .prepare(
          `SELECT ${columns},CASE WHEN payload IS NULL THEN NULL ELSE x'01' END AS payload FROM drive_snapshots WHERE owner_id=? AND operation_id=?`
        )
        .get(owner, operation) as BundleRow | undefined) ?? null
    );
  }
  list(owner: string, offset = 0) {
    if (!Number.isInteger(offset) || offset < 0 || offset > 1000)
      throw new DriveStorageError("BACKUP_INVALID");
    return (
      this.db
        .prepare(
          `SELECT ${columns},CASE WHEN payload IS NULL THEN NULL ELSE x'01' END AS payload FROM drive_snapshots WHERE owner_id=? ORDER BY created_at DESC,id LIMIT 100 OFFSET ?`
        )
        .all(owner, offset) as BundleRow[]
    ).map(bundleView);
  }
  sources(owner: string) {
    const chats = this.db
      .prepare(
        "SELECT id,title,mode FROM general_chats WHERE owner_id=? AND mode IN ('kosmora','work') ORDER BY updated_at DESC LIMIT 2000"
      )
      .all(owner);
    const files = listDriveResultSources(this.db, owner, false).map((s) => ({
      id: s.id,
      name: s.name,
      project: s.project,
      version: s.version,
      bytes: s.bytes,
      sha256: s.sha256,
      kind: s.kind
    }));
    // Keep the legacy chat list for clients already loaded before this update.
    return { items: chats, chats, files, file_selection: true };
  }
  counts(owner: string): { total: number; pending: number } {
    return this.db
      .prepare(
        "SELECT count(*) AS total,coalesce(sum(CASE WHEN state NOT IN ('verified','discarded') THEN 1 ELSE 0 END),0) AS pending FROM drive_snapshots WHERE owner_id=?"
      )
      .get(owner) as { total: number; pending: number };
  }
  private encrypt(owner: string, id: string, payload: Buffer) {
    if (!this.cipher) throw new DriveStorageError("DRIVE_KEY_CONFIGURATION_REQUIRED");
    this.db
      .prepare(
        "UPDATE drive_snapshots SET payload=NULL,preview_token=NULL,preview_until=NULL WHERE state='verified' AND preview_until<=? AND NOT EXISTS(SELECT 1 FROM kosmora_owner_data_lifecycle l WHERE l.owner_id=drive_snapshots.owner_id AND l.state<>'active')"
      )
      .run(this.now());
    const encrypted = this.cipher.seal(owner, id, payload);
    const used = this.db
      .prepare("SELECT coalesce(sum(length(payload)),0) AS bytes FROM drive_snapshots WHERE id<>?")
      .get(id) as { bytes: number };
    if (used.bytes + encrypted.length > 64 * 1024 * 1024)
      throw new DriveStorageError("BACKUP_CACHE_FULL");
    return encrypted;
  }
  create(
    c: DriveContext,
    operation: string,
    selection: SnapshotSelection,
    payload: Buffer
  ): BundleRow {
    const parsed = parseSnapshot(payload);
    return this.transaction(() => {
      this.assertContext(c);
      if (this.find(c.ownerId, operation)) throw new DriveStorageError("DRIVE_OPERATION_CONFLICT");
      const count = this.db
        .prepare("SELECT count(*) AS n FROM drive_snapshots WHERE owner_id=?")
        .get(c.ownerId) as { n: number };
      if (count.n >= 1000) throw new DriveStorageError("BACKUP_JOURNAL_FULL");
      const id = randomUUID(),
        at = new Date(this.now()).toISOString(),
        encrypted = this.encrypt(c.ownerId, id, payload);
      const parts = Math.ceil(payload.length / SNAPSHOT_CHUNK_BYTES);
      this.db
        .prepare(
          "INSERT INTO drive_snapshots(id,owner_id,connection_id,operation_id,selection_sha,bytes,sha256,part_count,parts_json,preview_json,payload,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,'prepared',?,?)"
        )
        .run(
          id,
          c.ownerId,
          c.connectionId,
          operation,
          selectionHash(selection),
          payload.length,
          snapshotHash(payload),
          parts,
          JSON.stringify(Array.from({ length: parts }, () => null)),
          JSON.stringify(snapshotPreview(parsed)),
          encrypted,
          at,
          at
        );
      return this.get(c.ownerId, id);
    });
  }
  payload(owner: string, id: string): Buffer {
    const row = this.get(owner, id, true);
    if (!row.payload || !this.cipher) throw new DriveStorageError("BACKUP_CACHE_UNAVAILABLE");
    const bytes = this.cipher.open(owner, id, row.payload);
    if (bytes.length !== row.bytes || snapshotHash(bytes) !== row.sha256)
      throw new DriveStorageError("BACKUP_CACHE_UNREADABLE");
    return bytes;
  }
  progress(
    c: DriveContext,
    id: string,
    parts: (string | null)[],
    state: BundleRow["state"]
  ): BundleRow {
    return this.transaction(() => {
      this.assertContext(c);
      const row = this.get(c.ownerId, id);
      if (
        row.state === "discarded" ||
        parts.length !== row.part_count ||
        new Set(parts.filter(Boolean)).size !== parts.filter(Boolean).length
      )
        throw new DriveStorageError("BACKUP_INVALID");
      if (state === "verified")
        for (const part of parts) {
          if (
            !part ||
            !this.db
              .prepare(
                "SELECT 1 FROM kosmora_drive_archives WHERE id=? AND owner_id=? AND state='verified'"
              )
              .get(part, c.ownerId)
          )
            throw new DriveStorageError("BACKUP_INCOMPLETE");
        }
      this.db
        .prepare(
          "UPDATE drive_snapshots SET parts_json=?,state=?,payload=CASE WHEN ?='verified' THEN NULL ELSE payload END,updated_at=? WHERE id=? AND owner_id=?"
        )
        .run(
          JSON.stringify(parts),
          state,
          state,
          new Date(this.now()).toISOString(),
          id,
          c.ownerId
        );
      return this.get(c.ownerId, id);
    });
  }
  partReceipt(row: BundleRow, index: number): string | null {
    return (
      (
        this.db
          .prepare(
            "SELECT id FROM kosmora_drive_archives WHERE owner_id=? AND connection_id=? AND operation_id=?"
          )
          .get(row.owner_id, row.connection_id, `${row.id}_${index}`) as { id: string } | undefined
      )?.id ?? null
    );
  }
  preview(c: DriveContext, id: string, payload: Buffer) {
    const parsed = parseSnapshot(payload);
    return this.transaction(() => {
      this.assertContext(c);
      const row = this.get(c.ownerId, id);
      if (
        row.state === "discarded" ||
        snapshotHash(payload) !== row.sha256 ||
        payload.length !== row.bytes
      )
        throw new DriveStorageError("BACKUP_INVALID");
      const token = randomBytes(32).toString("base64url"),
        encrypted = this.encrypt(c.ownerId, id, payload);
      this.db
        .prepare(
          "UPDATE drive_snapshots SET payload=?,preview_token=?,preview_until=?,preview_epoch=?,preview_connection=? WHERE id=? AND owner_id=?"
        )
        .run(encrypted, hash(token), this.now() + 600000, c.epoch, c.connectionId, id, c.ownerId);
      return { ...snapshotPreview(parsed), token, expires_at: this.now() + 600000 };
    });
  }
  restore(c: DriveContext, id: string, token: string, operation: string): RestoreResult {
    return this.transaction(() => {
      this.assertContext(c);
      const previous = this.db
        .prepare(
          "SELECT snapshot_id,result_json FROM drive_restores WHERE owner_id=? AND operation_id=?"
        )
        .get(c.ownerId, operation) as { snapshot_id: string; result_json: string } | undefined;
      if (previous) {
        if (previous.snapshot_id !== id) throw new DriveStorageError("DRIVE_OPERATION_CONFLICT");
        return JSON.parse(previous.result_json) as RestoreResult;
      }
      const row = this.get(c.ownerId, id);
      if (
        !row.preview_token ||
        !row.preview_until ||
        row.preview_until <= this.now() ||
        row.preview_epoch !== c.epoch ||
        row.preview_connection !== c.connectionId ||
        !timingSafeEqual(Buffer.from(row.preview_token, "hex"), Buffer.from(hash(token), "hex"))
      )
        throw new DriveStorageError("RESTORE_STALE");
      const snapshot = parseSnapshot(this.payload(c.ownerId, id)),
        at = new Date(this.now()).toISOString();
      const result: RestoreResult = { id: randomUUID(), chats: [], files: [] };
      // No runs, approvals, project instructions, credentials or execution queues are recreated.
      const chatInsert = this.db.prepare(
        "INSERT INTO general_chats(id,owner_id,title,mode,created_at,updated_at) VALUES(?,?,?,?,?,?)"
      );
      const messageInsert = this.db.prepare(
        "INSERT INTO general_chat_messages(id,chat_id,owner_id,role,content_type,content,attachments_json,status,run_id,error_code,created_at,updated_at) VALUES(?,?,?,?,'text',?,?,?,NULL,NULL,?,?)"
      );
      for (const chat of snapshot.chats) {
        const newId = randomUUID(),
          title = `${chat.title.slice(0, 175)} · копия`;
        chatInsert.run(newId, c.ownerId, title, chat.mode, at, at);
        result.chats.push({ id: newId, title });
        for (const m of chat.messages)
          messageInsert.run(
            randomUUID(),
            newId,
            c.ownerId,
            m.role,
            m.content,
            JSON.stringify(m.attachments),
            m.status === "pending" || m.status === "streaming" ? "cancelled" : m.status,
            m.created_at,
            m.updated_at
          );
      }
      for (const f of snapshot.files) result.files.push({ id: randomUUID(), name: f.name });
      this.db
        .prepare(
          "INSERT INTO drive_restores(id,owner_id,snapshot_id,operation_id,result_json,created_at) VALUES(?,?,?,?,?,?)"
        )
        .run(result.id, c.ownerId, id, operation, JSON.stringify(result), at);
      const fileInsert = this.db.prepare(
        "INSERT INTO drive_restored_files(id,restore_id,owner_id,name,source_project,source_version,content,sha256,created_at) VALUES(?,?,?,?,?,?,?,?,?)"
      );
      snapshot.files.forEach((file, i) =>
        fileInsert.run(
          result.files[i]!.id,
          result.id,
          c.ownerId,
          file.name,
          file.project,
          file.version,
          file.content,
          file.sha256,
          at
        )
      );
      this.db
        .prepare(
          "UPDATE drive_snapshots SET preview_token=NULL,preview_until=NULL,payload=NULL WHERE owner_id=? AND id=?"
        )
        .run(c.ownerId, id);
      return result;
    });
  }
  clearLocal(owner: string, id: string, discard: boolean) {
    this.transaction(() => {
      const life = this.db
        .prepare("SELECT state FROM kosmora_owner_data_lifecycle WHERE owner_id=?")
        .get(owner) as { state: string } | undefined;
      if (life && life.state !== "active") throw new DriveStorageError("OWNER_DATA_FENCED");
      this.get(owner, id);
      this.db
        .prepare(
          "UPDATE drive_snapshots SET state=CASE WHEN ?=1 THEN 'discarded' ELSE state END,payload=CASE WHEN ?=1 OR state='verified' THEN NULL ELSE payload END,preview_token=NULL,preview_until=NULL WHERE owner_id=? AND id=?"
        )
        .run(discard ? 1 : 0, discard ? 1 : 0, owner, id);
    });
  }
  files(owner: string, offset = 0) {
    if (!Number.isInteger(offset) || offset < 0 || offset > 1000000)
      throw new DriveStorageError("BACKUP_INVALID");
    return this.db
      .prepare(
        "SELECT id,name,source_project,source_version,restore_id,created_at,length(CAST(content AS BLOB)) AS bytes FROM drive_restored_files WHERE owner_id=? ORDER BY created_at DESC,id LIMIT 200 OFFSET ?"
      )
      .all(owner, offset);
  }
  file(owner: string, id: string) {
    return this.db
      .prepare("SELECT name,content,sha256 FROM drive_restored_files WHERE owner_id=? AND id=?")
      .get(owner, id) as { name: string; content: string; sha256: string } | undefined;
  }
  privacySection(owner: string): PrivacySection {
    const snapshots = this.db
      .prepare(
        `SELECT ${columns},CASE WHEN payload IS NULL THEN NULL ELSE x'01' END AS payload FROM drive_snapshots WHERE owner_id=?`
      )
      .all(owner) as BundleRow[];
    const originals: OriginalBinary[] = [];
    for (const s of snapshots.filter((r) => r.payload)) {
      const bytes = this.payload(owner, s.id);
      for (let index = 0; index < s.part_count; index++) {
        const part = bytes.subarray(
          index * SNAPSHOT_CHUNK_BYTES,
          (index + 1) * SNAPSHOT_CHUNK_BYTES
        );
        originals.push({
          id: `${s.id}:${index}`,
          filename: `snapshot-${s.id}-${index}.bin`,
          content_type: "application/octet-stream",
          size_bytes: part.length,
          sha256: snapshotHash(part)
        });
      }
    }
    return {
      complete: true,
      originals,
      records: {
        snapshots: snapshots.map((r) => ({
          ...bundleView(r),
          sha256: r.sha256,
          parts_json: r.parts_json
        })),
        restores: this.db
          .prepare(
            "SELECT id,snapshot_id,result_json,created_at FROM drive_restores WHERE owner_id=?"
          )
          .all(owner),
        restored_files: this.db
          .prepare(
            "SELECT id,restore_id,name,source_project,source_version,content,sha256,created_at FROM drive_restored_files WHERE owner_id=?"
          )
          .all(owner)
      }
    };
  }
  privacyChunk(owner: string, opaque: string) {
    const match = /^([a-f0-9-]{36}):(\d{1,2})$/.exec(opaque);
    if (!match) return null;
    if (
      !this.db
        .prepare("SELECT 1 FROM drive_snapshots WHERE owner_id=? AND id=?")
        .get(owner, match[1]!)
    )
      return null;
    const row = this.get(owner, match[1]!);
    const index = Number(match[2]);
    if (!row.payload || index >= row.part_count) return null;
    const payload = this.payload(owner, row.id);
    return payload.subarray(index * SNAPSHOT_CHUNK_BYTES, (index + 1) * SNAPSHOT_CHUNK_BYTES);
  }
}
