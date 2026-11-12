import type { DatabaseSync } from "node:sqlite";
import type { ResearchCoordinator } from "./research-coordinator.js";
import type { ResearchStore } from "./research-store.js";

export interface ResearchPrivacyExportSection {
  records: {
    runs: Record<string, unknown>[];
    steps: Record<string, unknown>[];
    sources: Record<string, unknown>[];
    claims: Record<string, unknown>[];
    research_runs: Record<string, unknown>[];
    research_run_steps: Record<string, unknown>[];
    research_sources: Record<string, unknown>[];
    research_claims: Record<string, unknown>[];
  };
  originals: Array<{
    id: string;
    filename: string;
    content_type: string;
    size_bytes: number;
    sha256: string;
  }>;
  complete: boolean;
}

/**
 * Canonical `ResearchIntegratedPrivacyAdapter` referenced by `apps/api/src/server.ts` (line 203):
 * `new ResearchIntegratedPrivacyAdapter(database.sqlite, researchStore, () => researchCoordinator)`
 *
 * Implements owner lifecycle quiesce (aborting in-flight research runs for the owner and fencing writes),
 * full GDPR/owner data export (`research_runs`, `research_run_steps`, `research_sources`, `research_claims`),
 * transactional owner deletion without affecting other owners, and lifecycle resume.
 */
export class ResearchIntegratedPrivacyAdapter {
  public readonly id = "research";

  constructor(
    private readonly sqlite: DatabaseSync,
    private readonly store: ResearchStore,
    private readonly getCoordinator: () => ResearchCoordinator | null
  ) {}

  public async quiesce(
    ownerId: string,
    epoch: number
  ): Promise<{ drained: true; fence_epoch: number; cancelled_runs: number }> {
    const coordinator = this.getCoordinator();
    const cancelledRuns = coordinator ? await coordinator.quiesceOwner(ownerId) : 0;
    const now = new Date().toISOString();

    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      this.sqlite
        .prepare(
          `INSERT INTO kosmora_owner_data_lifecycle (owner_id, state, epoch, updated_at)
           VALUES (?, 'quiescing', ?, ?)
           ON CONFLICT(owner_id) DO UPDATE SET
             state = 'quiescing',
             epoch = excluded.epoch,
             updated_at = excluded.updated_at`
        )
        .run(ownerId, epoch, now);

      this.sqlite
        .prepare(
          `UPDATE research_runs
           SET status = 'cancelled',
               error_code = 'OWNER_DATA_QUIESCED',
               error_message = 'Остановлено на время операции приватности владельца.',
               updated_at = ?
           WHERE owner_id = ? AND status IN ('queued', 'running')`
        )
        .run(now, ownerId);

      this.sqlite.exec("COMMIT");
    } catch (err) {
      try {
        this.sqlite.exec("ROLLBACK");
      } catch {
        /* ignore */
      }
      throw err;
    }

    return {
      drained: true,
      fence_epoch: epoch,
      cancelled_runs: cancelledRuns
    };
  }

  public async export(ownerId: string): Promise<ResearchPrivacyExportSection> {
    const runs = this.sqlite
      .prepare("SELECT * FROM research_runs WHERE owner_id = ? ORDER BY created_at ASC, id ASC")
      .all(ownerId) as Array<{ id: string }>;

    const steps: unknown[] = [];
    for (const run of runs) {
      const runSteps = this.sqlite
        .prepare(
          "SELECT * FROM research_run_steps WHERE run_id = ? ORDER BY step_index ASC"
        )
        .all(run.id);
      steps.push(...runSteps);
    }

    const sources = this.sqlite
      .prepare(
        "SELECT * FROM research_sources WHERE owner_id = ? ORDER BY fetched_at ASC, source_id ASC"
      )
      .all(ownerId);

    const claims = this.sqlite
      .prepare(
        "SELECT * FROM research_claims WHERE owner_id = ? ORDER BY created_at ASC, claim_id ASC"
      )
      .all(ownerId);

    return {
      records: {
        runs: runs as Record<string, unknown>[],
        steps: steps as Record<string, unknown>[],
        sources: sources as Record<string, unknown>[],
        claims: claims as Record<string, unknown>[],
        research_runs: runs as Record<string, unknown>[],
        research_run_steps: steps as Record<string, unknown>[],
        research_sources: sources as Record<string, unknown>[],
        research_claims: claims as Record<string, unknown>[]
      },
      originals: [],
      complete: true
    };
  }

  public async delete(
    ownerId: string,
    epoch: number
  ): Promise<{ deleted_records: number }> {
    const coordinator = this.getCoordinator();
    if (coordinator) {
      await coordinator.quiesceOwner(ownerId);
    }

    let deleted = 0;
    const now = new Date().toISOString();

    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      this.sqlite
        .prepare(
          `INSERT INTO kosmora_owner_data_lifecycle (owner_id, state, epoch, updated_at)
           VALUES (?, 'deleting', ?, ?)
           ON CONFLICT(owner_id) DO UPDATE SET
             state = 'deleting',
             epoch = excluded.epoch,
             updated_at = excluded.updated_at`
        )
        .run(ownerId, epoch, now);

      const ownerRuns = this.sqlite
        .prepare("SELECT id FROM research_runs WHERE owner_id = ?")
        .all(ownerId) as Array<{ id: string }>;

      for (const r of ownerRuns) {
        deleted += Number(
          this.sqlite
            .prepare("DELETE FROM research_run_steps WHERE run_id = ?")
            .run(r.id).changes || 0
        );
      }

      deleted += Number(
        this.sqlite
          .prepare("DELETE FROM research_claims WHERE owner_id = ?")
          .run(ownerId).changes || 0
      );
      deleted += Number(
        this.sqlite
          .prepare("DELETE FROM research_sources WHERE owner_id = ?")
          .run(ownerId).changes || 0
      );
      deleted += Number(
        this.sqlite
          .prepare("DELETE FROM research_runs WHERE owner_id = ?")
          .run(ownerId).changes || 0
      );
      deleted += Number(
        this.sqlite
          .prepare(
            "DELETE FROM kosmora_roaring_inverted_snapshots WHERE owner_id = ? AND namespace = 'research_evidence'"
          )
          .run(ownerId).changes || 0
      );
      deleted += Number(
        this.sqlite
          .prepare(
            "DELETE FROM kosmora_probabilistic_filter_snapshots WHERE owner_id = ? AND namespace = 'research_evidence'"
          )
          .run(ownerId).changes || 0
      );
      deleted += Number(
        this.sqlite
          .prepare(
            "DELETE FROM kosmora_session_audit_blackbox WHERE owner_id = ? AND session_id LIKE 'research:%'"
          )
          .run(ownerId).changes || 0
      );

      this.sqlite
        .prepare(
          "UPDATE kosmora_owner_data_lifecycle SET state = 'deleted', epoch = ?, updated_at = ? WHERE owner_id = ?"
        )
        .run(epoch, now, ownerId);

      this.sqlite.exec("COMMIT");
    } catch (err) {
      try {
        this.sqlite.exec("ROLLBACK");
      } catch {
        /* ignore */
      }
      throw err;
    }

    return { deleted_records: deleted };
  }

  public async resume(ownerId: string): Promise<void> {
    const now = new Date().toISOString();
    this.sqlite
      .prepare(
        `UPDATE kosmora_owner_data_lifecycle
         SET state = 'active', updated_at = ?
         WHERE owner_id = ?`
      )
      .run(now, ownerId);
  }
}
