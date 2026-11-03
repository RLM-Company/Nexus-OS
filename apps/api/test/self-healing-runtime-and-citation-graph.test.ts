import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { SelfHealingWorkflowRuntime } from "../../../packages/db/src/self-healing-workflow-runtime.ts";
import { VaultCrossCitationGraphEngine } from "../../../packages/db/src/vault-cross-citation-graph.ts";

test("heals failed workflow DAG steps in-flight with remedial directives, enforces max 3 attempts, and resumes idempotently", async () => {
  const sqlite = new DatabaseSync(":memory:");
  const runtime = new SelfHealingWorkflowRuntime(sqlite);

  const initial = runtime.initializeRunState({
    runId: "run-heal-101",
    workflowId: "wf-spec-report",
    ownerId: "owner-1",
    projectId: "proj-1",
    nodeIds: ["step-extract", "step-summarize"]
  });

  assert.equal(initial.overallStatus, "running");
  assert.equal(initial.stepStates["step-extract"].status, "pending");

  // Step 1: fails on attempt 1, heals on attempt 2 using remedial directive
  let extractCalls = 0;
  const healRes = await runtime.executeStepWithSelfHealing({
    runId: "run-heal-101",
    stepId: "step-extract",
    executeStepFn: async (attempt, directive) => {
      extractCalls++;
      if (attempt === 1) {
        throw new Error("EMPTY_EXTRACTION_BUFFER");
      }
      assert.ok(directive && directive.includes("EMPTY_EXTRACTION_BUFFER"));
      return { output: "Успешно извлечённые проверенные факты попытки 2." };
    }
  });

  assert.equal(healRes.status, "completed");
  assert.equal(healRes.attemptsUsed, 2);
  assert.equal(healRes.wasHealed, true);
  assert.match(healRes.output, /попытки 2/);

  // Re-running step-extract resumes idempotently from SQLite checkpoint without re-executing
  const resumedRes = await runtime.executeStepWithSelfHealing({
    runId: "run-heal-101",
    stepId: "step-extract",
    executeStepFn: async () => {
      throw new Error("SHOULD_NOT_BE_CALLED_WHEN_COMPLETED");
    }
  });
  assert.equal(resumedRes.status, "completed");
  assert.equal(resumedRes.attemptsUsed, 2);

  // Step 2: fails all 3 attempts -> marked as 'failed'
  let summarizeCalls = 0;
  const failRes = await runtime.executeStepWithSelfHealing({
    runId: "run-heal-101",
    stepId: "step-summarize",
    executeStepFn: async () => {
      summarizeCalls++;
      throw new Error("PERSISTENT_CRITIC_VETO");
    }
  });

  assert.equal(failRes.status, "failed");
  assert.equal(failRes.attemptsUsed, 3);
  assert.equal(summarizeCalls, 3);
});

test("builds multi-document cross-citation graph and detects factual budget and date contradictions across documents", () => {
  const engine = new VaultCrossCitationGraphEngine();

  const documents = [
    {
      id: "doc-1",
      filename: "Architecture-Overview.md",
      format: "md",
      text: "Основная архитектура Kosmora: бюджет проекта составляет $25 в месяц. Ссылка на документ: Release-Notes.md."
    },
    {
      id: "doc-2",
      filename: "Release-Notes.md",
      format: "md",
      text: "Примечания к выпуску: дедлайн релиза назначен на 2026-11-09. Архитектура описана в Architecture-Overview.md."
    },
    {
      id: "doc-3",
      filename: "Conflicting-Budget-Plan.md",
      format: "md",
      text: "Финансовый план Kosmora: согласованный бюджет проекта составляет $50 в месяц, а дедлайн релиза перенесён на 2026-11-20."
    }
  ];

  const graph = engine.buildKnowledgeGraph(documents);

  assert.equal(graph.documentCount, 3);
  assert.ok(graph.totalSentences >= 4);

  // Cross-citation links must include bidirectional references between doc-1 and doc-2
  assert.ok(graph.citations.some((c) => c.sourceDocId === "doc-1" && c.targetDocId === "doc-2"));
  assert.ok(graph.citations.some((c) => c.sourceDocId === "doc-2" && c.targetDocId === "doc-1"));

  // Contradiction detection must identify the budget discrepancy ($25 vs $50) between doc-1 and doc-3
  const budgetContradiction = graph.contradictions.find(
    (c) =>
      (c.docA.id === "doc-1" && c.docB.id === "doc-3") ||
      (c.docA.id === "doc-3" && c.docB.id === "doc-1")
  );
  assert.ok(budgetContradiction, "Should detect budget contradiction between doc-1 and doc-3");
  assert.equal(budgetContradiction.severity, "critical");
  assert.match(budgetContradiction.discrepancyReason, /\$25/);
  assert.match(budgetContradiction.discrepancyReason, /\$50/);
});
