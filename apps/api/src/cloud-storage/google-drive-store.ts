import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { DRIVE_ARCHIVE_MAX_BYTES, type DriveArchiveReceipt } from "./google-drive.js";
import type { DriveGrant } from "./google-drive-authorization.js";
import type { DriveGrantCipher } from "./google-drive-grant-cipher.js";

export interface Connection {
  owner_id: string;
  revision: number;
  connection_id: string | null;
  grant_ciphertext: string | null;
  grant_version: number;
  folder_id: string | null;
  folder_state: "disconnected" | "reserved" | "creating" | "uncertain" | "ready";
  folder_lease: string | null;
  updated_at: string;
}

export type DriveContext = { ownerId: string; epoch: number; connectionId: string };
export type DriveConnectTicket = { ownerId: string; epoch: number; revision: number };
export type DriveConnectionStatus = Omit<
  Connection,
  "grant_ciphertext" | "folder_lease" | "grant_version"
>;

export type DriveArchive = DriveArchiveReceipt & {
  id: string;
  connectionId: string;
  state: "reserved" | "uploading" | "checking" | "uncertain" | "verified" | "failed";
  createdAt: string;
  updatedAt: string;
};

interface ArchiveRow {
  id: string;
  owner_id: string;
  connection_id: string;
  operation_id: string;
  file_id: string;
  folder_id: string;
  size_bytes: number;
  sha256: string;
  state: DriveArchive["state"];
  lease: string | null;
  created_at: string;
  updated_at: string;
}

const MAX_ACTIVE_QUEUE = 10;
const MAX_TOTAL_RECEIPTS = 1000;
const PAGE_LIMIT = 50;

export class GoogleDriveStore {
  constructor(
    private readonly db: DatabaseSync,
    private readonly cipher?: DriveGrantCipher,
    private readonly now = () => new Date().toISOString()
  ) {}

  private activeEpoch(ownerId: string): number {
    const row = this.db
      .prepare("SELECT epoch, state FROM kosmora_owner_data_lifecycle WHERE owner_id=?")
      .get(ownerId) as { epoch: number; state: string } | undefined;
    if (row && row.state !== "active") {
      throw new Error("OWNER_DATA_FENCED");
    }
    return row ? Number(row.epoch) : 0;
  }

  private mapArchive(row: ArchiveRow): DriveArchive {
    return {
      id: row.id,
      connectionId: row.connection_id,
      operationId: row.operation_id,
      fileId: row.file_id,
      folderId: row.folder_id,
      bytes: Number(row.size_bytes),
      sha256: row.sha256,
      state: row.state,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  status(ownerId: string): DriveConnectionStatus | null {
    const row = this.db
      .prepare(
        "SELECT owner_id, revision, connection_id, folder_id, folder_state, updated_at FROM kosmora_drive_connections WHERE owner_id=?"
      )
      .get(ownerId) as DriveConnectionStatus | undefined;
    return row ? { ...row, revision: Number(row.revision) } : null;
  }

  beginConnect(ownerId: string): DriveConnectTicket {
    const epoch = this.activeEpoch(ownerId);
    const current = this.status(ownerId);
    if (current && current.folder_state !== "disconnected") {
      throw new Error("DRIVE_ALREADY_CONNECTED");
    }
    return {
      ownerId,
      epoch,
      revision: current ? current.revision : 0
    };
  }

  connect(ticket: DriveConnectTicket, grant: DriveGrant, folderId: string): DriveContext {
    if (!this.cipher) throw new Error("DRIVE_KEY_CONFIGURATION_REQUIRED");
    const epoch = this.activeEpoch(ticket.ownerId);
    if (epoch !== ticket.epoch) {
      throw new Error("DRIVE_CONNECT_EXPIRED");
    }
    const connectionId = `drv_conn_${randomUUID()}`;
    const ciphertext = this.cipher.seal(ticket.ownerId, grant);
    const ts = this.now();
    const nextRevision = ticket.revision + 1;

    const existing = this.status(ticket.ownerId);
    if (!existing) {
      if (ticket.revision !== 0) throw new Error("DRIVE_CONNECT_EXPIRED");
      this.db
        .prepare(
          `INSERT INTO kosmora_drive_connections
           (owner_id, revision, connection_id, grant_ciphertext, grant_version, folder_id, folder_state, folder_lease, updated_at)
           VALUES (?, ?, ?, ?, 1, ?, 'uncertain', NULL, ?)`
        )
        .run(ticket.ownerId, nextRevision, connectionId, ciphertext, folderId, ts);
    } else {
      if (existing.revision !== ticket.revision || existing.folder_state !== "disconnected") {
        throw new Error("DRIVE_CONNECT_EXPIRED");
      }
      const res = this.db
        .prepare(
          `UPDATE kosmora_drive_connections
           SET revision=?, connection_id=?, grant_ciphertext=?, grant_version=grant_version+1,
               folder_id=?, folder_state='uncertain', folder_lease=NULL, updated_at=?
           WHERE owner_id=? AND revision=? AND folder_state='disconnected'`
        )
        .run(nextRevision, connectionId, ciphertext, folderId, ts, ticket.ownerId, ticket.revision);
      if (Number(res.changes) !== 1) {
        throw new Error("DRIVE_CONNECT_EXPIRED");
      }
    }

    return {
      ownerId: ticket.ownerId,
      epoch,
      connectionId
    };
  }

  context(ownerId: string): DriveContext {
    const epoch = this.activeEpoch(ownerId);
    const row = this.db
      .prepare(
        "SELECT connection_id, folder_state FROM kosmora_drive_connections WHERE owner_id=?"
      )
      .get(ownerId) as { connection_id: string | null; folder_state: string } | undefined;
    if (!row || !row.connection_id || row.folder_state === "disconnected") {
      throw new Error("DRIVE_NOT_CONNECTED");
    }
    return {
      ownerId,
      epoch,
      connectionId: row.connection_id
    };
  }

  private assertValidContext(context: DriveContext): Connection {
    const epoch = this.activeEpoch(context.ownerId);
    if (epoch !== context.epoch) {
      throw new Error("DRIVE_DISCONNECTED");
    }
    const row = this.db
      .prepare("SELECT * FROM kosmora_drive_connections WHERE owner_id=?")
      .get(context.ownerId) as Connection | undefined;
    if (
      !row ||
      row.folder_state === "disconnected" ||
      row.connection_id !== context.connectionId
    ) {
      throw new Error("DRIVE_DISCONNECTED");
    }
    return row;
  }

  readGrant(context: DriveContext): { grant: DriveGrant; version: number } {
    if (!this.cipher) throw new Error("DRIVE_KEY_CONFIGURATION_REQUIRED");
    const row = this.assertValidContext(context);
    if (!row.grant_ciphertext) throw new Error("DRIVE_DISCONNECTED");
    return {
      grant: this.cipher.open(context.ownerId, row.grant_ciphertext),
      version: Number(row.grant_version)
    };
  }

  refreshGrant(context: DriveContext, expectedVersion: number, grant: DriveGrant): void {
    if (!this.cipher) throw new Error("DRIVE_KEY_CONFIGURATION_REQUIRED");
    this.assertValidContext(context);
    const ciphertext = this.cipher.seal(context.ownerId, grant);
    const res = this.db
      .prepare(
        `UPDATE kosmora_drive_connections
         SET grant_ciphertext=?, grant_version=grant_version+1, updated_at=?
         WHERE owner_id=? AND connection_id=? AND grant_version=?`
      )
      .run(ciphertext, this.now(), context.ownerId, context.connectionId, expectedVersion);
    if (Number(res.changes) !== 1) {
      throw new Error("DRIVE_LEASE_CHANGED");
    }
  }

  disconnect(ownerId: string): void {
    this.activeEpoch(ownerId);
    const ts = this.now();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const existing = this.status(ownerId);
      if (existing) {
        this.db
          .prepare(
            `UPDATE kosmora_drive_connections
             SET revision=revision+1, connection_id=NULL, grant_ciphertext=NULL,
                 folder_id=NULL, folder_state='disconnected', folder_lease=NULL, updated_at=?
             WHERE owner_id=?`
          )
          .run(ts, ownerId);
        this.db
          .prepare(
            `UPDATE kosmora_drive_archives
             SET state='uncertain', lease=NULL, updated_at=?
             WHERE owner_id=? AND state IN ('reserved', 'uploading', 'checking')`
          )
          .run(ts, ownerId);
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  claimFolder(context: DriveContext, explicitRetry = false): { fileId: string; lease: string } {
    const row = this.assertValidContext(context);
    if (row.folder_state === "ready") {
      return { fileId: row.folder_id!, lease: "" };
    }
    if (row.folder_state === "creating") {
      throw new Error("DRIVE_FOLDER_BUSY");
    }
    if (!explicitRetry && row.folder_state !== "uncertain") {
      throw new Error("DRIVE_FOLDER_BUSY");
    }
    const lease = `flease_${randomUUID()}`;
    const res = this.db
      .prepare(
        `UPDATE kosmora_drive_connections
         SET folder_state='creating', folder_lease=?, updated_at=?
         WHERE owner_id=? AND connection_id=? AND folder_state='uncertain'`
      )
      .run(lease, this.now(), context.ownerId, context.connectionId);
    if (Number(res.changes) !== 1) {
      throw new Error("DRIVE_FOLDER_BUSY");
    }
    return { fileId: row.folder_id!, lease };
  }

  finishFolder(context: DriveContext, lease: string, verified: boolean): void {
    this.assertValidContext(context);
    const nextState = verified ? "ready" : "uncertain";
    const res = this.db
      .prepare(
        `UPDATE kosmora_drive_connections
         SET folder_state=?, folder_lease=NULL, updated_at=?
         WHERE owner_id=? AND connection_id=? AND folder_state='creating' AND folder_lease=?`
      )
      .run(nextState, this.now(), context.ownerId, context.connectionId, lease);
    if (Number(res.changes) !== 1) {
      throw new Error("DRIVE_LEASE_CHANGED");
    }
  }

  claimFolderReconciliation(context: DriveContext): { fileId: string; lease: string } {
    return this.claimFolder(context, true);
  }

  reserveArchive(
    context: DriveContext,
    operationId: string,
    fileId: string,
    bytes: Uint8Array
  ): DriveArchive {
    const conn = this.assertValidContext(context);
    if (conn.folder_state !== "ready" || !conn.folder_id) {
      throw new Error("DRIVE_NOT_CONNECTED");
    }
    if (bytes.byteLength < 1 || bytes.byteLength > DRIVE_ARCHIVE_MAX_BYTES) {
      throw new Error("INVALID_DRIVE_RECEIPT");
    }
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const existing = this.findArchive(context, operationId);
    if (existing) {
      if (
        existing.sha256 !== sha256 ||
        existing.bytes !== bytes.byteLength ||
        existing.fileId !== fileId
      ) {
        throw new Error("DRIVE_ARCHIVE_EXISTS");
      }
      return existing;
    }

    const activeCount = (
      this.db
        .prepare(
          `SELECT COUNT(*) AS cnt FROM kosmora_drive_archives
           WHERE owner_id=? AND connection_id=? AND state IN ('reserved','uploading','checking','uncertain')`
        )
        .get(context.ownerId, context.connectionId) as { cnt: number }
    ).cnt;
    if (Number(activeCount) >= MAX_ACTIVE_QUEUE) {
      throw new Error("DRIVE_ARCHIVE_BUSY");
    }

    const totalCount = (
      this.db
        .prepare("SELECT COUNT(*) AS cnt FROM kosmora_drive_archives WHERE owner_id=?")
        .get(context.ownerId) as { cnt: number }
    ).cnt;
    if (Number(totalCount) >= MAX_TOTAL_RECEIPTS) {
      throw new Error("DRIVE_ARCHIVE_BUSY");
    }

    const id = `drv_arch_${randomUUID()}`;
    const ts = this.now();
    this.db
      .prepare(
        `INSERT INTO kosmora_drive_archives
         (id, owner_id, connection_id, operation_id, file_id, folder_id, size_bytes, sha256, state, lease, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'reserved', NULL, ?, ?)`
      )
      .run(
        id,
        context.ownerId,
        context.connectionId,
        operationId,
        fileId,
        conn.folder_id,
        bytes.byteLength,
        sha256,
        ts,
        ts
      );

    return this.getArchive(context, id);
  }

  listArchives(ownerId: string, offset = 0): DriveArchive[] {
    if (!Number.isSafeInteger(offset) || offset < 0) {
      throw new Error("INVALID_DRIVE_OFFSET");
    }
    const rows = this.db
      .prepare(
        `SELECT * FROM kosmora_drive_archives
         WHERE owner_id=?
         ORDER BY created_at DESC, id DESC
         LIMIT ? OFFSET ?`
      )
      .all(ownerId, PAGE_LIMIT, offset) as unknown as ArchiveRow[];
    return rows.map((r) => this.mapArchive(r));
  }

  getArchive(context: DriveContext, id: string): DriveArchive {
    this.activeEpoch(context.ownerId);
    const row = this.db
      .prepare("SELECT * FROM kosmora_drive_archives WHERE owner_id=? AND id=?")
      .get(context.ownerId, id) as ArchiveRow | undefined;
    if (!row) throw new Error("DRIVE_ARCHIVE_NOT_FOUND");
    return this.mapArchive(row);
  }

  findArchive(context: DriveContext, operationId: string): DriveArchive | null {
    this.activeEpoch(context.ownerId);
    const row = this.db
      .prepare(
        "SELECT * FROM kosmora_drive_archives WHERE owner_id=? AND connection_id=? AND operation_id=?"
      )
      .get(context.ownerId, context.connectionId, operationId) as ArchiveRow | undefined;
    return row ? this.mapArchive(row) : null;
  }

  claimArchive(
    context: DriveContext,
    id: string,
    mode: "upload" | "reconcile" | "retry"
  ): { archive: DriveArchive; lease: string } {
    this.assertValidContext(context);
    const row = this.db
      .prepare(
        "SELECT * FROM kosmora_drive_archives WHERE owner_id=? AND connection_id=? AND id=?"
      )
      .get(context.ownerId, context.connectionId, id) as ArchiveRow | undefined;
    if (!row) throw new Error("DRIVE_ARCHIVE_NOT_FOUND");

    if (mode === "upload" && row.state !== "reserved") {
      throw new Error("DRIVE_ARCHIVE_BUSY");
    }
    if (mode === "reconcile" && row.state !== "uncertain") {
      throw new Error("DRIVE_ARCHIVE_BUSY");
    }
    if (mode === "retry" && row.state !== "failed" && row.state !== "uncertain") {
      throw new Error("DRIVE_ARCHIVE_BUSY");
    }

    const nextState = mode === "reconcile" ? "checking" : "uploading";
    const lease = `alease_${randomUUID()}`;
    const res = this.db
      .prepare(
        `UPDATE kosmora_drive_archives
         SET state=?, lease=?, updated_at=?
         WHERE owner_id=? AND connection_id=? AND id=? AND state=?`
      )
      .run(nextState, lease, this.now(), context.ownerId, context.connectionId, id, row.state);
    if (Number(res.changes) !== 1) {
      throw new Error("DRIVE_ARCHIVE_BUSY");
    }
    return {
      archive: this.getArchive(context, id),
      lease
    };
  }

  finishArchive(
    context: DriveContext,
    id: string,
    lease: string,
    outcome: "verified" | "uncertain" | "failed",
    details?: { fileId?: string; folderId?: string; bytes?: number; sha256?: string }
  ): DriveArchive {
    this.assertValidContext(context);
    const current = this.getArchive(context, id);
    if (details) {
      if (
        (details.fileId && details.fileId !== current.fileId) ||
        (details.folderId && details.folderId !== current.folderId) ||
        (details.bytes !== undefined && details.bytes !== current.bytes) ||
        (details.sha256 && details.sha256.toLowerCase() !== current.sha256.toLowerCase())
      ) {
        throw new Error("DRIVE_ARCHIVE_CHANGED");
      }
    }
    const res = this.db
      .prepare(
        `UPDATE kosmora_drive_archives
         SET state=?, lease=NULL, updated_at=?
         WHERE owner_id=? AND connection_id=? AND id=? AND lease=? AND state IN ('uploading','checking')`
      )
      .run(outcome, this.now(), context.ownerId, context.connectionId, id, lease);
    if (Number(res.changes) !== 1) {
      throw new Error("DRIVE_LEASE_CHANGED");
    }
    return this.getArchive(context, id);
  }
}
