/* eslint-disable @typescript-eslint/require-await -- PrivacyAdapter requires Promise returns while SQLite operations run synchronously. */
import type { DatabaseSync } from "node:sqlite";
import type { PrivacyAdapter, PrivacySection } from "../account-settings/privacy/coordinator.js";

export function googleDrivePrivacyAdapter(
  db: DatabaseSync,
  worker?: { quiesce(ownerId: string): Promise<void>; resume(ownerId: string): void }
): PrivacyAdapter {
  return {
    id: "cloud-storage",
    async quiesce(owner: string, epoch: number) {
      await worker?.quiesce(owner);
      return { drained: true, fence_epoch: epoch };
    },
    async resume(owner: string) {
      worker?.resume(owner);
    },
    async export(owner: string): Promise<PrivacySection> {
      const connections = db
        .prepare(
          `SELECT owner_id, revision, connection_id, folder_id, folder_state, updated_at
           FROM kosmora_drive_connections WHERE owner_id=?`
        )
        .all(owner) as Record<string, unknown>[];
      const archives = db
        .prepare(
          `SELECT id, owner_id, connection_id, operation_id, file_id, folder_id,
                  size_bytes, sha256, state, created_at, updated_at
           FROM kosmora_drive_archives WHERE owner_id=? ORDER BY created_at DESC, id DESC`
        )
        .all(owner) as Record<string, unknown>[];
      return {
        records: {
          connections,
          archives
        },
        originals: [],
        complete: true
      };
    },
    async delete(owner: string, epoch: number) {
      const fenced = db
        .prepare(
          "SELECT 1 FROM kosmora_owner_data_lifecycle WHERE owner_id=? AND epoch=? AND state='deleting'"
        )
        .get(owner, epoch);
      if (!fenced) {
        throw new Error("OWNER_DATA_FENCED");
      }
      const archCount = Number(
        db.prepare("DELETE FROM kosmora_drive_archives WHERE owner_id=?").run(owner).changes
      );
      const connCount = Number(
        db.prepare("DELETE FROM kosmora_drive_connections WHERE owner_id=?").run(owner).changes
      );
      return { deleted_records: archCount + connCount };
    }
  };
}
