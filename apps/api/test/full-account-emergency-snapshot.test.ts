import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { FullAccountEmergencySnapshotService } from "../src/cloud-storage/full-account-emergency-snapshot.ts";

test("exports and atomically restores a full-account emergency snapshot (chats, messages, Work artifacts, and memories) over canonical ZIP STORE", () => {
  const sourceDb = new DatabaseSync(":memory:");
  const targetDb = new DatabaseSync(":memory:");

  const exporter = new FullAccountEmergencySnapshotService(sourceDb);

  sourceDb
    .prepare(
      "INSERT INTO general_chats (id, owner_id, title, created_at, updated_at) VALUES ('c-em-1', 'owner-1', 'Аварийный дамп чата', '2026-11-01T10:00:00.000Z', '2026-11-01T10:05:00.000Z')"
    )
    .run();

  sourceDb
    .prepare(
      "INSERT INTO general_chat_messages (id, chat_id, owner_id, role, content_type, content, status, created_at, updated_at) VALUES ('m-em-1', 'c-em-1', 'owner-1', 'user', 'text', 'Сохрани полный образ аккаунта', 'completed', '2026-11-01T10:01:00.000Z', '2026-11-01T10:01:00.000Z')"
    )
    .run();

  sourceDb
    .prepare(
      "INSERT INTO general_chat_messages (id, chat_id, owner_id, role, content_type, content, status, created_at, updated_at) VALUES ('m-em-2', 'c-em-1', 'owner-1', 'assistant', 'text', 'Прерванный ответ...', 'streaming', '2026-11-01T10:02:00.000Z', '2026-11-01T10:02:00.000Z')"
    )
    .run();

  const wfBody = "Результат задачи Koswork для полного аварийного снимка";
  const wfSha = createHash("sha256").update(wfBody, "utf8").digest("hex");
  sourceDb
    .prepare(
      "INSERT INTO work_artifact_versions (id, project_id, work_id, name, version, content, sha256, bytes, published, created_at) VALUES ('wf-em-1', 'p-1', 'w-1', 'report.md', 1, ?, ?, ?, 1, '2026-11-01T10:03:00.000Z')"
    )
    .run(wfBody, wfSha, Buffer.byteLength(wfBody, "utf8"));

  sourceDb
    .prepare(
      "INSERT INTO context_memory_entries (id, owner_id, scope, kind, title, content, pinned, source_json, version, created_at, updated_at) VALUES ('mem-em-1', 'owner-1', 'personal', 'constraint', 'Правило безопасности', 'Всегда проверять CRC32 и SHA-256 перед восстановлением', 1, '{}', 1, '2026-11-01T10:04:00.000Z', '2026-11-01T10:04:00.000Z')"
    )
    .run();

  const exported = exporter.exportFullAccountEmergencyZip("owner-1", "emergency-20261102");
  assert.equal(exported.summary.counts.chats, 1);
  assert.equal(exported.summary.counts.messages, 2);
  assert.equal(exported.summary.counts.workFiles, 1);
  assert.equal(exported.summary.counts.memories, 1);
  assert.ok(exported.zipBuffer.byteLength > 200);

  const restorer = new FullAccountEmergencySnapshotService(targetDb);
  const restored = restorer.restoreFullAccountEmergencyZip("owner-1", exported.zipBuffer);

  assert.equal(restored.restoredChats, 1);
  assert.equal(restored.restoredMessages, 2);
  assert.equal(restored.restoredWorkFiles, 1);
  assert.equal(restored.restoredMemories, 1);
  assert.equal(restored.interruptedMessagesQuiesced, 1);

  // Verify idempotency on second run
  const secondRestore = restorer.restoreFullAccountEmergencyZip("owner-1", exported.zipBuffer);
  assert.equal(secondRestore.restoredChats, 0);
  assert.equal(secondRestore.restoredMessages, 0);
  assert.equal(secondRestore.restoredWorkFiles, 0);
  assert.equal(secondRestore.restoredMemories, 0);
});
