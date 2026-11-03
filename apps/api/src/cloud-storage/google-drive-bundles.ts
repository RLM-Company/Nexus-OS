import type { GoogleDriveStore, DriveContext } from "./google-drive-store.js";
import type { GoogleDriveBackups } from "./google-drive-backups.js";
import { DriveStorageError } from "./google-drive.js";
import type { GoogleDriveBundleStore } from "./google-drive-bundle-store.js";
import { bundleView, selectionHash } from "./google-drive-bundle-store.js";
import {
  captureSnapshot,
  parseSnapshot,
  readSnapshotPart,
  snapshotHash,
  snapshotPart,
  type SnapshotSelection
} from "./google-drive-snapshot.js";

export class GoogleDriveBundles {
  readonly #jobs = new Map<string, Promise<unknown>>();
  readonly #blocked = new Set<string>();
  constructor(
    readonly store: GoogleDriveBundleStore,
    private readonly drive: GoogleDriveStore,
    private readonly copies: GoogleDriveBackups
  ) {}
  private async job<T>(owner: string, work: (context: DriveContext) => Promise<T>) {
    if (this.#blocked.has(owner)) throw new DriveStorageError("OWNER_DATA_FENCED");
    if (this.#jobs.size) throw new DriveStorageError("BACKUP_BUSY"); // One bounded large snapshot per API process.
    const context = this.drive.context(owner),
      pending = Promise.resolve().then(() => work(context));
    this.#jobs.set(owner, pending);
    try {
      return await pending;
    } finally {
      if (this.#jobs.get(owner) === pending) this.#jobs.delete(owner);
    }
  }
  async quiesce(owner: string) {
    this.#blocked.add(owner);
    await this.#jobs.get(owner)?.catch(() => {});
  }
  resume(owner: string) {
    this.#blocked.delete(owner);
  }
  save(owner: string, operation: string, selection: SnapshotSelection) {
    return this.job(owner, async (context) => {
      let row = this.store.find(owner, operation);
      if (row && row.selection_sha !== selectionHash(selection))
        throw new DriveStorageError("DRIVE_OPERATION_CONFLICT");
      if (!row)
        row = this.store.create(
          context,
          operation,
          selection,
          captureSnapshot(this.store.db, owner, selection)
        );
      if (row.state === "verified") return bundleView(row);
      return this.send(context, row.id, false);
    });
  }
  retry(owner: string, id: string) {
    return this.job(owner, (context) => this.send(context, id, true));
  }
  waitForOwner(owner: string) {
    return this.#jobs.get(owner)?.catch(() => {});
  }
  private async send(context: DriveContext, id: string, explicitRetry: boolean) {
    const row = this.store.get(context.ownerId, id);
    if (row.connection_id !== context.connectionId)
      throw new DriveStorageError("DRIVE_CONNECTION_CHANGED");
    const payload = this.store.payload(context.ownerId, id),
      parts = JSON.parse(row.parts_json) as (string | null)[];
    this.store.progress(context, id, parts, "uploading");
    try {
      for (let i = 0; i < row.part_count; i++) {
        this.store.assertContext(context);
        const zip = snapshotPart(payload, id, i),
          operation = `${id}_${i}`;
        const previous = this.drive.findArchive(context, operation);
        const part =
          explicitRetry &&
          previous &&
          (previous.state === "uncertain" || previous.state === "failed")
            ? await this.copies.retryUpload(context.ownerId, previous.id, zip)
            : await this.copies.upload(context.ownerId, operation, zip);
        parts[i] = part.id;
        this.store.progress(context, id, parts, "uploading");
      }
      return bundleView(this.store.progress(context, id, parts, "verified"));
    } catch (error) {
      try {
        this.store.progress(context, id, parts, "uncertain");
      } catch (late) {
        if (
          !(late instanceof DriveStorageError) ||
          !["OWNER_DATA_FENCED", "DRIVE_CONNECTION_CHANGED"].includes(late.code)
        )
          throw late;
      }
      throw error;
    }
  }
  preview(owner: string, id: string) {
    return this.job(owner, async (context) => {
      const row = this.store.get(owner, id);
      if (row.state === "discarded") throw new DriveStorageError("BACKUP_CACHE_UNAVAILABLE");
      const parts = JSON.parse(row.parts_json) as (string | null)[],
        chunks: Buffer[] = [];
      try {
        for (let i = 0; i < row.part_count; i++) {
          this.store.assertContext(context);
          const part = parts[i] ?? this.store.partReceipt(row, i);
          if (!part) throw new DriveStorageError("BACKUP_INCOMPLETE");
          const zip = await this.copies.download(owner, part);
          chunks.push(
            readSnapshotPart(
              zip,
              { id, bytes: row.bytes, sha256: row.sha256, count: row.part_count },
              i
            )
          );
          parts[i] = part;
        }
        const payload = Buffer.concat(chunks);
        if (payload.length !== row.bytes || snapshotHash(payload) !== row.sha256)
          throw new DriveStorageError("BACKUP_INVALID");
        parseSnapshot(payload);
        this.store.progress(context, id, parts, "verified");
        return this.store.preview(context, id, payload);
      } catch (error) {
        if (!(error instanceof DriveStorageError) || error.code !== "BACKUP_CACHE_FULL") {
          try {
            this.store.progress(context, id, parts, "uncertain");
          } catch (late) {
            if (
              !(late instanceof DriveStorageError) ||
              !["OWNER_DATA_FENCED", "DRIVE_CONNECTION_CHANGED"].includes(late.code)
            )
              throw late;
          }
        }
        throw error;
      }
    });
  }
  restore(owner: string, id: string, token: string, operation: string) {
    if (this.#blocked.has(owner) || this.#jobs.size) throw new DriveStorageError("BACKUP_BUSY");
    return this.store.restore(this.drive.context(owner), id, token, operation);
  }
  cancelPreview(owner: string, id: string) {
    if (this.#blocked.has(owner)) throw new DriveStorageError("OWNER_DATA_FENCED");
    if (this.#jobs.has(owner)) throw new DriveStorageError("BACKUP_BUSY");
    this.store.clearLocal(owner, id, false);
    return { cancelled: true };
  }
  discard(owner: string, id: string) {
    if (this.#blocked.has(owner)) throw new DriveStorageError("OWNER_DATA_FENCED");
    if (this.#jobs.has(owner)) throw new DriveStorageError("BACKUP_BUSY");
    this.store.clearLocal(owner, id, true);
    return { discarded: true };
  }
}
