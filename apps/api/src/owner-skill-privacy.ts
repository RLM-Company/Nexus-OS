import type { DatabaseSync } from "node:sqlite";
import type { PrivacyAdapter, PrivacySection } from "./account-settings/privacy/coordinator.js";

export class OwnerSkillPrivacyAdapter implements PrivacyAdapter {
  readonly id = "owner-skills";
  constructor(private readonly sql: DatabaseSync) {}
  async quiesce(_ownerId: string, epoch: number): Promise<{ drained: true; fence_epoch: number }> {
    return { drained: true, fence_epoch: epoch };
  }
  async export(ownerId: string): Promise<PrivacySection> {
    return {
      records: {
        skills: this.sql
          .prepare("SELECT * FROM owner_skills WHERE owner_id=?")
          .all(ownerId) as Record<string, unknown>[],
        versions: this.sql
          .prepare("SELECT * FROM owner_skill_versions WHERE owner_id=?")
          .all(ownerId) as Record<string, unknown>[]
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
    const versions = Number(
      this.sql.prepare("DELETE FROM owner_skill_versions WHERE owner_id=?").run(ownerId).changes
    );
    const skills = Number(
      this.sql.prepare("DELETE FROM owner_skills WHERE owner_id=?").run(ownerId).changes
    );
    return { deleted_records: skills + versions };
  }
}
