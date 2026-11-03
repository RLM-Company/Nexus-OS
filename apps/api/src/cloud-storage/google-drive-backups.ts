import { createHash } from "node:crypto";
import { DriveStorageError, GoogleDriveArchiveTransport } from "./google-drive.js";
import type { DriveGrant } from "./google-drive-authorization.js";
import type { DriveArchive, DriveContext, GoogleDriveStore } from "./google-drive-store.js";

const TOKEN_EXPIRY_SKEW_MS = 60_000;
const MAX_PARALLEL_TOTAL = 4;

export class GoogleDriveBackups {
  private readonly pausedOwners = new Set<string>();
  private readonly ownerInFlight = new Map<string, Promise<unknown>>();
  private totalInFlight = 0;

  constructor(
    private readonly store: GoogleDriveStore,
    private readonly authorization: { refresh(grant: DriveGrant): Promise<DriveGrant> },
    private readonly request: typeof fetch = fetch,
    private readonly now = Date.now
  ) {}

  async quiesce(ownerId: string): Promise<void> {
    this.pausedOwners.add(ownerId);
    const active = this.ownerInFlight.get(ownerId);
    if (active) {
      await active.catch(() => {});
    }
  }

  resume(ownerId: string): void {
    this.pausedOwners.delete(ownerId);
  }

  private async runExclusive<T>(ownerId: string, task: () => Promise<T>): Promise<T> {
    if (this.pausedOwners.has(ownerId)) {
      throw new Error("OWNER_DATA_FENCED");
    }
    if (this.ownerInFlight.has(ownerId) || this.totalInFlight >= MAX_PARALLEL_TOTAL) {
      throw new Error("DRIVE_ARCHIVE_BUSY");
    }
    this.totalInFlight += 1;
    const promise = (async () => {
      try {
        return await task();
      } finally {
        this.ownerInFlight.delete(ownerId);
        this.totalInFlight -= 1;
      }
    })();
    this.ownerInFlight.set(ownerId, promise);
    return promise;
  }

  private createTransport(context: DriveContext): GoogleDriveArchiveTransport {
    return new GoogleDriveArchiveTransport(
      context.ownerId,
      async () => {
        const { grant, version } = this.store.readGrant(context);
        if (grant.expiresAt - TOKEN_EXPIRY_SKEW_MS > this.now()) {
          return grant.accessToken;
        }
        const refreshed = await this.authorization.refresh(grant);
        this.store.refreshGrant(context, version, refreshed);
        return refreshed.accessToken;
      },
      this.request
    );
  }

  async disconnect(ownerId: string): Promise<void> {
    const active = this.ownerInFlight.get(ownerId);
    this.store.disconnect(ownerId);
    if (active) {
      await active.catch(() => {});
    }
  }

  async initializeFolder(ownerId: string): Promise<void> {
    await this.runExclusive(ownerId, async () => {
      const context = this.store.context(ownerId);
      const { fileId, lease } = this.store.claimFolder(context, false);
      if (!lease) return;
      const transport = this.createTransport(context);
      try {
        await transport.createFolder(fileId);
        const inspected = await transport.inspectFolder(fileId);
        this.store.finishFolder(context, lease, inspected === "verified_metadata");
        if (inspected !== "verified_metadata") {
          throw new DriveStorageError("DRIVE_INVALID_RESPONSE", true);
        }
      } catch (error) {
        this.store.finishFolder(context, lease, false);
        throw error;
      }
    });
  }

  async retryFolder(ownerId: string): Promise<void> {
    await this.runExclusive(ownerId, async () => {
      const context = this.store.context(ownerId);
      const { fileId, lease } = this.store.claimFolderReconciliation(context);
      if (!lease) return;
      const transport = this.createTransport(context);
      try {
        const check = await transport.inspectFolder(fileId);
        if (check === "verified_metadata") {
          this.store.finishFolder(context, lease, true);
          return;
        }
        await transport.createFolder(fileId);
        const after = await transport.inspectFolder(fileId);
        this.store.finishFolder(context, lease, after === "verified_metadata");
        if (after !== "verified_metadata") {
          throw new DriveStorageError("DRIVE_INVALID_RESPONSE", true);
        }
      } catch (error) {
        this.store.finishFolder(context, lease, false);
        throw error;
      }
    });
  }

  private async uploadAndVerify(
    context: DriveContext,
    archive: DriveArchive,
    lease: string,
    bytes: Uint8Array,
    transport: GoogleDriveArchiveTransport
  ): Promise<DriveArchive> {
    try {
      const receipt = await transport.uploadArchive(
        {
          fileId: archive.fileId,
          folderId: archive.folderId,
          operationId: archive.operationId,
          name: `kosmora-archive-${archive.operationId}.zip`
        },
        bytes
      );
      const downloaded = await transport.downloadArchive(receipt);
      const downloadedSha = createHash("sha256").update(downloaded).digest("hex");
      if (downloaded.byteLength !== archive.bytes || downloadedSha !== archive.sha256) {
        this.store.finishArchive(context, archive.id, lease, "failed");
        throw new DriveStorageError("DRIVE_ARCHIVE_CHANGED", false);
      }
      return this.store.finishArchive(context, archive.id, lease, "verified", receipt);
    } catch (error) {
      if (error instanceof DriveStorageError && error.code === "DRIVE_ARCHIVE_CHANGED") {
        throw error;
      }
      const outcome =
        error instanceof DriveStorageError && error.uncertain ? "uncertain" : "failed";
      try {
        this.store.finishArchive(context, archive.id, lease, outcome);
      } catch {
        /* lease already invalidated by disconnect/fence */
      }
      throw error;
    }
  }

  async upload(ownerId: string, operationId: string, bytes: Uint8Array): Promise<DriveArchive> {
    return this.runExclusive(ownerId, async () => {
      const context = this.store.context(ownerId);
      const existing = this.store.findArchive(context, operationId);
      if (existing) {
        const sha = createHash("sha256").update(bytes).digest("hex");
        if (existing.sha256 !== sha || existing.bytes !== bytes.byteLength) {
          throw new Error("DRIVE_ARCHIVE_EXISTS");
        }
        if (existing.state === "verified") return existing;
        throw new Error("DRIVE_ARCHIVE_EXISTS");
      }
      const transport = this.createTransport(context);
      const fileId = await transport.generateId();
      const reserved = this.store.reserveArchive(context, operationId, fileId, bytes);
      const { archive, lease } = this.store.claimArchive(context, reserved.id, "upload");
      return this.uploadAndVerify(context, archive, lease, bytes, transport);
    });
  }

  async retryUpload(ownerId: string, archiveId: string, bytes: Uint8Array): Promise<DriveArchive> {
    return this.runExclusive(ownerId, async () => {
      const context = this.store.context(ownerId);
      const target = this.store.getArchive(context, archiveId);
      const sha = createHash("sha256").update(bytes).digest("hex");
      if (target.sha256 !== sha || target.bytes !== bytes.byteLength) {
        throw new Error("DRIVE_ARCHIVE_CHANGED");
      }
      const { archive, lease } = this.store.claimArchive(context, archiveId, "retry");
      const transport = this.createTransport(context);
      try {
        const metaStatus = await transport.inspectArchive(archive);
        if (metaStatus === "verified_metadata") {
          const downloaded = await transport.downloadArchive(archive);
          const dlSha = createHash("sha256").update(downloaded).digest("hex");
          if (downloaded.byteLength === archive.bytes && dlSha === archive.sha256) {
            return this.store.finishArchive(context, archive.id, lease, "verified", archive);
          }
        }
      } catch (error) {
        if (error instanceof DriveStorageError && error.code === "DRIVE_ARCHIVE_CHANGED") {
          this.store.finishArchive(context, archive.id, lease, "failed");
          throw error;
        }
      }
      return this.uploadAndVerify(context, archive, lease, bytes, transport);
    });
  }

  async reconcile(ownerId: string, archiveId: string): Promise<DriveArchive> {
    return this.runExclusive(ownerId, async () => {
      const context = this.store.context(ownerId);
      const { archive, lease } = this.store.claimArchive(context, archiveId, "reconcile");
      const transport = this.createTransport(context);
      try {
        const status = await transport.inspectArchive(archive);
        if (status === "unavailable") {
          return this.store.finishArchive(context, archive.id, lease, "failed");
        }
        const downloaded = await transport.downloadArchive(archive);
        const dlSha = createHash("sha256").update(downloaded).digest("hex");
        if (downloaded.byteLength !== archive.bytes || dlSha !== archive.sha256) {
          this.store.finishArchive(context, archive.id, lease, "failed");
          throw new DriveStorageError("DRIVE_ARCHIVE_CHANGED", false);
        }
        return this.store.finishArchive(context, archive.id, lease, "verified", archive);
      } catch (error) {
        if (error instanceof DriveStorageError && error.code === "DRIVE_ARCHIVE_CHANGED") {
          throw error;
        }
        try {
          this.store.finishArchive(context, archive.id, lease, "uncertain");
        } catch {
          /* ignore */
        }
        throw error;
      }
    });
  }

  async download(ownerId: string, archiveId: string): Promise<Buffer> {
    return this.runExclusive(ownerId, async () => {
      const context = this.store.context(ownerId);
      const archive = this.store.getArchive(context, archiveId);
      const transport = this.createTransport(context);
      return transport.downloadArchive(archive);
    });
  }
}
