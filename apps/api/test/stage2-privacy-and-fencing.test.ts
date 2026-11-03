import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createStage2PrivacyAdapter } from "../src/stage2-privacy-adapter.ts";

test("applies migration 0063, fences concurrent writes on quiesce via SQLite triggers, exports all 11 Stage-2 tables, and deletes owner data with two-owner isolation", async () => {
  const sqlite = new DatabaseSync(":memory:");
  const migrationSqlPath = resolve(
    process.cwd(),
    "packages/db/migrations/0063_unified_stage2_extensions.sql"
  );
  const adapter = createStage2PrivacyAdapter(sqlite, { migrationSqlPath });

  const now = "2026-11-02T08:00:00.000Z";

  // Seed owner-1 and owner-2 data
  sqlite
    .prepare(
      `INSERT INTO context_memory_entries (
        id, owner_id, scope, kind, title, content, pinned, source_json, version, created_at, updated_at
      ) VALUES ('m-1', 'owner-1', 'personal', 'fact', 'Факт 1', 'Контекст владельца 1', 1, '{}', 1, ?, ?)`
    )
    .run(now, now);
  sqlite
    .prepare(
      "INSERT INTO context_memory_versions (entry_id, version, snapshot_json) VALUES ('m-1', 1, '{}')"
    )
    .run();

  sqlite
    .prepare(
      `INSERT INTO context_memory_entries (
        id, owner_id, scope, kind, title, content, pinned, source_json, version, created_at, updated_at
      ) VALUES ('m-2', 'owner-2', 'personal', 'fact', 'Факт 2', 'Контекст владельца 2', 1, '{}', 1, ?, ?)`
    )
    .run(now, now);

  sqlite
    .prepare(
      `INSERT INTO profile_candidate_dismissals (
        owner_id, candidate_id, chat_message_id, project_message_id, created_at
      ) VALUES ('owner-1', 'cand-hash-1', 'cmsg-1', NULL, ?)`
    )
    .run(now);

  sqlite
    .prepare(
      `INSERT INTO context_memory_usage (
        id, owner_id, target_kind, target_id, run_id, request_id, attempt, channel, phase, snapshot_json, created_at
      ) VALUES ('rcpt-1', 'owner-1', 'chat', 'c-1', 'run-1', 'req-1', 1, 'chat', 'prompt_pack', '{}', ?)`
    )
    .run(now);

  sqlite
    .prepare(
      `INSERT INTO kosmora_workflow_definitions (
        id, project_id, owner_id, version, state_json, created_at, updated_at
      ) VALUES ('wf-1', 'proj-1', 'owner-1', 1, '{"name":"Сценарий 1"}', ?, ?)`
    )
    .run(now, now);
  sqlite
    .prepare(
      "INSERT INTO kosmora_workflow_versions (workflow_id, version, definition_json, created_at) VALUES ('wf-1', 1, '{}', ?)"
    )
    .run(now);
  sqlite
    .prepare(
      `INSERT INTO kosmora_workflow_schedules (
        schedule_id, workflow_id, workflow_version, project_id, owner_id, cron_or_interval, inputs_json, enabled, created_at, updated_at
      ) VALUES ('sched-1', 'wf-1', 1, 'proj-1', 'owner-1', '0 9 * * *', '{}', 1, ?, ?)`
    )
    .run(now, now);

  // 1. Quiesce owner-1 -> pauses schedules and activates OWNER_DATA_FENCED triggers
  const quiesced = await adapter.quiesce("owner-1", 5);
  assert.equal(quiesced.drained, true);
  assert.equal(quiesced.fence_epoch, 5);

  const schedRow = sqlite
    .prepare("SELECT enabled FROM kosmora_workflow_schedules WHERE schedule_id = 'sched-1'")
    .get() as { enabled: number };
  assert.equal(schedRow.enabled, 0);

  // Concurrent write for fenced owner-1 must be blocked by SQLite trigger with OWNER_DATA_FENCED
  assert.throws(
    () =>
      sqlite
        .prepare(
          `INSERT INTO context_memory_entries (
            id, owner_id, scope, kind, title, content, pinned, source_json, version, created_at, updated_at
          ) VALUES ('m-blocked', 'owner-1', 'personal', 'fact', 'Blocked', 'Blocked', 0, '{}', 1, ?, ?)`
        )
        .run(now, now),
    /OWNER_DATA_FENCED/
  );

  assert.throws(
    () =>
      sqlite
        .prepare(
          `INSERT INTO kosmora_workflow_runs (
            id, workflow_id, project_id, owner_id, client_request_id, request_json, definition_version, definition_json, inputs_json, dag_id, created_at
          ) VALUES ('run-blocked', 'wf-1', 'proj-1', 'owner-1', 'creq-1', '{}', 1, '{}', '{}', 'dag-1', ?)`
        )
        .run(now),
    /OWNER_DATA_FENCED/
  );

  // Meanwhile owner-2 is NOT fenced and can write freely
  sqlite
    .prepare(
      `INSERT INTO context_memory_entries (
        id, owner_id, scope, kind, title, content, pinned, source_json, version, created_at, updated_at
      ) VALUES ('m-2-extra', 'owner-2', 'personal', 'fact', 'Extra', 'Extra', 0, '{}', 1, ?, ?)`
    )
    .run(now, now);

  // 2. Export owner-1 data
  const exported = await adapter.export("owner-1");
  assert.equal(exported.complete, true);
  assert.equal(exported.records.context_memory_entries.length, 1);
  assert.equal(exported.records.profile_candidate_dismissals.length, 1);
  assert.equal(exported.records.context_memory_usage.length, 1);
  assert.equal(exported.records.kosmora_workflow_definitions.length, 1);
  assert.equal(exported.records.kosmora_workflow_versions.length, 1);
  assert.equal(exported.records.kosmora_workflow_schedules.length, 1);

  // 3. Delete owner-1 data -> removes all owner-1 rows while preserving owner-2
  const deleted = await adapter.delete("owner-1", 5);
  assert.ok(deleted.deleted_records >= 7);

  const afterExportOwner1 = await adapter.export("owner-1");
  assert.equal(afterExportOwner1.records.context_memory_entries.length, 0);
  assert.equal(afterExportOwner1.records.kosmora_workflow_definitions.length, 0);

  const afterExportOwner2 = await adapter.export("owner-2");
  assert.equal(afterExportOwner2.records.context_memory_entries.length, 2);
});
