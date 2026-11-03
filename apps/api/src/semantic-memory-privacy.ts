import type { DatabaseSync } from "node:sqlite";
import type { PrivacyAdapter, PrivacySection } from "./account-settings/privacy/coordinator.js";
import type { SemanticHistoryIndex } from "./semantic-memory/index-service.js";

/** Rebuildable derivative, never a second canonical conversation store. */
export class SemanticMemoryPrivacy implements PrivacyAdapter {
  readonly id = "semantic-memory";
  constructor(
    private readonly sqlite: DatabaseSync,
    private readonly runtime?: SemanticHistoryIndex
  ) {}
  private purge(owner: string) {
    const before = this.count(owner);
    this.sqlite.prepare("DELETE FROM semantic_index_sources WHERE owner_id=?").run(owner);
    this.sqlite.prepare("DELETE FROM semantic_index_progress WHERE owner_id=?").run(owner);
    return before;
  }
  private count(owner: string) {
    return (
      this.sqlite
        .prepare(
          "SELECT (SELECT count(*) FROM semantic_index_sources WHERE owner_id=?)+(SELECT count(*) FROM semantic_index_chunks WHERE owner_id=?)+(SELECT count(*) FROM semantic_index_progress WHERE owner_id=?) n"
        )
        .get(owner, owner, owner) as { n: number }
    ).n;
  }
  async quiesce(owner: string, epoch: number) {
    await this.runtime?.quiesce(owner);
    this.purge(owner);
    return { drained: true as const, fence_epoch: epoch };
  }
  export(owner: string): Promise<PrivacySection> {
    if (this.count(owner)) return Promise.reject(new Error("SEMANTIC_INDEX_NOT_DRAINED"));
    // Cache was discarded at the privacy fence; every remaining owned record is
    // exported by canonical source adapters. No invented binary/original.
    return Promise.resolve({ records: {}, originals: [], complete: true });
  }
  delete(owner: string, epoch: number) {
    if (
      !this.sqlite
        .prepare(
          "SELECT 1 FROM kosmora_owner_data_lifecycle WHERE owner_id=? AND epoch=? AND state='deleting'"
        )
        .get(owner, epoch)
    )
      return Promise.reject(new Error("OWNER_DATA_FENCED"));
    return Promise.resolve({ deleted_records: this.purge(owner) });
  }
  resume(owner: string) {
    this.runtime?.resume(owner);
  }
}
