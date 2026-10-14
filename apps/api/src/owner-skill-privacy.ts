import type { DatabaseSync } from "node:sqlite";
import type { PrivacyAdapter, PrivacySection } from "./account-settings/privacy/coordinator.js";

export class OwnerSkillPrivacyAdapter implements PrivacyAdapter {
  readonly id = "owner-skills";
  constructor(private readonly sql: DatabaseSync) {}
  quiesce(_ownerId: string, epoch: number): Promise<{ drained: true; fence_epoch: number }> {
    return Promise.resolve({ drained: true, fence_epoch: epoch });
  }
  export(ownerId: string): Promise<PrivacySection> {
    return Promise.resolve({
      records: {
        skills: this.sql.prepare("SELECT * FROM owner_skills WHERE owner_id=?").all(ownerId),
        versions: this.sql
          .prepare("SELECT * FROM owner_skill_versions WHERE owner_id=?")
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
    const versions = Number(
      this.sql.prepare("DELETE FROM owner_skill_versions WHERE owner_id=?").run(ownerId).changes
    );
    const skills = Number(
      this.sql.prepare("DELETE FROM owner_skills WHERE owner_id=?").run(ownerId).changes
    );
    return Promise.resolve({ deleted_records: skills + versions });
  }
}
