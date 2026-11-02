import type { DatabaseSync } from "node:sqlite";
import type { PrivacyAdapter, PrivacySection } from "../account-settings/privacy/coordinator.js";
import { DriveStorageError } from "./google-drive.js";
import { Readable } from "node:stream";
import { createHash } from "node:crypto";
import type { GoogleDriveBundleStore } from "./google-drive-bundle-store.js";

/** Local journal and credentials only. Never enumerates or deletes the user's
 * remote Drive. Token ciphertext and deployment keys are excluded from exports.
 */
export function googleDrivePrivacyAdapter(
  db: DatabaseSync,
  worker?: { quiesce(ownerId: string): Promise<void>; resume(ownerId: string): void },
  bundles?: GoogleDriveBundleStore
): PrivacyAdapter {
  return {
    id: "cloud-storage",
    async quiesce(ownerId, epoch) {
      const row = db
        .prepare("SELECT state,epoch FROM kosmora_owner_data_lifecycle WHERE owner_id=?")
        .get(ownerId) as { state: string; epoch: number } | undefined;
      if (!row || row.epoch !== epoch || (row.state !== "quiescing" && row.state !== "deleting"))
        throw new DriveStorageError("OWNER_DATA_FENCED");
      await worker?.quiesce(ownerId);
      return { drained: true, fence_epoch: epoch };
    },
    resume(ownerId) {
      worker?.resume(ownerId);
    },
    export(ownerId): Promise<PrivacySection> {
      const extra = bundles?.privacySection(ownerId);
      if (
        !extra &&
        db.prepare("SELECT 1 FROM drive_snapshots WHERE owner_id=? LIMIT 1").get(ownerId)
      )
        throw new DriveStorageError("BACKUP_PRIVACY_UNAVAILABLE");
      const connections = db
        .prepare(
          "SELECT owner_id,revision,connection_id,folder_id,folder_state,updated_at FROM kosmora_drive_connections WHERE owner_id=?"
        )
        .all(ownerId);
      const archives = db
        .prepare(
          "SELECT id,connection_id,operation_id,file_id,folder_id,size_bytes,sha256,state,created_at,updated_at FROM kosmora_drive_archives WHERE owner_id=? ORDER BY created_at,id"
        )
        .all(ownerId);
      return Promise.resolve({
        records: {
          connections: connections.map((row) => ({
            ...row,
            remote_copies: "retained_on_user_drive",
            credential_export: "excluded"
          })),
          archives,
          ...extra?.records
        },
        originals: extra?.originals ?? [],
        complete: true
      });
    },
    readBinary(ownerId, opaque) {
      const bytes = bundles?.privacyChunk(ownerId, opaque);
      if (!bytes) return Promise.resolve(null);
      return Promise.resolve({
        stream: Readable.from([bytes]),
        original: {
          id: opaque,
          filename: `snapshot-${opaque.replace(":", "-")}.bin`,
          content_type: "application/octet-stream",
          size_bytes: bytes.length,
          sha256: createHash("sha256").update(bytes).digest("hex")
        }
      });
    },
    delete(ownerId, epoch) {
      db.exec("BEGIN IMMEDIATE");
      try {
        if (
          !db
            .prepare(
              "SELECT 1 FROM kosmora_owner_data_lifecycle WHERE owner_id=? AND epoch=? AND state='deleting'"
            )
            .get(ownerId, epoch)
        )
          throw new DriveStorageError("OWNER_DATA_FENCED");
        const descendants = (
          db
            .prepare(
              "SELECT (SELECT count(*) FROM drive_restores WHERE owner_id=?)+(SELECT count(*) FROM drive_restored_files WHERE owner_id=?) AS n"
            )
            .get(ownerId, ownerId) as { n: number }
        ).n;
        const snapshots = Number(
          db.prepare("DELETE FROM drive_snapshots WHERE owner_id=?").run(ownerId).changes
        );
        const archives = Number(
          db.prepare("DELETE FROM kosmora_drive_archives WHERE owner_id=?").run(ownerId).changes
        );
        const connections = Number(
          db.prepare("DELETE FROM kosmora_drive_connections WHERE owner_id=?").run(ownerId).changes
        );
        db.exec("COMMIT");
        return Promise.resolve({
          deleted_records: archives + connections + snapshots + descendants
        });
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    }
  };
}
