import type { DatabaseSync } from "node:sqlite";
import type { OwnerPrivacyCoordinator } from "../account-settings/privacy/coordinator.js";
import { GoogleDriveArchiveTransport } from "./google-drive.js";
import type { GoogleDriveAuthorization } from "./google-drive-authorization.js";
import {
  buildDriveArchiveSetFromCoordinator,
  parseBackupSetOperationId,
  type AssembledDriveBackupSet
} from "./google-drive-archive-builder.js";
import type { GoogleDriveBackups } from "./google-drive-backups.js";
import {
  executeTransactionalDriveRestore,
  previewDriveRestore,
  type DriveRestorePreview,
  type DriveRestoreResult
} from "./google-drive-restore.js";
import type {
  DriveArchive,
  DriveConnectTicket,
  DriveConnectionStatus,
  GoogleDriveStore
} from "./google-drive-store.js";

const TICKET_TTL_MS = 10 * 60 * 1000;

interface BoundOAuthTicket {
  ownerId: string;
  sessionId: string;
  ticket: DriveConnectTicket;
  expiresAt: number;
}

export type MultipartBackupSetState =
  | "verified"
  | "in_progress"
  | "uncertain"
  | "failed"
  | "incomplete";

export interface MultipartBackupSetView {
  backupSetId: string;
  connectionId: string;
  totalParts: number;
  verifiedParts: number;
  complete: boolean;
  state: MultipartBackupSetState;
  totalBytes: number;
  createdAt: string;
  updatedAt: string;
  parts: {
    partIndex: number;
    archiveId: string;
    operationId: string;
    fileId: string;
    bytes: number;
    sha256: string;
    state: DriveArchive["state"];
  }[];
}

export interface DriveOwnerOverview {
  configured: boolean;
  connected: boolean;
  connection: DriveConnectionStatus | null;
  queue: {
    activeCount: number;
    uncertainCount: number;
    failedCount: number;
    verifiedCount: number;
  };
  backupSets: MultipartBackupSetView[];
  archives: DriveArchive[];
}

export function aggregateMultipartBackupSets(archives: readonly DriveArchive[]): MultipartBackupSetView[] {
  const groups = new Map<
    string,
    {
      backupSetId: string;
      connectionId: string;
      totalParts: number;
      byPartIndex: Map<number, DriveArchive>;
      createdAt: string;
      updatedAt: string;
    }
  >();

  for (const arch of archives) {
    const parsed = parseBackupSetOperationId(arch.operationId);
    const setKey = parsed ? `${arch.connectionId}:${parsed.backupSetId}` : `${arch.connectionId}:single_${arch.id}`;
    const backupSetId = parsed ? parsed.backupSetId : arch.operationId;
    const totalParts = parsed ? parsed.totalParts : 1;
    const partIndex = parsed ? parsed.partIndex : 1;

    let group = groups.get(setKey);
    if (!group) {
      group = {
        backupSetId,
        connectionId: arch.connectionId,
        totalParts,
        byPartIndex: new Map(),
        createdAt: arch.createdAt,
        updatedAt: arch.updatedAt
      };
      groups.set(setKey, group);
    }
    if (arch.createdAt < group.createdAt) group.createdAt = arch.createdAt;
    if (arch.updatedAt > group.updatedAt) group.updatedAt = arch.updatedAt;
    if (!group.byPartIndex.has(partIndex)) {
      group.byPartIndex.set(partIndex, arch);
    }
  }

  const views: MultipartBackupSetView[] = [];
  for (const group of groups.values()) {
    const parts: MultipartBackupSetView["parts"] = [];
    let verifiedParts = 0;
    let hasFailed = false;
    let hasUncertain = false;
    let hasInProgress = false;
    let totalBytes = 0;

    for (let idx = 1; idx <= group.totalParts; idx += 1) {
      const item = group.byPartIndex.get(idx);
      if (!item) continue;
      totalBytes += item.bytes;
      if (item.state === "verified") verifiedParts += 1;
      else if (item.state === "failed") hasFailed = true;
      else if (item.state === "uncertain") hasUncertain = true;
      else hasInProgress = true;

      parts.push({
        partIndex: idx,
        archiveId: item.id,
        operationId: item.operationId,
        fileId: item.fileId,
        bytes: item.bytes,
        sha256: item.sha256,
        state: item.state
      });
    }

    const allPartsPresent = parts.length === group.totalParts;
    const complete = allPartsPresent && verifiedParts === group.totalParts;
    let state: MultipartBackupSetState;
    if (complete) {
      state = "verified";
    } else if (hasFailed) {
      state = "failed";
    } else if (hasUncertain) {
      state = "uncertain";
    } else if (hasInProgress) {
      state = "in_progress";
    } else {
      state = "incomplete";
    }

    views.push({
      backupSetId: group.backupSetId,
      connectionId: group.connectionId,
      totalParts: group.totalParts,
      verifiedParts,
      complete,
      state,
      totalBytes,
      createdAt: group.createdAt,
      updatedAt: group.updatedAt,
      parts
    });
  }

  return views.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
}

export class GoogleDriveController {
  private readonly pendingTickets = new Map<string, BoundOAuthTicket>();
  private readonly stagedPartPayloads = new Map<string, Buffer>();
  private readonly now: () => number;
  private readonly request: typeof fetch;

  constructor(
    private readonly options: {
      db: DatabaseSync;
      store: GoogleDriveStore;
      backups: GoogleDriveBackups;
      auth: GoogleDriveAuthorization | null;
      privacy: Pick<OwnerPrivacyCoordinator, "export" | "binary">;
      request?: typeof fetch;
      now?: () => number;
      onRestoreBinary?: Parameters<typeof executeTransactionalDriveRestore>[3] extends
        | { onRestoreBinary?: infer F }
        | undefined
        ? F
        : never;
    }
  ) {
    this.now = options.now ?? Date.now;
    this.request = options.request ?? fetch;
  }

  private pruneExpiredTickets(): void {
    const current = this.now();
    for (const [state, record] of this.pendingTickets.entries()) {
      if (record.expiresAt <= current) {
        this.pendingTickets.delete(state);
      }
    }
  }

  private invalidateOwnerTickets(ownerId: string): void {
    for (const [state, record] of this.pendingTickets.entries()) {
      if (record.ownerId === ownerId) {
        this.pendingTickets.delete(state);
      }
    }
  }

  overview(ownerId: string, offset = 0): DriveOwnerOverview {
    const conn = this.options.store.status(ownerId);
    const archives = this.options.store.listArchives(ownerId, offset);
    const currentConnArchives = conn?.connection_id
      ? archives.filter((a) => a.connectionId === conn.connection_id)
      : [];

    const queue = {
      activeCount: currentConnArchives.filter(
        (a) => a.state === "reserved" || a.state === "uploading" || a.state === "checking"
      ).length,
      uncertainCount: currentConnArchives.filter((a) => a.state === "uncertain").length,
      failedCount: currentConnArchives.filter((a) => a.state === "failed").length,
      verifiedCount: archives.filter((a) => a.state === "verified").length
    };

    return {
      configured: this.options.auth !== null,
      connected: Boolean(conn && conn.folder_state !== "disconnected"),
      connection: conn,
      queue,
      backupSets: aggregateMultipartBackupSets(archives),
      archives
    };
  }

  startOAuthConnect(identity: { ownerId: string; sessionId: string }): {
    authorizationUrl: string;
    state: string;
  } {
    if (!this.options.auth) {
      throw new Error("DRIVE_OAUTH_CONFIGURATION_REQUIRED");
    }
    if (!identity.ownerId || !identity.sessionId) {
      throw new Error("DRIVE_AUTH_CONTEXT_REQUIRED");
    }
    this.pruneExpiredTickets();
    // Capture server-side ticket before redirecting to Google OAuth
    const ticket = this.options.store.beginConnect(identity.ownerId);
    const { url, state } = this.options.auth.begin({
      ownerId: identity.ownerId,
      sessionId: identity.sessionId
    });
    this.pendingTickets.set(state, {
      ownerId: identity.ownerId,
      sessionId: identity.sessionId,
      ticket,
      expiresAt: this.now() + TICKET_TTL_MS
    });
    return {
      authorizationUrl: url,
      state
    };
  }

  async finishOAuthCallback(
    identity: { ownerId: string; sessionId: string },
    input: { state: string; code: string }
  ): Promise<DriveOwnerOverview> {
    if (!this.options.auth) {
      throw new Error("DRIVE_OAUTH_CONFIGURATION_REQUIRED");
    }
    if (!identity.ownerId || !identity.sessionId) {
      throw new Error("DRIVE_AUTH_CONTEXT_REQUIRED");
    }
    this.pruneExpiredTickets();
    const bound = this.pendingTickets.get(input.state);
    // Single-use state: delete immediately before any async work
    this.pendingTickets.delete(input.state);

    if (!bound || bound.expiresAt <= this.now()) {
      throw new Error("DRIVE_OAUTH_STATE_INVALID");
    }
    if (bound.ownerId !== identity.ownerId || bound.sessionId !== identity.sessionId) {
      throw new Error("DRIVE_OAUTH_SESSION_MISMATCH");
    }

    const grant = await this.options.auth.finish({
      ownerId: identity.ownerId,
      sessionId: identity.sessionId,
      state: input.state,
      code: input.code
    });

    const tempTransport = new GoogleDriveArchiveTransport(
      identity.ownerId,
      async () => grant.accessToken,
      this.request
    );
    const folderId = await tempTransport.generateId();

    // Commit encrypted grant & pre-allocated folderId using server-captured ticket
    this.options.store.connect(bound.ticket, grant, folderId);

    try {
      await this.options.backups.initializeFolder(identity.ownerId);
    } catch {
      /* Folder state remains 'uncertain' in journal so owner can retryFolder without losing grant */
    }

    return this.overview(identity.ownerId);
  }

  async disconnect(ownerId: string): Promise<DriveOwnerOverview> {
    this.invalidateOwnerTickets(ownerId);
    await this.options.backups.disconnect(ownerId);
    for (const key of this.stagedPartPayloads.keys()) {
      if (key.startsWith(`${ownerId}:`)) {
        this.stagedPartPayloads.delete(key);
      }
    }
    return this.overview(ownerId);
  }

  async retryFolder(ownerId: string): Promise<DriveOwnerOverview> {
    await this.options.backups.retryFolder(ownerId);
    return this.overview(ownerId);
  }

  async createBackupCopy(
    ownerId: string,
    options: { backupSetId?: string } = {}
  ): Promise<{
    backupSet: MultipartBackupSetView;
    assembled: Pick<AssembledDriveBackupSet, "backupSetId" | "totalParts" | "totalBytes" | "generatedAt">;
  }> {
    const assembled = await buildDriveArchiveSetFromCoordinator(
      this.options.privacy,
      ownerId,
      options.backupSetId ? { backupSetId: options.backupSetId } : {}
    );

    const uploadedArchives: DriveArchive[] = [];
    for (const part of assembled.parts) {
      const stageKey = `${ownerId}:${part.operationId}`;
      this.stagedPartPayloads.set(stageKey, part.bytes);
      try {
        const arch = await this.options.backups.upload(ownerId, part.operationId, part.bytes);
        uploadedArchives.push(arch);
        if (arch.state === "verified") {
          this.stagedPartPayloads.delete(stageKey);
        }
      } catch (error) {
        const context = this.options.store.context(ownerId);
        const partial = this.options.store.findArchive(context, part.operationId);
        if (partial) {
          uploadedArchives.push(partial);
          break;
        }
        throw error;
      }
    }

    const overview = this.overview(ownerId);
    const setView =
      overview.backupSets.find((s) => s.backupSetId === assembled.backupSetId) ??
      aggregateMultipartBackupSets(uploadedArchives)[0];
    if (!setView) {
      throw new Error("DRIVE_BACKUP_SET_NOT_CREATED");
    }

    return {
      backupSet: setView,
      assembled: {
        backupSetId: assembled.backupSetId,
        totalParts: assembled.totalParts,
        totalBytes: assembled.totalBytes,
        generatedAt: assembled.generatedAt
      }
    };
  }

  async retryArchiveUpload(
    ownerId: string,
    archiveId: string,
    explicitBytes?: Uint8Array
  ): Promise<DriveArchive> {
    const context = this.options.store.context(ownerId);
    const target = this.options.store.getArchive(context, archiveId);
    const stageKey = `${ownerId}:${target.operationId}`;
    const bytes = explicitBytes ?? this.stagedPartPayloads.get(stageKey);
    if (!bytes) {
      throw new Error("DRIVE_RETRY_BYTES_REQUIRED");
    }
    const updated = await this.options.backups.retryUpload(ownerId, archiveId, bytes);
    if (updated.state === "verified") {
      this.stagedPartPayloads.delete(stageKey);
    }
    return updated;
  }

  async reconcileArchive(ownerId: string, archiveId: string): Promise<DriveArchive> {
    const updated = await this.options.backups.reconcile(ownerId, archiveId);
    if (updated.state === "verified") {
      this.stagedPartPayloads.delete(`${ownerId}:${updated.operationId}`);
    }
    return updated;
  }

  private async downloadVerifiedBackupSetParts(
    ownerId: string,
    backupSetId: string
  ): Promise<Buffer[]> {
    const overview = this.overview(ownerId);
    const setView = overview.backupSets.find((s) => s.backupSetId === backupSetId);
    if (!setView) {
      throw new Error("DRIVE_ARCHIVE_NOT_FOUND");
    }
    if (!setView.complete || setView.state !== "verified") {
      throw new Error("DRIVE_BACKUP_SET_INCOMPLETE");
    }
    const ordered = [...setView.parts].sort((a, b) => a.partIndex - b.partIndex);
    const buffers: Buffer[] = [];
    for (const part of ordered) {
      const buf = await this.options.backups.download(ownerId, part.archiveId);
      buffers.push(buf);
    }
    return buffers;
  }

  async previewRestoreFromDrive(
    ownerId: string,
    backupSetId: string
  ): Promise<DriveRestorePreview> {
    const parts = await this.downloadVerifiedBackupSetParts(ownerId, backupSetId);
    return previewDriveRestore(ownerId, parts);
  }

  async executeRestoreFromDrive(
    ownerId: string,
    backupSetId: string
  ): Promise<DriveRestoreResult> {
    const parts = await this.downloadVerifiedBackupSetParts(ownerId, backupSetId);
    return executeTransactionalDriveRestore(
      this.options.db,
      ownerId,
      parts,
      this.options.onRestoreBinary ? { onRestoreBinary: this.options.onRestoreBinary } : {}
    );
  }
}
