import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  ContextMemoryHybridSearch,
  buildHybridQueryPlan,
  buildResponseMemoryCitations,
  extractMemoryEntities
} from "../../../packages/db/src/context-memory-hybrid-search.ts";
import { ContextMemoryNotesMigrator } from "../../../packages/db/src/context-memory-notes-migrator.ts";

test("extracts dates, numbers/budgets, identifiers, and named projects and performs hybrid RRF recall", () => {
  const sqlite = new DatabaseSync(":memory:");
  const hybrid = new ContextMemoryHybridSearch(sqlite);
  hybrid.ensureSchema();

  const now = "2026-11-01T12:00:00.000Z";
  const insert = sqlite.prepare(`
    INSERT INTO context_memory_entries (
      id, owner_id, scope, chat_id, project_id, kind, title, content, pinned,
      expires_at, source_json, version, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, 1, ?, ?)
  `);

  // 1. Pinned constraint about token budget
  insert.run(
    "mem-budget",
    "owner-1",
    "personal",
    null,
    null,
    "constraint",
    "Лимит расходов на медиа и контекст",
    "Обязательный потолок: не более $25 в месяц и окно 1050000 токенов в профиле Sol на PR #422.",
    1,
    JSON.stringify({
      kind: "message",
      reference: "msg-101",
      quote: "Обязательный потолок: не более $25 в месяц и окно 1050000 токенов в профиле Sol на PR #422."
    }),
    now,
    now
  );

  // 2. Project decision phrased with different Russian morphological forms
  insert.run(
    "mem-vault",
    "owner-1",
    "project",
    null,
    "proj-alpha",
    "decision",
    "Хранение локальных архивов Koswork",
    "Решили сохранять резервные копии рабочей папки в .kosmora-vault до 2026-11-15.",
    0,
    JSON.stringify({
      kind: "message",
      reference: "msg-102",
      quote: "Решили сохранять резервные копии рабочей папки в .kosmora-vault до 2026-11-15."
    }),
    now,
    now
  );

  // 3. Entry belonging to another owner (must never leak)
  insert.run(
    "mem-other-owner",
    "owner-2",
    "personal",
    null,
    null,
    "fact",
    "Чужой секретный проект",
    "Бюджет $25 и папка .kosmora-vault",
    1,
    "{}",
    now,
    now
  );

  // 4. Entry containing a raw secret key (must be filtered out automatically)
  insert.run(
    "mem-secret",
    "owner-1",
    "personal",
    null,
    null,
    "fact",
    "Случайный ключ API",
    "" + "Мой токен " + "sk-" + "proj1234567890abcdefghijklmnop для тестов" + "",
    0,
    "{}",
    now,
    now
  );

  const entities = extractMemoryEntities("Проверь PR #422 и дедлайн 2026-11-15 на 1050000 токенов в Koswork");
  assert.ok(entities.some((e) => e.kind === "identifier" && e.normalized === "#422"));
  assert.ok(entities.some((e) => e.kind === "date" && e.normalized === "2026-11-15"));
  assert.ok(entities.some((e) => e.kind === "person_or_project" && e.normalized === "koswork"));

  // Query using English/Russian synonyms ("cost limit backup folder 2026-11-15")
  const plan = buildHybridQueryPlan("какой дедлайн по бэкапам сейфа 2026-11-15 и стоимость PR #422");
  assert.ok(plan.expandedStems.length >= 4);

  const bundle = hybrid.recall({
    ownerId: "owner-1",
    query: "какой дедлайн по бэкапам сейфа 2026-11-15 и стоимость PR #422",
    includePersonal: true,
    permittedProjectIds: ["proj-alpha"]
  });

  assert.equal(bundle.items.length, 2);
  assert.equal(bundle.items[0].id, "mem-budget"); // Pinned constraint first
  assert.equal(bundle.items[1].id, "mem-vault");
  assert.ok(!bundle.items.some((i) => i.id === "mem-other-owner"));
  assert.ok(!bundle.items.some((i) => i.id === "mem-secret"));

  // Verify client response citations link back to used memories
  const citations = buildResponseMemoryCitations(
    bundle.items,
    "Согласно вашим правилам, для PR #422 действует окно 1050000 токенов, а архивы в .kosmora-vault хранятся до 2026-11-15."
  );
  assert.equal(citations.length, 2);
  assert.equal(citations[0].memoryId, "mem-budget");
  assert.match(citations[0].previewPath, /memoryPreview=mem-budget/);
});

test("migrates legacy project_memory idempotently with source verification and enforces temporary chat mode", () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE projects (
      id TEXT PRIMARY KEY NOT NULL,
      owner_id TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE'
    );
    CREATE TABLE messages (
      id TEXT PRIMARY KEY NOT NULL,
      project_id TEXT NOT NULL,
      content TEXT NOT NULL
    );
    CREATE TABLE project_memory (
      id TEXT PRIMARY KEY NOT NULL,
      project_id TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      source_json TEXT NOT NULL,
      pinned INTEGER NOT NULL DEFAULT 0,
      forgotten INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  sqlite
    .prepare("INSERT INTO projects (id, owner_id, title, status) VALUES (?, ?, ?, 'ACTIVE')")
    .run("proj-1", "owner-1", "Kosmora Release");
  sqlite
    .prepare("INSERT INTO messages (id, project_id, content) VALUES (?, ?, ?)")
    .run("pmsg-77", "proj-1", "Строго не менять визуал Studio и сайдбар до живой приёмки.");

  sqlite
    .prepare(
      `INSERT INTO project_memory (
        id, project_id, owner_id, version, title, content, source_json, pinned, forgotten, created_at, updated_at
      ) VALUES (?, ?, ?, 2, ?, ?, ?, 1, 0, ?, ?)`
    )
    .run(
      "pmem-1",
      "proj-1",
      "owner-1",
      "Заморозка визуала",
      "Строго не менять визуал Studio и сайдбар до живой приёмки.",
      JSON.stringify({
        kind: "message",
        reference: "pmsg-77",
        quote: "Строго не менять визуал Studio и сайдбар до живой приёмки."
      }),
      "2026-10-30T10:00:00.000Z",
      "2026-10-30T11:00:00.000Z"
    );

  // Also insert a forgotten entry (must not be migrated) and a sensitive secret entry (must be skipped)
  sqlite
    .prepare(
      `INSERT INTO project_memory (
        id, project_id, owner_id, version, title, content, source_json, pinned, forgotten, created_at, updated_at
      ) VALUES (?, ?, ?, 1, ?, ?, '{}', 0, 1, ?, ?)`
    )
    .run("pmem-forgotten", "proj-1", "owner-1", "Удалённая заметка", "Старый текст", "2026-10-30T10:00:00.000Z", "2026-10-30T10:00:00.000Z");

  sqlite
    .prepare(
      `INSERT INTO project_memory (
        id, project_id, owner_id, version, title, content, source_json, pinned, forgotten, created_at, updated_at
      ) VALUES (?, ?, ?, 1, ?, ?, '{}', 0, 0, ?, ?)`
    )
    .run("pmem-secret", "proj-1", "owner-1", "Ключ", "password = superSecretPassword123", "2026-10-30T10:00:00.000Z", "2026-10-30T10:00:00.000Z");

  const migrator = new ContextMemoryNotesMigrator(sqlite);
  const firstRun = migrator.migrateOwnerLegacyMemory("owner-1");

  assert.equal(firstRun.migratedCount, 1);
  assert.equal(firstRun.alreadyMigratedCount, 0);
  assert.equal(firstRun.skippedSensitiveCount, 1);
  assert.equal(firstRun.records[0].kind, "constraint");
  assert.equal(firstRun.records[0].sourceVerified, true);

  // Second run is strictly idempotent
  const secondRun = migrator.migrateOwnerLegacyMemory("owner-1");
  assert.equal(secondRun.migratedCount, 0);
  assert.equal(secondRun.alreadyMigratedCount, 1);
  assert.equal(secondRun.skippedSensitiveCount, 1);

  // Verify default rules and Temporary Mode behavior
  const updatedDefaults = migrator.updateOwnerDefaultRules("owner-1", {
    defaultEnabled: true,
    defaultUsePersonal: true,
    defaultAutoExtract: true,
    defaultTemporaryMode: false
  });
  assert.equal(updatedDefaults.defaultAutoExtract, true);

  const normalChat = migrator.initializeNewChatMemorySettings("owner-1", "chat-normal");
  assert.equal(normalChat.enabled, true);
  assert.equal(normalChat.temporaryMode, false);
  assert.equal(normalChat.autoExtractAllowed, true);

  const tempChat = migrator.initializeNewChatMemorySettings("owner-1", "chat-temp", {
    temporaryMode: true
  });
  assert.equal(tempChat.enabled, false);
  assert.equal(tempChat.usePersonal, false);
  assert.equal(tempChat.temporaryMode, true);
  assert.equal(tempChat.autoExtractAllowed, false);

  // Hybrid recall in temporaryMode returns 0 items
  const hybrid = new ContextMemoryHybridSearch(sqlite);
  const tempRecall = hybrid.recall({
    ownerId: "owner-1",
    query: "Заморозка визуала",
    permittedProjectIds: ["proj-1"],
    temporaryMode: true
  });
  assert.equal(tempRecall.items.length, 0);
});
