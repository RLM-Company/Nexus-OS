import type { DatabaseSync } from "node:sqlite";
import type { PrivacyAdapter, PrivacySection } from "./account-settings/privacy/coordinator.js";

export class EmailChangePrivacyAdapter implements PrivacyAdapter {
  readonly id = "email-change";
  constructor(private readonly sql: DatabaseSync) {}
  quiesce(_ownerId: string, epoch: number): Promise<{ drained: true; fence_epoch: number }> {
    return Promise.resolve({ drained: true, fence_epoch: epoch });
  }
  export(ownerId: string): Promise<PrivacySection> {
    // The bearer token hash is authentication material and is not included in the archive.
    return Promise.resolve({
      records: {
        pending_email_changes: this.sql
          .prepare(
            "SELECT new_email,expires_at,created_at FROM auth_email_changes WHERE owner_id=?"
          )
          .all(ownerId)
      },
      originals: [],
      complete: true
    });
  }
  delete(ownerId: string, epoch: number): Promise<{ deleted_records: number }> {
    if (
      !this.sql
        .prepare(
          "SELECT 1 FROM kosmora_owner_data_lifecycle WHERE owner_id=? AND epoch=? AND state='deleting'"
        )
        .get(ownerId, epoch)
    )
      throw Error("DELETION_FENCE_REQUIRED");
    return Promise.resolve({
      deleted_records: Number(
        this.sql.prepare("DELETE FROM auth_email_changes WHERE owner_id=?").run(ownerId).changes
      )
    });
  }
}
