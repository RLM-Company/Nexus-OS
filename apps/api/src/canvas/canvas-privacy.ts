import type { CanvasArtifactStore } from "@cosmora/db";

/**
 * Structural match for the integrated OwnerPrivacyCoordinator PrivacyAdapter.
 * Canvas writes are synchronous and fenced inside SQLite writer transactions by CanvasArtifactStore.
 */
export interface CanvasPrivacyLifecycleAdapter {
  readonly id: "canvas";
  quiesce(ownerId: string, epoch: number): Promise<{ drained: true; fence_epoch: number }>;
  export(ownerId: string): Promise<{
    records: Record<string, unknown[]>;
    originals: [];
    complete: true;
  }>;
  exportSegmented(ownerId: string): Promise<{
    records: Record<string, unknown[]>;
    originals: [];
    complete: true;
  }>;
  delete(ownerId: string, epoch: number): Promise<{ deleted_records: number }>;
}

export const canvasPrivacyAdapter = (store: CanvasArtifactStore): CanvasPrivacyLifecycleAdapter => {
  const assertState = (ownerId: string, epoch: number, expected: "quiescing" | "deleting") => {
    // Fails closed if B22 lifecycle tables have not yet been integrated.
    const row = store.sqlite
      .prepare("SELECT state,epoch FROM kosmora_owner_data_lifecycle WHERE owner_id=?")
      .get(ownerId) as { state: string; epoch: number } | undefined;
    if (!row || row.state !== expected || row.epoch !== epoch) {
      throw new Error("CANVAS_PRIVACY_FENCE_MISMATCH");
    }
  };
  const assertExportFence = (ownerId: string) => {
    const row = store.sqlite
      .prepare("SELECT state FROM kosmora_owner_data_lifecycle WHERE owner_id=?")
      .get(ownerId) as { state: string } | undefined;
    if (row?.state !== "quiescing") throw new Error("CANVAS_PRIVACY_EXPORT_NOT_QUIESCED");
  };
  const collect = (ownerId: string, maxBytes: number, maxRecords: number) => {
    assertExportFence(ownerId);
    const versions: unknown[] = [];
    let cursor: string | null = null,
      bytes = 0;
    do {
      const page = store.privacyExport(ownerId, cursor);
      for (const item of page.items) {
        bytes += Buffer.byteLength(JSON.stringify(item), "utf8");
        if (bytes > maxBytes || versions.length >= maxRecords)
          throw new Error(
            maxBytes === 12 * 1024 * 1024
              ? "CANVAS_PRIVACY_SEGMENTED_EXPORT_REQUIRED"
              : "CANVAS_PRIVACY_SEGMENTED_EXPORT_LIMIT"
          );
        versions.push(item);
      }
      cursor = page.next_cursor;
    } while (cursor);
    assertExportFence(ownerId);
    return {
      records: { canvas_revisions: versions },
      originals: [] as [],
      complete: true as const
    };
  };
  return {
    id: "canvas",
    async quiesce(ownerId, epoch) {
      await Promise.resolve();
      assertState(ownerId, epoch, "quiescing");
      // All Canvas writes are synchronous BEGIN IMMEDIATE...COMMIT transactions.
      // The owner fence was committed by the coordinator before this callback runs.
      return { drained: true, fence_epoch: epoch };
    },
    async export(ownerId) {
      await Promise.resolve();
      return collect(ownerId, 12 * 1024 * 1024, 10000);
    },
    async exportSegmented(ownerId) {
      await Promise.resolve();
      return collect(ownerId, 160 * 1024 * 1024, 100000);
    },
    async delete(ownerId, epoch) {
      await Promise.resolve();
      // Check the fence and remove data under one writer lock, including across SQLite connections.
      store.sqlite.exec("BEGIN IMMEDIATE");
      try {
        assertState(ownerId, epoch, "deleting");
        const result = store.privacyDelete(ownerId);
        store.sqlite.exec("COMMIT");
        return { deleted_records: result.artifacts + result.revisions };
      } catch (error) {
        store.sqlite.exec("ROLLBACK");
        throw error;
      }
    }
  };
};
