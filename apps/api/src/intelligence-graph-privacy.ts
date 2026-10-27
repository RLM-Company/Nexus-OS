import type { SqliteIntelligenceGraphWorkspaceRepository } from "@cosmora/db";

/** Structural compatibility with OwnerPrivacyCoordinator, without importing a newer product branch. */
export function intelligenceGraphPrivacyAdapter(store: SqliteIntelligenceGraphWorkspaceRepository) {
  const epochs = new Map<string, number>();
  return {
    id: "intelligence-graphs" as const,
    async quiesce(ownerId: string, epoch: number): Promise<{ drained: true; fence_epoch: number }> {
      // All writes are synchronous; the durable B22 fence is committed before acquiring the writer lock.
      const result = store.privacyQuiesce(ownerId, epoch);
      epochs.set(ownerId, epoch);
      await Promise.resolve();
      return result;
    },
    async export(ownerId: string) {
      const epoch = epochs.get(ownerId);
      if (epoch === undefined) throw new Error("GRAPH_PRIVACY_NOT_QUIESCED");
      const section = store.privacyExport(ownerId, epoch);
      await Promise.resolve();
      return section;
    },
    async delete(ownerId: string, epoch: number): Promise<{ deleted_records: number }> {
      if (epochs.get(ownerId) !== epoch) throw new Error("GRAPH_PRIVACY_NOT_QUIESCED");
      const result = store.privacyDelete(ownerId, epoch);
      await Promise.resolve();
      return result;
    },
    resume(ownerId: string): void {
      // The coordinator owns durable lifecycle transitions. This never clears a fence.
      epochs.delete(ownerId);
    }
  };
}
