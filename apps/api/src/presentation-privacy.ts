/* eslint-disable @typescript-eslint/require-await -- PrivacyAdapter is asynchronous; fenced SQLite operations finish synchronously and errors must remain promise rejections. */
import type { DatabaseSync } from "node:sqlite";
import type { PrivacyAdapter, PrivacySection } from "./account-settings/privacy/coordinator.js";

/** All presentation data is text in SQLite. Synchronous writes drain before quiesce. */
export class PresentationPrivacyAdapter implements PrivacyAdapter {
  readonly id = "presentations";
  constructor(private readonly sql: DatabaseSync) {}
  async quiesce(_ownerId: string, epoch: number): Promise<{ drained: true; fence_epoch: number }> {
    return { drained: true, fence_epoch: epoch };
  }
  async export(ownerId: string): Promise<PrivacySection> {
    const decks = this.sql
      .prepare(
        "SELECT id,owner_id,title,theme,slides_json,version,created_at,updated_at FROM presentations WHERE owner_id=? ORDER BY created_at"
      )
      .all(ownerId) as Record<string, unknown>[];
    const versions = this.sql
      .prepare(
        "SELECT presentation_id,owner_id,version,title,theme,slides_json,source,source_version,created_at FROM presentation_versions WHERE owner_id=? ORDER BY presentation_id,version"
      )
      .all(ownerId);
    const work_sources = this.sql
      .prepare(
        "SELECT owner_id,source_key,presentation_id,source_json,created_at FROM presentation_work_imports WHERE owner_id=? ORDER BY created_at"
      )
      .all(ownerId);
    return { records: { decks, versions, work_sources }, originals: [], complete: true };
  }
  async delete(ownerId: string, epoch: number): Promise<{ deleted_records: number }> {
    const fence = this.sql
      .prepare(
        "SELECT 1 FROM kosmora_owner_data_lifecycle WHERE owner_id=? AND epoch=? AND state='deleting'"
      )
      .get(ownerId, epoch);
    if (!fence) throw Error("DELETION_FENCE_REQUIRED");
    const versions = this.sql
      .prepare("SELECT COUNT(*) AS n FROM presentation_versions WHERE owner_id=?")
      .get(ownerId)!;
    const sources = this.sql
      .prepare("DELETE FROM presentation_work_imports WHERE owner_id=?")
      .run(ownerId);
    const result = this.sql.prepare("DELETE FROM presentations WHERE owner_id=?").run(ownerId);
    return {
      deleted_records: Number(result.changes) + Number(versions.n) + Number(sources.changes)
    };
  }
}
