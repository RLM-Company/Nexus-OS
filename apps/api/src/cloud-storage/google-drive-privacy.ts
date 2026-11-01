import type { DatabaseSync } from "node:sqlite";
import type { PrivacyAdapter, PrivacySection } from "../account-settings/privacy/coordinator.js";
import { DriveStorageError } from "./google-drive.js";

/** Local journal and credentials only. Never enumerates or deletes the user's
 * remote Drive. Token ciphertext and deployment keys are excluded from exports.
 */
export function googleDrivePrivacyAdapter(
  db: DatabaseSync,
  worker?: { quiesce(ownerId: string): Promise<void>; resume(ownerId: string): void }
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
          archives
        },
        originals: [],
        complete: true
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
        const archives = Number(
          db.prepare("DELETE FROM kosmora_drive_archives WHERE owner_id=?").run(ownerId).changes
        );
        const connections = Number(
          db.prepare("DELETE FROM kosmora_drive_connections WHERE owner_id=?").run(ownerId).changes
        );
        db.exec("COMMIT");
        return Promise.resolve({ deleted_records: archives + connections });
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    }
  };
}
