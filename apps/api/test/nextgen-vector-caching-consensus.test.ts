import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  DenseVectorSemanticSearch,
  computeCosineSimilarity,
  generateDenseSemanticVector
} from "../../../packages/db/src/dense-vector-semantic-search.ts";
import { optimizePromptCachingLayout } from "../../../packages/core/src/prompt-caching-optimizer.ts";
import { MultiAgentConsensusEngine } from "../../../packages/db/src/multi-agent-consensus-engine.ts";

test("generates 64-dimensional dense semantic vectors, stores them in SQLite, and performs Dense+Sparse RRF hybrid search", () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE context_memory_entries (
      id TEXT PRIMARY KEY NOT NULL,
      owner_id TEXT NOT NULL,
      scope TEXT NOT NULL,
      chat_id TEXT,
      project_id TEXT,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      pinned INTEGER NOT NULL DEFAULT 0,
      version INTEGER NOT NULL DEFAULT 1,
      source_json TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL
    );
  `);

  const denseEngine = new DenseVectorSemanticSearch(sqlite);

  // 1. Semantic vectors test: cosine similarity between related concepts is high
  const vecBudget = generateDenseSemanticVector("Потолок бюджета и лимит расходов на токены");
  const vecCost = generateDenseSemanticVector("Финансовые ограничения стоимости и затрат");
  const vecUnrelated = generateDenseSemanticVector("Рецепт приготовления яблочного пирога с корицей");

  const simRelated = computeCosineSimilarity(vecBudget, vecCost);
  const simUnrelated = computeCosineSimilarity(vecBudget, vecUnrelated);

  assert.ok(simRelated > simUnrelated, `simRelated (${simRelated}) should be > simUnrelated (${simUnrelated})`);
  assert.ok(simRelated > 0.35);

  // 2. Index memory entries in SQLite
  const now = new Date().toISOString();
  const entries = [
    {
      id: "mem-dense-1",
      ownerId: "owner-1",
      scope: "personal",
      kind: "constraint",
      title: "Потолок расходов на модель",
      content: "Обязательное условие: максимальный расход $25 в месяц."
    },
    {
      id: "mem-dense-2",
      ownerId: "owner-1",
      scope: "project",
      kind: "fact",
      title: "Параметры Fable 5",
      content: "Контекстное окно модели составляет 1000000 токенов."
    }
  ];

  for (const e of entries) {
    sqlite
      .prepare(
        `INSERT INTO context_memory_entries (id, owner_id, scope, kind, title, content, pinned, version, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, 1, ?)`
      )
      .run(e.id, e.ownerId, e.scope, e.kind, e.title, e.content, now);

    denseEngine.indexMemoryEntryVector(e);
  }

  // 3. True Dense + Sparse RRF hybrid search
  const hits = denseEngine.hybridSearch({
    ownerId: "owner-1",
    query: "максимальный потолок расходов на модель: лимит затрат"
  });

  assert.ok(hits.length >= 1);
  assert.equal(hits[0].id, "mem-dense-1");
  assert.ok(hits[0].scores.denseCosineScore > 0);
  assert.ok(hits[0].scores.fusedRrfScore > 0);
});

test("optimizes prompt blocks into stable immutable prefixes and assigns 1024-token Anthropic prompt caching checkpoints", () => {
  const blocks = [
    {
      id: "active-turn-1",
      role: "active_turn" as const,
      content: "Пользователь: Проверь статус развёртывания Fable 5 на сервере.",
      isImmutablePrefix: false
    },
    {
      id: "system-prompt-1",
      role: "system" as const,
      // Create a substantial system prompt (>1024 tokens)
      content: "Ты — Kosmora, автономная операционная среда и надежный ассистент компании RLM-Company. ".repeat(75),
      isImmutablePrefix: true
    },
    {
      id: "tools-def-1",
      role: "tools" as const,
      content: "Описание инструментов Work DAG, Critic и Google Drive Backup. ".repeat(60),
      isImmutablePrefix: true
    },
    {
      id: "pinned-mem-1",
      role: "pinned_memory" as const,
      content: "Обязательные закреплённые правила: не использовать вымышленные данные и сохранять ссылки. ".repeat(40),
      isImmutablePrefix: true
    }
  ];

  const report = optimizePromptCachingLayout(blocks);

  // System and Tools must be placed FIRST before active turn
  assert.equal(report.blocks[0].role, "system");
  assert.equal(report.blocks[1].role, "tools");
  assert.equal(report.blocks[report.blocks.length - 1].role, "active_turn");

  assert.ok(report.assignedCheckpoints >= 1);
  assert.ok(report.estimatedCacheHitRate > 0.7);
  assert.ok(report.estimatedInputCostSavingsPercent > 60.0);
  assert.ok(report.blocks.some((b) => b.hasCacheCheckpoint && b.prefixHash.length === 64));
});

test("evaluates autonomous multi-agent consensus across Proposer, Adversarial Critic, and Fact-Auditor perspectives", () => {
  const engine = new MultiAgentConsensusEngine();

  const evidence = [
    {
      id: "ev-1",
      title: "Спецификация Koswork",
      text: "Сценарии Koswork поддерживают до 32 шагов, пакет до 64000 байт UTF-8 и до 100 определений на проект."
    }
  ];

  // 1. Pass: clean draft matching requirements and evidence without fluff
  const validReport = engine.evaluateConsensus({
    taskGoal: "Составить техническую сводку по лимитам сценариев Koswork",
    expectedRequirements: ["Лимиты шагов", "Размер пакета в байтах", "Определения на проект"],
    sourceEvidence: evidence,
    draftContent:
      "Техническая сводка по сценариям Koswork:\n" +
      "1. Количество шагов: до 32 шагов в сценарии.\n" +
      "2. Максимальный размер пакета: 64000 байт UTF-8.\n" +
      "3. Лимит определений: до 100 определений на проект.\n" +
      "Все требования проверены и согласованы."
  });

  assert.equal(validReport.verdict, "consensus_reached");
  assert.ok(validReport.overallConfidenceScore >= 0.9);
  assert.equal(validReport.flaws.length, 0);

  // 2. Revisions/Veto: contains ungrounded superlative and fabricated number ($500 000)
  const flawedReport = engine.evaluateConsensus({
    taskGoal: "Составить техническую сводку",
    expectedRequirements: ["Лимиты шагов"],
    sourceEvidence: evidence,
    draftContent:
      "Это безупречно лучшая система в мире, которая экономит $500 000 в месяц и работает идеально!"
  });

  assert.notEqual(flawedReport.verdict, "consensus_reached");
  assert.ok(flawedReport.flaws.some((f) => f.category === "superlative_fluff"));
  assert.ok(flawedReport.flaws.some((f) => f.category === "unverified_metric"));
  assert.ok(flawedReport.remediationDirectives.length >= 2);
});
