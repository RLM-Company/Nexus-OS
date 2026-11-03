import {
  DRIVE_ARCHIVE_MAX_BYTES,
  DriveStorageError,
  GoogleDriveArchiveTransport
} from "./google-drive.js";
import type { DriveGrant } from "./google-drive-authorization.js";
import type { GoogleDriveStore, DriveArchive, DriveContext } from "./google-drive-store.js";

/** Journal-backed binary copy operations, not chat import or an HTTP controller.
 * The archive builder must strip credentials and validate the backup schema.
 */
export class GoogleDriveBackups {
  readonly #active = new Map<string, Promise<unknown>>();
  readonly #blocked = new Set<string>();
  constructor(
    private readonly store: GoogleDriveStore,
    private readonly authorization: { refresh(grant: DriveGrant): Promise<DriveGrant> },
    private readonly request: typeof fetch = fetch,
    private readonly now = Date.now
  ) {}
  private async exclusive<T>(
    ownerId: string,
    job: (context: DriveContext) => Promise<T>
  ): Promise<T> {
    if (this.#blocked.has(ownerId)) throw new DriveStorageError("OWNER_DATA_FENCED");
    if (this.#active.has(ownerId)) throw new DriveStorageError("DRIVE_OWNER_BUSY");
    if (this.#active.size >= 4) throw new DriveStorageError("DRIVE_BUSY");
    const context = this.store.context(ownerId);
    // Register before calling the job: even a synchronous callback cannot start
    // another operation before the owner lock exists.
    const pending = Promise.resolve().then(() => job(context));
    this.#active.set(ownerId, pending);
    try {
      return await pending;
    } finally {
      if (this.#active.get(ownerId) === pending) this.#active.delete(ownerId);
    }
  }
  private transport(context: DriveContext) {
    return new GoogleDriveArchiveTransport(
      context.ownerId,
      async () => {
        const { grant, version } = this.store.readGrant(context);
        if (grant.expiresAt > this.now() + 30_000) return grant.accessToken;
        const fresh = await this.authorization.refresh(grant);
        this.store.refreshGrant(context, version, fresh);
        return fresh.accessToken;
      },
      this.request
    );
  }
  async quiesce(ownerId: string): Promise<void> {
    this.#blocked.add(ownerId);
    await this.#active.get(ownerId)?.catch(() => {});
  }
  resume(ownerId: string): void {
    this.#blocked.delete(ownerId);
  }
  async disconnect(ownerId: string): Promise<void> {
    this.store.disconnect(ownerId); // Fence immediately, before awaiting the old network request.
    await this.#active.get(ownerId)?.catch(() => {});
  }
  private preserveError(mark: () => void): void {
    try {
      mark();
    } catch (error) {
      // Lifecycle/connection changes legitimately prevent a late acknowledgement.
      // The pre-existing receipt remains available for later reconciliation.
      if (
        !(error instanceof DriveStorageError) ||
        !["OWNER_DATA_FENCED", "DRIVE_CONNECTION_CHANGED", "DRIVE_LEASE_CHANGED"].includes(
          error.code
        )
      )
        throw error;
    }
  }
  initializeFolder(ownerId: string): Promise<void> {
    return this.folder(ownerId, false);
  }
  /** Call only for an explicit retry action; read-only reconciliation never calls this. */
  retryFolder(ownerId: string): Promise<void> {
    return this.folder(ownerId, true);
  }
  private folder(ownerId: string, explicitRetry: boolean): Promise<void> {
    return this.exclusive(ownerId, async (context) => {
      const state = this.store.status(ownerId)!.folder_state;
      if (state === "ready") return;
      if (explicitRetry && state !== "uncertain") throw new DriveStorageError("DRIVE_FOLDER_BUSY");
      const transport = this.transport(context);
      const claimed =
        state === "reserved" || explicitRetry
          ? this.store.claimFolder(context, explicitRetry)
          : this.store.claimFolderReconciliation(context);
      try {
        if (state === "reserved" || explicitRetry) {
          try {
            await transport.createFolder(claimed.fileId);
          } catch (error) {
            if (!(error instanceof DriveStorageError) || error.code !== "DRIVE_CONFLICT")
              throw error;
          }
        }
        if ((await transport.inspectFolder(claimed.fileId)) !== "verified_metadata")
          throw new DriveStorageError("DRIVE_FOLDER_UNAVAILABLE");
        this.store.finishFolder(context, claimed.lease, true);
      } catch (error) {
        this.preserveError(() => this.store.finishFolder(context, claimed.lease, false));
        throw error;
      }
    });
  }
  upload(ownerId: string, operationId: string, bytes: Uint8Array): Promise<DriveArchive> {
    if (
      !/^[A-Za-z0-9_-]{1,64}$/.test(operationId) ||
      !bytes.length ||
      bytes.length > DRIVE_ARCHIVE_MAX_BYTES
    )
      return Promise.reject(new DriveStorageError("INVALID_DRIVE_ARCHIVE"));
    const payload = Buffer.from(bytes);
    return this.exclusive(ownerId, async (context) => {
      if (this.store.status(ownerId)?.folder_state !== "ready")
        throw new DriveStorageError("DRIVE_FOLDER_NOT_READY");
      const transport = this.transport(context),
        previous = this.store.findArchive(context, operationId);
      const fileId = previous?.fileId ?? (await transport.generateId());
      const item = this.store.reserveArchive(context, operationId, fileId, payload);
      if (item.state !== "reserved") return this.verify(context, item.id, transport);
      return this.write(context, item, payload, transport, "upload");
    });
  }
  /** Explicit owner action only. Same recorded ID and same content; never starts
   * a new operation or writes into a retired connection's folder. */
  retryUpload(ownerId: string, archiveId: string, bytes: Uint8Array): Promise<DriveArchive> {
    if (!bytes.length || bytes.length > DRIVE_ARCHIVE_MAX_BYTES)
      return Promise.reject(new DriveStorageError("INVALID_DRIVE_ARCHIVE"));
    const payload = Buffer.from(bytes);
    return this.exclusive(ownerId, (context) => {
      const item = this.store.getArchive(context, archiveId);
      if (item.connectionId !== context.connectionId)
        throw new DriveStorageError("DRIVE_CONNECTION_CHANGED");
      this.store.reserveArchive(context, item.operationId, item.fileId, payload);
      return this.write(context, item, payload, this.transport(context), "retry");
    });
  }
  private async write(
    context: DriveContext,
    item: DriveArchive,
    payload: Buffer,
    transport: GoogleDriveArchiveTransport,
    mode: "upload" | "retry"
  ) {
    const claimed = this.store.claimArchive(context, item.id, mode);
    try {
      try {
        await transport.uploadArchive({ ...item, name: `kosmora-${item.id}.zip` }, payload);
      } catch (error) {
        if (!(error instanceof DriveStorageError) || error.code !== "DRIVE_CONFLICT") throw error;
      }
      await transport.downloadArchive(item); // An upload ACK alone is not a verified backup.
      this.store.finishArchive(context, item.id, claimed.lease, "verified");
      return this.store.getArchive(context, item.id);
    } catch (error) {
      this.preserveError(() =>
        this.store.finishArchive(
          context,
          item.id,
          claimed.lease,
          error instanceof DriveStorageError && error.code === "DRIVE_ARCHIVE_CHANGED"
            ? "failed"
            : "uncertain"
        )
      );
      throw error;
    }
  }
  private async read(
    context: DriveContext,
    archiveId: string,
    transport: GoogleDriveArchiveTransport
  ) {
    const claimed = this.store.claimArchive(context, archiveId, "reconcile");
    try {
      const bytes = await transport.downloadArchive(claimed.archive);
      this.store.finishArchive(context, archiveId, claimed.lease, "verified");
      return bytes;
    } catch (error) {
      this.preserveError(() =>
        this.store.finishArchive(
          context,
          archiveId,
          claimed.lease,
          error instanceof DriveStorageError && error.code === "DRIVE_ARCHIVE_CHANGED"
            ? "failed"
            : "uncertain"
        )
      );
      throw error;
    }
  }
  private async verify(
    context: DriveContext,
    archiveId: string,
    transport: GoogleDriveArchiveTransport
  ) {
    await this.read(context, archiveId, transport);
    return this.store.getArchive(context, archiveId);
  }
  reconcile(ownerId: string, archiveId: string): Promise<DriveArchive> {
    return this.exclusive(ownerId, (context) =>
      this.verify(context, archiveId, this.transport(context))
    );
  }
  download(ownerId: string, archiveId: string): Promise<Buffer> {
    return this.exclusive(ownerId, (context) =>
      this.read(context, archiveId, this.transport(context))
    );
  }
}
