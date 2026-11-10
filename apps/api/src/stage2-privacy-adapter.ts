import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";

export interface Stage2PrivacySection {
  records: Record<string, unknown[]>;
  originals: Array<{
    id: string;
    filename: string;
    content_type: string;
    size_bytes: number;
    sha256: string;
  }>;
  complete: boolean;
  limitations?: string[];
}

export interface Stage2PrivacyAdapter {
  readonly id: string;
  quiesce(ownerId: string, epoch: number): Promise<{ drained: true; fence_epoch: number }>;
  export(ownerId: string): Promise<Stage2PrivacySection>;
  delete(ownerId: string, epoch: number): Promise<{ deleted_records: number }>;
  resume(ownerId: string): Promise<void>;
}

/**
 * Unified Stage-2 Privacy Adapter (`id: "stage2-memory-drive-workflows"`).
 * Implements the `PrivacyAdapter` contract without modifying `apps/api/src/account-settings/**`,
 * coordinating quiesce, export, and deletion across Context Memory, Profile Candidate Dismissals,
 * Bounded Memory Receipts, Google Drive Spool/Catalog, and Koswork Reusable Workflows/Schedules.
 */
export function createStage2PrivacyAdapter(
  sqlite: DatabaseSync,
  options?: { migrationSqlPath?: string }
): Stage2PrivacyAdapter {
  const migrationPath =
    options?.migrationSqlPath ??
    resolve(process.cwd(), "packages/db/migrations/0063_unified_stage2_extensions.sql");

  if (existsSync(migrationPath)) {
    const rawSql = readFileSync(migrationPath, "utf8");
    const statements = rawSql
      .split(/-->\s*statement-breakpoint/g)
      .map((s) => s.trim())
      .filter(Boolean);
    for (const stmt of statements) {
      sqlite.exec(stmt);
    }
  }

  return {
    id: "stage2-memory-drive-workflows",

    async quiesce(ownerId: string, epoch: number): Promise<{ drained: true; fence_epoch: number }> {
      const now = new Date().toISOString();

      sqlite.exec("BEGIN IMMEDIATE");
      try {
        // 1. Fence owner in kosmora_owner_data_lifecycle so all BEFORE INSERT/UPDATE triggers block concurrent writes
        sqlite
          .prepare(
            `INSERT INTO kosmora_owner_data_lifecycle (owner_id, state, epoch, updated_at)
             VALUES (?, 'quiescing', ?, ?)
             ON CONFLICT(owner_id) DO UPDATE SET
               state = 'quiescing',
               epoch = excluded.epoch,
               updated_at = excluded.updated_at`
          )
          .run(ownerId, epoch, now);

        // 2. Disable all active workflow schedules for this owner
        sqlite
          .prepare(
            "UPDATE kosmora_workflow_schedules SET enabled = 0, updated_at = ? WHERE owner_id = ?"
          )
          .run(now, ownerId);

        // 3. Abort and purge any in-flight local Google Drive spool files
        const spoolRows = sqlite
          .prepare(
            "SELECT backup_id, spool_path FROM kosmora_drive_spool_journal WHERE owner_id = ? AND status IN ('spooled', 'uploading')"
          )
          .all(ownerId) as Array<{ backup_id: string; spool_path: string }>;

        for (const sp of spoolRows) {
          if (sp.spool_path && existsSync(sp.spool_path)) {
            try {
              unlinkSync(sp.spool_path);
            } catch {
              // ignore
            }
          }
          sqlite
            .prepare(
              "UPDATE kosmora_drive_spool_journal SET status = 'purged', updated_at = ? WHERE backup_id = ? AND owner_id = ?"
            )
            .run(now, sp.backup_id, ownerId);
        }

        sqlite.exec("COMMIT");
      } catch (err) {
        try {
          sqlite.exec("ROLLBACK");
        } catch {
          // ignore
        }
        throw err;
      }

      return { drained: true, fence_epoch: epoch };
    },

    async export(ownerId: string): Promise<Stage2PrivacySection> {
      const memoryEntries = sqlite
        .prepare("SELECT * FROM context_memory_entries WHERE owner_id = ? ORDER BY created_at ASC, id ASC")
        .all(ownerId);

      const memorySettings = sqlite
        .prepare("SELECT * FROM context_memory_settings WHERE owner_id = ? ORDER BY target_kind ASC, target_id ASC")
        .all(ownerId);

      const memoryDefaults = sqlite
        .prepare("SELECT * FROM context_memory_owner_defaults WHERE owner_id = ?")
        .all(ownerId);

      const candidateDismissals = sqlite
        .prepare("SELECT * FROM profile_candidate_dismissals WHERE owner_id = ? ORDER BY created_at ASC")
        .all(ownerId);

      const memoryUsageReceipts = sqlite
        .prepare("SELECT * FROM context_memory_usage WHERE owner_id = ? ORDER BY created_at DESC, id DESC")
        .all(ownerId);

      const driveSpoolJournal = sqlite
        .prepare(
          "SELECT backup_id, owner_id, sha256, size_bytes, status, attempts, drive_file_id, pinned, created_at, updated_at FROM kosmora_drive_spool_journal WHERE owner_id = ? ORDER BY created_at ASC"
        )
        .all(ownerId);

      const driveRecoveredCatalog = sqlite
        .prepare("SELECT * FROM kosmora_drive_recovered_catalog WHERE owner_id = ? ORDER BY created_at ASC")
        .all(ownerId);

      const workflowDefinitions = sqlite
        .prepare("SELECT * FROM kosmora_workflow_definitions WHERE owner_id = ? ORDER BY created_at ASC, id ASC")
        .all(ownerId) as Array<{ id: string }>;

      const workflowVersions: unknown[] = [];
      for (const def of workflowDefinitions) {
        const vers = sqlite
          .prepare("SELECT * FROM kosmora_workflow_versions WHERE workflow_id = ? ORDER BY version ASC")
          .all(def.id);
        workflowVersions.push(...vers);
      }

      const workflowRuns = sqlite
        .prepare("SELECT * FROM kosmora_workflow_runs WHERE owner_id = ? ORDER BY created_at ASC, id ASC")
        .all(ownerId);

      const workflowSchedules = sqlite
        .prepare("SELECT * FROM kosmora_workflow_schedules WHERE owner_id = ? ORDER BY created_at ASC, schedule_id ASC")
        .all(ownerId);

      return {
        records: {
          context_memory_entries: memoryEntries,
          context_memory_settings: memorySettings,
          context_memory_owner_defaults: memoryDefaults,
          profile_candidate_dismissals: candidateDismissals,
          context_memory_usage: memoryUsageReceipts,
          kosmora_drive_spool_journal: driveSpoolJournal,
          kosmora_drive_recovered_catalog: driveRecoveredCatalog,
          kosmora_workflow_definitions: workflowDefinitions,
          kosmora_workflow_versions: workflowVersions,
          kosmora_workflow_runs: workflowRuns,
          kosmora_workflow_schedules: workflowSchedules
        },
        originals: [],
        complete: true,
        limitations: [
          "Remote files stored inside the owner's personal Google Drive folder remain under the owner's Google account control."
        ]
      };
    },

    async delete(ownerId: string, epoch: number): Promise<{ deleted_records: number }> {
      let deleted = 0;
      const now = new Date().toISOString();

      sqlite.exec("BEGIN IMMEDIATE");
      try {
        sqlite
          .prepare(
            `INSERT INTO kosmora_owner_data_lifecycle (owner_id, state, epoch, updated_at)
             VALUES (?, 'deleting', ?, ?)
             ON CONFLICT(owner_id) DO UPDATE SET
               state = 'deleting',
               epoch = excluded.epoch,
               updated_at = excluded.updated_at`
          )
          .run(ownerId, epoch, now);

        const memIds = sqlite
          .prepare("SELECT id FROM context_memory_entries WHERE owner_id = ?")
          .all(ownerId) as Array<{ id: string }>;
        for (const m of memIds) {
          deleted += sqlite
            .prepare("DELETE FROM context_memory_versions WHERE entry_id = ?")
            .run(m.id).changes;
        }

        const wfIds = sqlite
          .prepare("SELECT id FROM kosmora_workflow_definitions WHERE owner_id = ?")
          .all(ownerId) as Array<{ id: string }>;
        for (const w of wfIds) {
          deleted += sqlite
            .prepare("DELETE FROM kosmora_workflow_versions WHERE workflow_id = ?")
            .run(w.id).changes;
        }

        const ownerTables = [
          "context_memory_entries",
          "context_memory_settings",
          "context_memory_owner_defaults",
          "profile_candidate_dismissals",
          "context_memory_usage",
          "kosmora_drive_spool_journal",
          "kosmora_drive_recovered_catalog",
          "kosmora_workflow_schedules",
          "kosmora_workflow_runs",
          "kosmora_workflow_definitions"
        ];

        for (const table of ownerTables) {
          deleted += sqlite
            .prepare(`DELETE FROM ${table} WHERE owner_id = ?`)
            .run(ownerId).changes;
        }

        sqlite
          .prepare(
            "UPDATE kosmora_owner_data_lifecycle SET state = 'deleted', epoch = ?, updated_at = ? WHERE owner_id = ?"
          )
          .run(epoch, now, ownerId);

        sqlite.exec("COMMIT");
      } catch (err) {
        try {
          sqlite.exec("ROLLBACK");
        } catch {
          // ignore
        }
        throw err;
      }

      return { deleted_records: deleted };
    },

    async resume(ownerId: string): Promise<void> {
      sqlite
        .prepare(
          "UPDATE kosmora_owner_data_lifecycle SET state = 'active', updated_at = ? WHERE owner_id = ?"
        )
        .run(new Date().toISOString(), ownerId);
    }
  };
}
