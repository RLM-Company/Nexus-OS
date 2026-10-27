import type { DatabaseSync } from "node:sqlite";
import type { PrivacyAdapter, PrivacySection } from "./account-settings/privacy/coordinator.js";
import { automationTransaction } from "@cosmora/db";

export class ProjectAutomationPrivacy implements PrivacyAdapter {
  readonly id = "project-automation";
  constructor(private readonly sql: DatabaseSync) {}
  private fence(owner: string, state: string, epoch?: number): void {
    const current = this.sql
      .prepare("SELECT state,epoch FROM kosmora_owner_data_lifecycle WHERE owner_id=?")
      .get(owner) as { state: string; epoch: number } | undefined;
    if (current?.state !== state || (epoch !== undefined && current.epoch !== epoch))
      throw Error("AUTOMATION_PRIVACY_FENCE_REQUIRED");
  }
  quiesce(owner: string, epoch: number): Promise<{ drained: true; fence_epoch: number }> {
    this.fence(owner, "quiescing", epoch);
    // All operations are synchronous SQLite transactions; no independent model workers exist.
    return Promise.resolve({ drained: true, fence_epoch: epoch });
  }
  export(owner: string): Promise<PrivacySection> {
    this.fence(owner, "quiescing");
    const records = this.sql
      .prepare(
        "SELECT * FROM kosmora_automation_records WHERE owner_id=? ORDER BY project_id,kind,created_at,id"
      )
      .all(owner);
    return Promise.resolve({ records: { automation: records }, originals: [], complete: true });
  }
  delete(owner: string, epoch: number): Promise<{ deleted_records: number }> {
    return Promise.resolve(
      automationTransaction(this.sql, () => {
        this.fence(owner, "deleting", epoch);
        return {
          deleted_records: Number(
            this.sql.prepare("DELETE FROM kosmora_automation_records WHERE owner_id=?").run(owner)
              .changes
          )
        };
      })
    );
  }
}
