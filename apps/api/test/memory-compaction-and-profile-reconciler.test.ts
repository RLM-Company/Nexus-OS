import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  compactHistoryByTopicsAndChanges,
  restoreCompactedTopicDetails
} from "../../../packages/db/src/history-compaction-topic-analyzer.ts";
import { ProfileCandidateReconciler } from "../../../packages/db/src/profile-candidate-reconciler.ts";
import { VpsChatHistoryMigrator } from "../../../packages/db/src/vps-chat-history-migrator.ts";
import { evaluateVpsConnectivityProbeResult } from "../../../scripts/vps-chat-recovery-and-tls-probe.mjs";

test("compacts history by topics, tracks parameter change chains, measures 0% mandatory constraint loss, and restores verbatim details", () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE general_chat_messages (
      id TEXT PRIMARY KEY NOT NULL,
      chat_id TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  const messages = [
    {
      id: "m-1",
      role: "user" as const,
      content: "Строго не меняй визуал Studio и сайдбар! Начальный лимит окна 28000 токенов.",
      created_at: "2026-10-31T10:00:00.000Z"
    },
    {
      id: "m-2",
      role: "assistant" as const,
      content: "Принято, сохраняю ограничение на визуал и лимит 28000 токенов.",
      created_at: "2026-10-31T10:01:00.000Z"
    },
    {
      id: "m-3",
      role: "user" as const,
      content: "Мы пересмотрели параметры модели Sol: теперь лимит окна 1050000 токенов, а дедлайн релиза 2026-11-15.",
      created_at: "2026-10-31T11:00:00.000Z"
    },
    {
      id: "m-4",
      role: "user" as const,
      content: "" + "Временный ключ " + "sk-" + "secret999999999999999999999999 не должен попадать в капсулу." + "",
      created_at: "2026-10-31T11:05:00.000Z"
    },
    {
      id: "m-5",
      role: "user" as const,
      content: "Текущий вопрос: проверь готовность PR #422.",
      created_at: "2026-10-31T12:00:00.000Z"
    },
    {
      id: "m-6",
      role: "assistant" as const,
      content: "Проверяю PR #422.",
      created_at: "2026-10-31T12:01:00.000Z"
    }
  ];

  const insertStmt = sqlite.prepare(
    "INSERT INTO general_chat_messages (id, chat_id, owner_id, role, content, created_at) VALUES (?, 'chat-1', 'owner-1', ?, ?, ?)"
  );
  for (const m of messages) {
    insertStmt.run(m.id, m.role, m.content, m.created_at);
  }

  const compacted = compactHistoryByTopicsAndChanges({
    enabled: true,
    messages,
    keepRecentCount: 2,
    maxCapsuleBytes: 8000
  });

  assert.equal(compacted.dispatchBlocked, false);
  assert.equal(compacted.report.state, "applied");
  assert.equal(compacted.report.sensitive_messages, 1);
  assert.equal(compacted.report.fidelity.mandatoryConstraintRetentionRate, 1);
  assert.ok(compacted.report.change_events_count >= 1);

  // Verify the state change from 28000 tokens to 1050000 tokens was tracked
  const budgetCapsule = compacted.capsules.find((c) => c.topic === "budget_and_limits");
  assert.ok(budgetCapsule);
  assert.equal(budgetCapsule.changeEvents.length, 1);
  assert.match(budgetCapsule.changeEvents[0].previousValue, /28000/);
  assert.match(budgetCapsule.changeEvents[0].currentValue, /1050000/);

  // Verify detail restoration recovers original messages and verifies SHA-256 quote hashes
  const restored = restoreCompactedTopicDetails(sqlite, "owner-1", "chat-1", budgetCapsule);
  assert.ok(restored.length >= 1);
  assert.ok(restored.some((r) => r.verifiedQuoteHashes.length >= 1));

  // Verify that if maxCapsuleBytes is too small to fit mandatory constraints, dispatchBlocked is true
  const blocked = compactHistoryByTopicsAndChanges({
    enabled: true,
    messages,
    keepRecentCount: 2,
    maxCapsuleBytes: 256
  });
  assert.equal(blocked.dispatchBlocked, true);
  assert.equal(blocked.report.state, "blocked");
  assert.equal(blocked.report.reason, "protected_budget");
});

test("extracts profile candidates, detects contradictions, promotes to personal profile, and records non-destructive deletion exceptions", () => {
  const sqlite = new DatabaseSync(":memory:");
  const reconciler = new ProfileCandidateReconciler(sqlite);
  reconciler.ensureSchema();

  sqlite.exec(`
    CREATE TABLE general_chats (
      id TEXT PRIMARY KEY NOT NULL,
      owner_id TEXT NOT NULL,
      title TEXT NOT NULL
    );
    CREATE TABLE general_chat_messages (
      id TEXT PRIMARY KEY NOT NULL,
      chat_id TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      role TEXT NOT NULL,
      status TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  sqlite
    .prepare("INSERT INTO general_chats (id, owner_id, title) VALUES ('chat-a', 'owner-1', 'Main Chat')")
    .run();

  // Existing personal memory says budget ceiling is $15
  sqlite
    .prepare(
      `INSERT INTO context_memory_entries (
        id, owner_id, scope, kind, title, content, pinned, source_json, version, created_at, updated_at
      ) VALUES ('entry-old-budget', 'owner-1', 'personal', 'constraint', 'Старый лимит', 'Обязательно сохраняй потолок расходов на медиа 1500 рублей в месяц.', 1, '{}', 1, '2026-10-29T10:00:00.000Z', '2026-10-29T10:00:00.000Z')`
    )
    .run();

  // User messages in chat-a: one updates the budget ceiling to 3500 рублей (contradiction!), another states a preference
  sqlite
    .prepare(
      `INSERT INTO general_chat_messages (id, chat_id, owner_id, role, status, content, created_at)
       VALUES (?, 'chat-a', 'owner-1', 'user', 'completed', ?, ?)`
    )
    .run(
      "msg-new-1",
      "Обязательно сохраняй потолок расходов на медиа 3500 рублей в месяц.\nЯ предпочитаю краткие технические отчёты на русском языке.",
      "2026-11-01T10:00:00.000Z"
    );

  const scan1 = reconciler.scanAuthorizedChatCandidates("owner-1");
  assert.equal(scan1.candidates.length, 2);
  assert.equal(scan1.contradictionCount, 1);

  const conflictingCand = scan1.candidates.find((c) => c.contradictsEntryId === "entry-old-budget");
  assert.ok(conflictingCand);
  assert.match(conflictingCand.contradictionReason ?? "", /3500/);

  // Promote the conflicting candidate with replace_existing
  const promoted = reconciler.promoteCandidateToProfile({
    ownerId: "owner-1",
    candidate: conflictingCand,
    resolution: "replace_existing"
  });
  assert.equal(promoted.entryId, "entry-old-budget");
  assert.equal(promoted.replacedEntryId, "entry-old-budget");
  assert.equal(promoted.version, 2);

  // Promote the second candidate (preference) as a new profile entry
  const prefCand = scan1.candidates.find((c) => c.kind === "preference");
  assert.ok(prefCand);
  const promotedPref = reconciler.promoteCandidateToProfile({
    ownerId: "owner-1",
    candidate: prefCand
  });
  assert.ok(promotedPref.entryId);

  // Delete the promoted preference with auto-extract exception
  const delRes = reconciler.deleteMemoryWithAutoExtractException("owner-1", promotedPref.entryId);
  assert.equal(delRes.deleted, true);
  assert.equal(delRes.sourceConversationIntact, true);

  // Re-scanning the chat must skip both candidates (one updated, one dismissed via exception)
  const scan2 = reconciler.scanAuthorizedChatCandidates("owner-1");
  assert.equal(scan2.candidates.length, 0);
  assert.equal(scan2.skippedDismissedCount, 2);
});

test("exports and restores user chats and memories in bounded SHA-256 verified batches for the 1 GB RAM replacement VPS", () => {
  const sourceDb = new DatabaseSync(":memory:");
  const targetDb = new DatabaseSync(":memory:");

  const exporter = new VpsChatHistoryMigrator(sourceDb);
  exporter.ensureTables();

  sourceDb
    .prepare(
      "INSERT INTO general_chats (id, owner_id, title, created_at, updated_at) VALUES ('c-1', 'owner-1', 'Kosmora VPS Chat', '2026-10-25T10:00:00.000Z', '2026-10-25T10:05:00.000Z')"
    )
    .run();
  sourceDb
    .prepare(
      "INSERT INTO general_chat_runs (id, chat_id, status, provider, model_resolved, input_tokens, output_tokens, created_at, updated_at) VALUES ('r-1', 'c-1', 'succeeded', 'cheapvibecode', 'sol-1m', 120, 340, '2026-10-25T10:01:00.000Z', '2026-10-25T10:02:00.000Z')"
    )
    .run();
  sourceDb
    .prepare(
      "INSERT INTO general_chat_messages (id, chat_id, owner_id, role, content_type, content, status, client_message_id, run_id, error_code, created_at, updated_at) VALUES ('gm-1', 'c-1', 'owner-1', 'user', 'text', 'Восстанови историю чатов на новом VPS', 'completed', 'cli-1', 'r-1', NULL, '2026-10-25T10:01:00.000Z', '2026-10-25T10:01:00.000Z')"
    )
    .run();
  sourceDb
    .prepare(
      "INSERT INTO context_memory_entries (id, owner_id, scope, chat_id, project_id, kind, title, content, pinned, expires_at, source_chat_message_id, source_project_message_id, source_json, version, created_at, updated_at, creation_key, creation_sha256) VALUES ('cm-1', 'owner-1', 'personal', NULL, NULL, 'fact', 'VPS параметры', '1 vCPU / 1 GB RAM', 1, NULL, 'gm-1', NULL, '{}', 1, '2026-10-25T10:02:00.000Z', '2026-10-25T10:02:00.000Z', 'k-1', 'sha-1')"
    )
    .run();

  const bundle = exporter.exportOwnerHistoryBundle("owner-1", 10);
  assert.equal(bundle.totalRows, 4);
  assert.equal(bundle.batches.length, 4);

  const importer = new VpsChatHistoryMigrator(targetDb);
  const firstRestore = importer.restoreOwnerHistoryBundle(bundle);
  assert.equal(firstRestore.insertedChats, 1);
  assert.equal(firstRestore.insertedRuns, 1);
  assert.equal(firstRestore.insertedMessages, 1);
  assert.equal(firstRestore.insertedMemories, 1);
  assert.equal(firstRestore.skippedExistingRows, 0);

  // Second restore is idempotent
  const secondRestore = importer.restoreOwnerHistoryBundle(bundle);
  assert.equal(secondRestore.insertedChats, 0);
  assert.equal(secondRestore.skippedExistingRows, 4);

  // Verify PR #423 connectivity probe evaluator handles fenced staging ingress cleanly
  const probeEval = evaluateVpsConnectivityProbeResult({
    httpReachable: false,
    httpsReachable: false,
    internalHealthPassed: true,
    allowFencedIngress: true
  });
  assert.equal(probeEval.status, "fenced_staging_ingress");
  assert.equal(probeEval.ciShouldPass, true);
});
