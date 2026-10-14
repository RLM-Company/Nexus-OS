/* eslint-disable @typescript-eslint/require-await -- PrivacyAdapter is asynchronous; fenced SQLite operations finish synchronously and errors must remain promise rejections. */
import type { DatabaseSync } from "node:sqlite";
import type { PrivacyAdapter, PrivacySection } from "./account-settings/privacy/coordinator.js";

export class NotificationPrivacyAdapter implements PrivacyAdapter {
  readonly id = "notifications";
  constructor(private readonly sql: DatabaseSync) {}
  async quiesce(_ownerId: string, epoch: number): Promise<{ drained: true; fence_epoch: number }> {
    return { drained: true, fence_epoch: epoch };
  }
  async export(ownerId: string): Promise<PrivacySection> {
    return {
      records: {
        preferences: this.sql
          .prepare("SELECT * FROM notification_preferences WHERE owner_id=?")
          .all(ownerId),
        reads: this.sql.prepare("SELECT * FROM notification_reads WHERE owner_id=?").all(ownerId)
      },
      originals: [],
      complete: true
    };
  }
  async delete(ownerId: string, epoch: number): Promise<{ deleted_records: number }> {
    if (
      !this.sql
        .prepare(
          "SELECT 1 FROM kosmora_owner_data_lifecycle WHERE owner_id=? AND epoch=? AND state='deleting'"
        )
        .get(ownerId, epoch)
    )
      throw Error("DELETION_FENCE_REQUIRED");
    const reads = Number(
      this.sql.prepare("DELETE FROM notification_reads WHERE owner_id=?").run(ownerId).changes
    );
    const prefs = Number(
      this.sql.prepare("DELETE FROM notification_preferences WHERE owner_id=?").run(ownerId).changes
    );
    return { deleted_records: reads + prefs };
  }
}
