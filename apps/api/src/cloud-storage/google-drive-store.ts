import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  DRIVE_ARCHIVE_MAX_BYTES,
  DriveStorageError,
  type DriveArchiveReceipt
} from "./google-drive.js";
import type { DriveGrant } from "./google-drive-authorization.js";
import type { DriveGrantCipher } from "./google-drive-grant-cipher.js";

export type DriveContext = { ownerId: string; epoch: number; connectionId: string };
export type DriveConnectTicket = { ownerId: string; epoch: number; revision: number };
type Connection = {
  owner_id: string;
  revision: number;
  connection_id: string | null;
  grant_ciphertext: string | null;
  grant_version: number;
  folder_id: string | null;
  folder_state: "disconnected" | "reserved" | "creating" | "uncertain" | "ready";
  folder_lease: string | null;
  updated_at: string;
};
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
type ArchiveRow = {
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
};
const remoteId = (v: string) => {
  if (!/^[A-Za-z0-9_-]{5,200}$/.test(v)) throw new DriveStorageError("INVALID_DRIVE_ID");
};
const archive = (r: ArchiveRow): DriveArchive => ({
  id: r.id,
  connectionId: r.connection_id,
  fileId: r.file_id,
  folderId: r.folder_id,
  operationId: r.operation_id,
  bytes: r.size_bytes,
  sha256: r.sha256,
  state: r.state,
  createdAt: r.created_at,
  updatedAt: r.updated_at
});
const status = (r: Connection): DriveConnectionStatus => ({
  owner_id: r.owner_id,
  revision: r.revision,
  connection_id: r.connection_id,
  folder_id: r.folder_id,
  folder_state: r.folder_state,
  updated_at: r.updated_at
});

/** Synchronous SQLite journal. No startup DDL, raw archives, network or plaintext
 * tokens. Every asynchronous worker must capture a context before starting and
 * supply it on completion; disconnect/reconnect and privacy epochs fence it out.
 */
export class GoogleDriveStore {
  constructor(
    private readonly db: DatabaseSync,
    private readonly cipher?: DriveGrantCipher,
    private readonly now = () => new Date().toISOString()
  ) {}
  private transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const value = fn();
      this.db.exec("COMMIT");
      return value;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  private epoch(ownerId: string, expected?: number): number {
    if (!ownerId || ownerId.length > 128) throw new DriveStorageError("INVALID_OWNER");
    const row = this.db
      .prepare("SELECT state,epoch FROM kosmora_owner_data_lifecycle WHERE owner_id=?")
      .get(ownerId) as { state: string; epoch: number } | undefined;
    const epoch = row?.epoch ?? 0;
    if ((row && row.state !== "active") || (expected !== undefined && epoch !== expected))
      throw new DriveStorageError("OWNER_DATA_FENCED");
    return epoch;
  }
  private connection(ownerId: string): Connection | undefined {
    return this.db
      .prepare("SELECT * FROM kosmora_drive_connections WHERE owner_id=?")
      .get(ownerId) as Connection | undefined;
  }
  private connected(context: DriveContext): Connection {
    this.epoch(context.ownerId, context.epoch);
    const row = this.connection(context.ownerId);
    if (!row || row.connection_id !== context.connectionId || row.folder_state === "disconnected")
      throw new DriveStorageError("DRIVE_CONNECTION_CHANGED");
    return row;
  }
  private archiveRow(context: DriveContext, id: string, allowRetired = false): ArchiveRow {
    this.connected(context);
    const row = this.db
      .prepare(
        "SELECT * FROM kosmora_drive_archives WHERE id=? AND owner_id=? AND (?=1 OR connection_id=?)"
      )
      .get(id, context.ownerId, allowRetired ? 1 : 0, context.connectionId) as
      ArchiveRow | undefined;
    if (!row) throw new DriveStorageError("DRIVE_ARCHIVE_NOT_FOUND");
    return row;
  }
  status(ownerId: string): DriveConnectionStatus | null {
    const row = this.connection(ownerId);
    return row ? status(row) : null;
  }
  beginConnect(ownerId: string): DriveConnectTicket {
    return this.transaction(() => {
      const epoch = this.epoch(ownerId);
      // Keep a disconnected tombstone so a later disconnect invalidates even an
      // OAuth flow that started before the first successful connection.
      this.db
        .prepare(
          "INSERT OR IGNORE INTO kosmora_drive_connections(owner_id,folder_state,updated_at) VALUES(?,'disconnected',?)"
        )
        .run(ownerId, this.now());
      return { ownerId, epoch, revision: this.connection(ownerId)!.revision };
    });
  }
  assertConnectTicket(ticket: DriveConnectTicket): void {
    this.epoch(ticket.ownerId, ticket.epoch);
    if (this.connection(ticket.ownerId)?.revision !== ticket.revision)
      throw new DriveStorageError("DRIVE_CONNECTION_CHANGED");
  }
  archiveCounts(ownerId: string): { total: number; pending: number } {
    const row = this.db
      .prepare(
        "SELECT count(*) AS total,coalesce(sum(CASE WHEN state<>'verified' THEN 1 ELSE 0 END),0) AS pending FROM kosmora_drive_archives WHERE owner_id=?"
      )
      .get(ownerId) as { total: number; pending: number };
    return row;
  }
  connect(ticket: DriveConnectTicket, grant: DriveGrant, folderId: string): DriveContext {
    remoteId(folderId);
    if (!this.cipher) throw new DriveStorageError("DRIVE_KEY_CONFIGURATION_REQUIRED");
    const encrypted = this.cipher.seal(ticket.ownerId, grant);
    return this.transaction(() => {
      this.epoch(ticket.ownerId, ticket.epoch);
      const connectionId = randomUUID();
      const changed = this.db
        .prepare(
          "UPDATE kosmora_drive_connections SET revision=revision+1,connection_id=?,grant_ciphertext=?,grant_version=0,folder_id=?,folder_state='reserved',folder_lease=NULL,updated_at=? WHERE owner_id=? AND revision=?"
        )
        .run(
          connectionId,
          encrypted,
          folderId,
          this.now(),
          ticket.ownerId,
          ticket.revision
        ).changes;
      if (!changed) throw new DriveStorageError("DRIVE_CONNECTION_CHANGED");
      return { ownerId: ticket.ownerId, epoch: ticket.epoch, connectionId };
    });
  }
  context(ownerId: string): DriveContext {
    const epoch = this.epoch(ownerId),
      row = this.connection(ownerId);
    if (!row?.connection_id) throw new DriveStorageError("DRIVE_AUTH_REQUIRED");
    return { ownerId, epoch, connectionId: row.connection_id };
  }
  /** Server-only: never use as an HTTP serializer or privacy export. */
  readGrant(context: DriveContext): { grant: DriveGrant; version: number } {
    const row = this.connected(context);
    if (!this.cipher) throw new DriveStorageError("DRIVE_KEY_CONFIGURATION_REQUIRED");
    return {
      grant: this.cipher.open(context.ownerId, row.grant_ciphertext!),
      version: row.grant_version
    };
  }
  refreshGrant(context: DriveContext, expectedVersion: number, grant: DriveGrant): void {
    if (!this.cipher) throw new DriveStorageError("DRIVE_KEY_CONFIGURATION_REQUIRED");
    const encrypted = this.cipher.seal(context.ownerId, grant);
    this.transaction(() => {
      this.connected(context);
      if (
        !this.db
          .prepare(
            "UPDATE kosmora_drive_connections SET grant_ciphertext=?,grant_version=grant_version+1,updated_at=? WHERE owner_id=? AND connection_id=? AND grant_version=?"
          )
          .run(encrypted, this.now(), context.ownerId, context.connectionId, expectedVersion)
          .changes
      )
        throw new DriveStorageError("DRIVE_GRANT_CHANGED");
    });
  }
  disconnect(ownerId: string): void {
    this.transaction(() => {
      this.epoch(ownerId);
      this.db
        .prepare(
          "UPDATE kosmora_drive_connections SET revision=revision+1,connection_id=NULL,grant_ciphertext=NULL,grant_version=0,folder_id=NULL,folder_state='disconnected',folder_lease=NULL,updated_at=? WHERE owner_id=?"
        )
        .run(this.now(), ownerId);
      // Preserve receipts (including uncertain ones). No deletion of remote files.
    });
  }
  claimFolder(context: DriveContext, explicitRetry = false): { fileId: string; lease: string } {
    return this.transaction(() => {
      const row = this.connected(context),
        lease = randomUUID();
      if (
        !this.db
          .prepare(
            "UPDATE kosmora_drive_connections SET folder_state='creating',folder_lease=?,updated_at=? WHERE owner_id=? AND connection_id=? AND folder_state=?"
          )
          .run(
            lease,
            this.now(),
            context.ownerId,
            context.connectionId,
            explicitRetry ? "uncertain" : "reserved"
          ).changes
      )
        throw new DriveStorageError("DRIVE_FOLDER_BUSY");
      return { fileId: row.folder_id!, lease };
    });
  }
  finishFolder(context: DriveContext, lease: string, verified: boolean): void {
    this.transaction(() => {
      this.connected(context);
      if (
        !this.db
          .prepare(
            "UPDATE kosmora_drive_connections SET folder_state=?,folder_lease=NULL,updated_at=? WHERE owner_id=? AND connection_id=? AND folder_state='creating' AND folder_lease=?"
          )
          .run(
            verified ? "ready" : "uncertain",
            this.now(),
            context.ownerId,
            context.connectionId,
            lease
          ).changes
      )
        throw new DriveStorageError("DRIVE_LEASE_CHANGED");
    });
  }
  /** Reconciliation is read-only remotely. A new lease fences a worker from a
   * previous process; it never authorizes a second folder-create POST. */
  claimFolderReconciliation(context: DriveContext): { fileId: string; lease: string } {
    return this.transaction(() => {
      const row = this.connected(context),
        lease = randomUUID();
      if (row.folder_state !== "creating" && row.folder_state !== "uncertain")
        throw new DriveStorageError("DRIVE_FOLDER_BUSY");
      this.db
        .prepare(
          "UPDATE kosmora_drive_connections SET folder_state='creating',folder_lease=?,updated_at=? WHERE owner_id=? AND connection_id=?"
        )
        .run(lease, this.now(), context.ownerId, context.connectionId);
      return { fileId: row.folder_id!, lease };
    });
  }
  reserveArchive(
    context: DriveContext,
    operationId: string,
    fileId: string,
    bytes: Uint8Array
  ): DriveArchive {
    remoteId(fileId);
    if (
      !/^[A-Za-z0-9_-]{1,64}$/.test(operationId) ||
      !bytes.length ||
      bytes.length > DRIVE_ARCHIVE_MAX_BYTES
    )
      throw new DriveStorageError("INVALID_DRIVE_ARCHIVE");
    const digest = createHash("sha256").update(bytes).digest("hex");
    return this.transaction(() => {
      const connection = this.connected(context);
      if (connection.folder_state !== "ready")
        throw new DriveStorageError("DRIVE_FOLDER_NOT_READY");
      const existing = this.db
        .prepare(
          "SELECT * FROM kosmora_drive_archives WHERE owner_id=? AND connection_id=? AND operation_id=?"
        )
        .get(context.ownerId, context.connectionId, operationId) as ArchiveRow | undefined;
      if (existing) {
        if (
          existing.file_id !== fileId ||
          existing.sha256 !== digest ||
          existing.size_bytes !== bytes.length
        )
          throw new DriveStorageError("DRIVE_OPERATION_CONFLICT");
        return archive(existing);
      }
      const count = this.db
        .prepare(
          "SELECT count(*) AS n,sum(CASE WHEN connection_id=? AND state<>'verified' THEN 1 ELSE 0 END) AS pending FROM kosmora_drive_archives WHERE owner_id=?"
        )
        .get(context.connectionId, context.ownerId) as { n: number; pending: number | null };
      if (count.n >= 20000 || (count.pending ?? 0) >= 10)
        throw new DriveStorageError("DRIVE_JOURNAL_FULL");
      const id = randomUUID(),
        at = this.now();
      this.db
        .prepare(
          "INSERT INTO kosmora_drive_archives(id,owner_id,connection_id,operation_id,file_id,folder_id,size_bytes,sha256,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,'reserved',?,?)"
        )
        .run(
          id,
          context.ownerId,
          context.connectionId,
          operationId,
          fileId,
          connection.folder_id,
          bytes.length,
          digest,
          at,
          at
        );
      return archive(this.archiveRow(context, id));
    });
  }
  listArchives(ownerId: string, offset = 0): DriveArchive[] {
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 1000)
      throw new DriveStorageError("INVALID_DRIVE_OFFSET");
    return (
      this.db
        .prepare(
          "SELECT * FROM kosmora_drive_archives WHERE owner_id=? ORDER BY created_at DESC,id LIMIT 50 OFFSET ?"
        )
        .all(ownerId, offset) as ArchiveRow[]
    ).map(archive);
  }
  getArchive(context: DriveContext, id: string): DriveArchive {
    return archive(this.archiveRow(context, id, true));
  }
  findArchive(context: DriveContext, operationId: string): DriveArchive | null {
    this.connected(context);
    const row = this.db
      .prepare(
        "SELECT * FROM kosmora_drive_archives WHERE owner_id=? AND connection_id=? AND operation_id=?"
      )
      .get(context.ownerId, context.connectionId, operationId) as ArchiveRow | undefined;
    return row ? archive(row) : null;
  }
  claimArchive(
    context: DriveContext,
    id: string,
    mode: "upload" | "reconcile" | "retry"
  ): { archive: DriveArchive; lease: string } {
    return this.transaction(() => {
      const row = this.archiveRow(context, id, mode === "reconcile"),
        lease = randomUUID();
      if (
        (mode === "upload" && row.state !== "reserved") ||
        (mode === "reconcile" && row.state === "reserved") ||
        (mode === "retry" && row.state !== "uncertain" && row.state !== "failed")
      )
        throw new DriveStorageError("DRIVE_ARCHIVE_BUSY");
      const next = mode === "reconcile" ? "checking" : "uploading";
      this.db
        .prepare(
          "UPDATE kosmora_drive_archives SET state=?,lease=?,updated_at=? WHERE id=? AND owner_id=?"
        )
        .run(next, lease, this.now(), id, context.ownerId);
      return { archive: archive(this.archiveRow(context, id, mode === "reconcile")), lease };
    });
  }
  finishArchive(
    context: DriveContext,
    id: string,
    lease: string,
    outcome: "verified" | "uncertain" | "failed"
  ): void {
    this.transaction(() => {
      this.connected(context);
      if (
        !this.db
          .prepare(
            "UPDATE kosmora_drive_archives SET state=?,lease=NULL,updated_at=? WHERE id=? AND owner_id=? AND lease=? AND state IN ('uploading','checking')"
          )
          .run(outcome, this.now(), id, context.ownerId, lease).changes
      )
        throw new DriveStorageError("DRIVE_LEASE_CHANGED");
    });
  }
}
