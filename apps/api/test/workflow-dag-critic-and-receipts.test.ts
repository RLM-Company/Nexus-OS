import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  WorkflowLifecycleAndPrivacyManager,
  evaluateWorkflowCriticCheck,
  getInitialKosworkScenarioTemplates,
  reorderWorkflowStepsSafely,
  validateAndBuildTopologicalWaves
} from "../../../packages/db/src/workflow-dag-templates-and-critic.ts";
import { ContextMemoryReceiptsStore } from "../../../packages/db/src/context-memory-receipts-store.ts";

test("validates the 3 initial Koswork templates, builds topological DAG waves, enforces safe step reordering, evaluates Critic checks, and protects version immutability", () => {
  const templates = getInitialKosworkScenarioTemplates();
  assert.ok(templates.document_report);
  assert.ok(templates.text_to_materials);
  assert.ok(templates.source_analysis_summary);

  const waves = validateAndBuildTopologicalWaves(templates.document_report.nodes);
  assert.deepEqual(waves.orderedNodeIds, ["extract-facts", "draft-report", "critic-check"]);

  // Attempting to reorder 'draft-report' before its dependency 'extract-facts' must throw
  assert.throws(
    () =>
      reorderWorkflowStepsSafely(templates.document_report.nodes, [
        "draft-report",
        "extract-facts",
        "critic-check"
      ]),
    /WORKFLOW_REORDER_VIOLATES_DEPENDENCY/
  );

  // Critic check passes when all steps, artifacts, and mandatory tokens are present
  const criticPass = evaluateWorkflowCriticCheck({
    definition: templates.document_report,
    stepOutputs: {
      "extract-facts": "Факт 1: лимит 64000 байт UTF-8.",
      "draft-report": "Черновик отчёта с лимитом 64000 байт UTF-8."
    },
    producedArtifacts: {
      "report.md": "# Отчёт\nЛимит пакета составляет 64000 байт UTF-8.",
      "citations-summary.json": '{"verified":true}'
    },
    mandatoryTokensToPreserve: ["64000"]
  });
  assert.equal(criticPass.passed, true);
  assert.equal(criticPass.score, 1);

  // Lifecycle manager: idempotent creation, optimistic version check, and SQL version immutability trigger
  const sqlite = new DatabaseSync(":memory:");
  const lifecycle = new WorkflowLifecycleAndPrivacyManager(sqlite);

  const created1 = lifecycle.createIdempotent({
    ownerId: "owner-1",
    projectId: "proj-1",
    clientCreationId: "create-key-1",
    definition: templates.text_to_materials
  });
  assert.equal(created1.deduplicated, false);
  assert.equal(created1.version, 1);

  const created2 = lifecycle.createIdempotent({
    ownerId: "owner-1",
    projectId: "proj-1",
    clientCreationId: "create-key-1",
    definition: templates.text_to_materials
  });
  assert.equal(created2.deduplicated, true);
  assert.equal(created2.workflowId, created1.workflowId);

  // Stale expectedVersion must fail with WORKFLOW_VERSION_CONFLICT
  const updated = lifecycle.updateWithExpectedVersion({
    ownerId: "owner-1",
    projectId: "proj-1",
    workflowId: created1.workflowId,
    expectedVersion: 1,
    definition: templates.source_analysis_summary
  });
  assert.equal(updated.version, 2);

  assert.throws(
    () =>
      lifecycle.updateWithExpectedVersion({
        ownerId: "owner-1",
        projectId: "proj-1",
        workflowId: created1.workflowId,
        expectedVersion: 1,
        definition: templates.document_report
      }),
    /WORKFLOW_VERSION_CONFLICT/
  );

  // Attempting to mutate an existing row in kosmora_workflow_versions must trigger WORKFLOW_VERSION_IMMUTABLE
  assert.throws(
    () =>
      sqlite
        .prepare("UPDATE kosmora_workflow_versions SET definition_json = '{}' WHERE workflow_id = ? AND version = 1")
        .run(created1.workflowId),
    /WORKFLOW_VERSION_IMMUTABLE/
  );

  const privacyExport = lifecycle.exportOwnerPrivacyData("owner-1");
  assert.equal(privacyExport.definitionsCount, 1);
  assert.equal(privacyExport.versionsCount, 2);

  const privacyDel = lifecycle.deleteOwnerPrivacyData("owner-1");
  assert.equal(privacyDel.deletedDefinitions, 1);
});

test("records bounded source receipts in context_memory_usage and prunes oldest records beyond the per-owner limit", () => {
  const sqlite = new DatabaseSync(":memory:");
  const store = new ContextMemoryReceiptsStore(sqlite, { maxReceiptsPerOwner: 5 });

  for (let i = 1; i <= 7; i++) {
    store.recordReceipt({
      ownerId: "owner-1",
      targetKind: "chat",
      targetId: "chat-1",
      chatId: "chat-1",
      runId: `run-${i}`,
      requestId: `req-${i}`,
      attempt: 1,
      channel: "chat",
      phase: "prompt_pack",
      usedSources: [
        {
          entryId: `mem-${i}`,
          scope: "personal",
          kind: "constraint",
          version: 1,
          sourceReference: `msg-${i}`,
          quoteSha256: `sha256-${i}`
        }
      ],
      createdAt: `2026-11-02T07:0${i}:00.000Z`
    });
  }

  // Only the 5 newest receipts (run-7 down to run-3) remain for owner-1
  const listed = store.listOwnerReceipts("owner-1");
  assert.equal(listed.length, 5);
  assert.equal(listed[0].runId, "run-7");
  assert.equal(listed[4].runId, "run-3");

  const byRun = store.listOwnerReceipts("owner-1", { runId: "run-6" });
  assert.equal(byRun.length, 1);
  assert.equal(byRun[0].usedSources[0].entryId, "mem-6");
});
