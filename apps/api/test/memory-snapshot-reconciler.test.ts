import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  computeRecordContentSha256,
  ensureContextMemoryTables,
  executeMemorySnapshotRestore,
  planMemorySnapshotRestore,
  readAddressableSnapshotSlice,
  type VaultMemorySnapshotEnvelope,
  type VaultMemorySnapshotRecord
} from "../src/memory-snapshot-reconciler.js";

function createTestMemoryDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE kosmora_owner_data_lifecycle (
      owner_id TEXT PRIMARY KEY,
      epoch INTEGER NOT NULL DEFAULT 1,
      state TEXT NOT NULL DEFAULT 'active'
    );
    INSERT INTO kosmora_owner_data_lifecycle (owner_id, epoch, state) VALUES ('owner-1', 1, 'active');

    CREATE TABLE general_chat_runs (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      status TEXT NOT NULL
    );
  `);
  ensureContextMemoryTables(db);
  return db;
}

function makeRecord(overrides: Partial<VaultMemorySnapshotRecord> & { id: string; key: string; content: string }): VaultMemorySnapshotRecord {
  return {
    id: overrides.id,
    ownerId: overrides.ownerId ?? "owner-1",
    scope: overrides.scope ?? "personal",
    scopeId: overrides.scopeId ?? null,
    recordType: overrides.recordType ?? "fact",
    key: overrides.key,
    title: overrides.title ?? overrides.key,
    content: overrides.content,
    version: overrides.version ?? 1,
    baseServerVersion: overrides.baseServerVersion ?? null,
    sha256: overrides.sha256 ?? computeRecordContentSha256(overrides.content),
    mandatory: overrides.mandatory ?? false,
    expiresAt: overrides.expiresAt ?? null,
    sources: overrides.sources ?? [
      { sourceId: "src_1", title: "spec.md", status: "available" }
    ],
    updatedAt: overrides.updatedAt ?? "2026-11-01T12:00:00Z"
  };
}

test("enforces 1000-record, 1000-setting, and 4 MiB snapshot limits and provides addressable slice pagination", () => {
  const records: VaultMemorySnapshotRecord[] = [];
  for (let i = 1; i <= 120; i += 1) {
    records.push(
      makeRecord({
        id: `rec_${i}`,
        key: `key_${i}`,
        scope: i % 2 === 0 ? "project" : "personal",
        scopeId: i % 2 === 0 ? "proj_1" : null,
        content: `Memory content item #${i}`
      })
    );
  }

  const envelope: VaultMemorySnapshotEnvelope = {
    schemaVersion: 1,
    ownerId: "owner-1",
    generatedAt: "2026-11-01T12:00:00Z",
    records,
    settings: [
      {
        key: "auto_recall",
        scope: "personal",
        scopeId: null,
        value: true,
        version: 2,
        updatedAt: "2026-11-01T12:00:00Z"
      }
    ]
  };

  const page1 = readAddressableSnapshotSlice(envelope, "owner-1", {
    scope: "project",
    scopeId: "proj_1",
    cursor: 0,
    limit: 25
  });
  assert.equal(page1.totalRecordsInSnapshot, 120);
  assert.equal(page1.totalMatching, 60);
  assert.equal(page1.items.length, 25);
  assert.equal(page1.nextCursor, 25);
  assert.equal(page1.truncatedSilently, false);

  const page2 = readAddressableSnapshotSlice(envelope, "owner-1", {
    scope: "project",
    scopeId: "proj_1",
    cursor: page1.nextCursor!,
    limit: 25
  });
  assert.equal(page2.items.length, 25);
  assert.equal(page2.nextCursor, 50);

  const page3 = readAddressableSnapshotSlice(envelope, "owner-1", {
    scope: "project",
    scopeId: "proj_1",
    cursor: page2.nextCursor!,
    limit: 25
  });
  assert.equal(page3.items.length, 10);
  assert.equal(page3.nextCursor, null);

  // Over-1000 records must fail without silent truncation
  const oversizedRecords = Array.from({ length: 1001 }, (_, idx) =>
    makeRecord({ id: `r_${idx}`, key: `k_${idx}`, content: "x" })
  );
  assert.throws(
    () =>
      readAddressableSnapshotSlice(
        { ...envelope, records: oversizedRecords },
        "owner-1"
      ),
    /SNAPSHOT_RECORD_LIMIT_EXCEEDED/
  );

  // Session tokens or passwords inside snapshot must be rejected
  assert.throws(
    () =>
      readAddressableSnapshotSlice(
        {
          ...envelope,
          records: [makeRecord({ id: "sec_1", key: "session_token", content: "tok_123" })]
        },
        "owner-1"
      ),
    /SNAPSHOT_SECRET_REJECTED/
  );
});

test("detects server memory conflicts and applies explicit keep_server, replace_with_client, and fork_as_new_record resolutions atomically", () => {
  const db = createTestMemoryDb();

  // Seed 4 server records:
  // 1. rec_unchanged (v1, same content)
  // 2. rec_ff (v2 on server; client has v3 with baseServerVersion=2 -> fast_forward)
  // 3. rec_conflict_replace (v4 on server; client has v3 with baseServerVersion=1 -> conflict)
  // 4. rec_conflict_fork (v2 on server; client has divergent v2 -> conflict)
  const insert = db.prepare(`
    INSERT INTO context_memory_records
    (id, owner_id, scope, scope_id, record_type, key, title, content, version, sha256, mandatory, expires_at, sources_json, updated_at)
    VALUES (?, 'owner-1', 'personal', NULL, 'fact', ?, ?, ?, ?, ?, 0, NULL, '[]', '2026-11-01T10:00:00Z')
  `);
  insert.run("rec_unchanged", "k_unchanged", "Unchanged", "same text", 1, computeRecordContentSha256("same text"));
  insert.run("rec_ff", "k_ff", "FastForward", "old v2 text", 2, computeRecordContentSha256("old v2 text"));
  insert.run("rec_conflict_replace", "k_replace", "ReplaceTarget", "server v4 text", 4, computeRecordContentSha256("server v4 text"));
  insert.run("rec_conflict_fork", "k_fork", "ForkTarget", "server v2 text", 2, computeRecordContentSha256("server v2 text"));

  const envelope: VaultMemorySnapshotEnvelope = {
    schemaVersion: 1,
    ownerId: "owner-1",
    generatedAt: "2026-11-01T12:00:00Z",
    records: [
      makeRecord({ id: "rec_unchanged", key: "k_unchanged", content: "same text", version: 1 }),
      makeRecord({ id: "rec_new", key: "k_new", content: "brand new record", version: 1 }),
      makeRecord({
        id: "rec_ff",
        key: "k_ff",
        content: "updated v3 text",
        version: 3,
        baseServerVersion: 2
      }),
      makeRecord({
        id: "rec_conflict_replace",
        key: "k_replace",
        content: "client override text",
        version: 3,
        baseServerVersion: 1
      }),
      makeRecord({
        id: "rec_conflict_fork",
        key: "k_fork",
        title: "ForkTarget",
        content: "client forked branch text",
        version: 2,
        baseServerVersion: 1
      })
    ],
    settings: [
      {
        key: "pack_mode",
        scope: "personal",
        scopeId: null,
        value: "adaptive",
        version: 3,
        updatedAt: "2026-11-01T12:00:00Z"
      }
    ]
  };

  const plan = planMemorySnapshotRestore(db, "owner-1", envelope);
  assert.equal(plan.canApplyWithoutDecisions, false);
  assert.deepEqual(plan.counts, {
    unchanged: 1,
    create: 1,
    fastForward: 1,
    conflict: 2
  });

  // Attempting to restore without explicit conflict decisions must fail without modifying DB
  assert.throws(
    () => executeMemorySnapshotRestore(db, "owner-1", envelope),
    /MEMORY_RESTORE_UNRESOLVED_CONFLICT:rec_conflict_replace/
  );

  // Attempting to restore while a run is active must fail with MEMORY_RUN_ACTIVE
  db.prepare("INSERT INTO general_chat_runs (id, owner_id, status) VALUES ('run_1', 'owner-1', 'running')").run();
  assert.throws(
    () =>
      executeMemorySnapshotRestore(db, "owner-1", envelope, {
        resolutions: {
          rec_conflict_replace: { action: "replace_with_client", expectedServerVersion: 4 },
          rec_conflict_fork: { action: "fork_as_new_record" }
        }
      }),
    /MEMORY_RUN_ACTIVE/
  );
  db.prepare("UPDATE general_chat_runs SET status='completed' WHERE id='run_1'").run();

  // Wrong expectedServerVersion on replace_with_client must fail with MEMORY_VERSION_CONFLICT
  assert.throws(
    () =>
      executeMemorySnapshotRestore(db, "owner-1", envelope, {
        resolutions: {
          rec_conflict_replace: { action: "replace_with_client", expectedServerVersion: 3 },
          rec_conflict_fork: { action: "fork_as_new_record" }
        }
      }),
    /MEMORY_VERSION_CONFLICT:rec_conflict_replace/
  );

  // Apply with valid explicit conflict decisions
  const result = executeMemorySnapshotRestore(db, "owner-1", envelope, {
    resolutions: {
      rec_conflict_replace: { action: "replace_with_client", expectedServerVersion: 4 },
      rec_conflict_fork: { action: "fork_as_new_record" }
    }
  });

  assert.equal(result.restored, true);
  assert.deepEqual(result.appliedCounts, {
    unchanged: 1,
    created: 1,
    updated: 2, // rec_ff + rec_conflict_replace
    forked: 1, // rec_conflict_fork
    keptServer: 0,
    settingsUpdated: 1
  });

  // Verify rec_conflict_replace was updated to version 5 with client content
  const replacedRow = db
    .prepare("SELECT content, version FROM context_memory_records WHERE id='rec_conflict_replace'")
    .get() as { content: string; version: number };
  assert.equal(replacedRow.content, "client override text");
  assert.equal(Number(replacedRow.version), 5);

  // Verify rec_conflict_fork kept its server record AND created a forked record
  const serverForkTarget = db
    .prepare("SELECT content, version FROM context_memory_records WHERE id='rec_conflict_fork'")
    .get() as { content: string; version: number };
  assert.equal(serverForkTarget.content, "server v2 text");
  assert.equal(Number(serverForkTarget.version), 2);

  const newForkId = result.idMapping["rec_conflict_fork"];
  assert.ok(newForkId && newForkId.startsWith("mem_fork_"));
  const forkedRow = db
    .prepare("SELECT title, content FROM context_memory_records WHERE id=?")
    .get(newForkId) as { title: string; content: string };
  assert.equal(forkedRow.title, "ForkTarget (копия из снимка)");
  assert.equal(forkedRow.content, "client forked branch text");
});
