import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  consumeFableSseStream,
  unwrapSingleEscapeJsonEnvelope
} from "../src/fable-sse-resilient-stream.ts";
import {
  ContextMemoryPrefixByteCache,
  MandatoryPrefixBudgetError
} from "../../../packages/db/src/context-memory-prefix-byte-cache.ts";
import { WorkflowScheduleAndSubworkflowRunner } from "../../../packages/db/src/workflow-schedule-and-subworkflow-runner.ts";

test("reassembles chunked Fable SSE streams with <escape>JSON</escape>, blocks truncated streams on disconnect, and halts on cancellation", async () => {
  // 1. Valid multi-chunk SSE stream with <escape>JSON</escape>
  const validFrames = [
    'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":412,"output_tokens":0}}}\n\n',
    'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"<escape>{\\"stage\\":\\"plan\\","}}\n\n',
    'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"\\"steps\\":3}</escape>"}}\n\n',
    'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":28}}\n\n',
    'event: message_stop\ndata: {"type":"message_stop"}\n\n'
  ];

  const completed = await consumeFableSseStream<{ stage: string; steps: number }>({
    chunks: validFrames,
    expectJsonStage: true,
    validateSchema: (v): v is { stage: string; steps: number } =>
      Boolean(v && typeof v === "object" && (v as { stage?: string }).stage === "plan")
  });

  assert.equal(completed.status, "completed");
  assert.equal(completed.usageDisposition, "committed");
  assert.equal(completed.inputTokens, 412);
  assert.equal(completed.outputTokens, 28);
  assert.deepEqual(completed.parsedJson, { stage: "plan", steps: 3 });

  // Reject nested <escape> tags
  assert.throws(
    () => unwrapSingleEscapeJsonEnvelope("<escape><escape>{}</escape></escape>"),
    /NESTED_ESCAPE_ENVELOPE_REJECTED/
  );

  // 2. Truncated stream (provider drops connection before message_stop)
  const truncatedFrames = [
    'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":200}}}\n\n',
    'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"<escape>{\\"stage\\":\\"plan\\""}}\n\n'
  ];
  const truncated = await consumeFableSseStream({
    chunks: truncatedFrames,
    expectJsonStage: true
  });
  assert.equal(truncated.status, "truncated_error");
  assert.equal(truncated.errorCode, "FABLE_SSE_TRUNCATED_BEFORE_STOP");
  assert.equal(truncated.usageDisposition, "uncertain");
  assert.equal(truncated.parsedJson, null);

  // 3. Cancelled mid-stream
  let cancelFlag = false;
  async function* cancellableChunks() {
    yield validFrames[0];
    cancelFlag = true;
    yield validFrames[1];
  }
  const cancelled = await consumeFableSseStream({
    chunks: cancellableChunks(),
    isCancelled: () => cancelFlag
  });
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.errorCode, "WORK_CANCELLED_DURING_STREAM");
  assert.equal(cancelled.usageDisposition, "cancelled_after_dispatch");
});

test("caches per-owner memory entry UTF-8 byte measurements across turns, invalidates on version bump, and enforces mandatory prefix budgets", () => {
  const cache = new ContextMemoryPrefixByteCache({ maxEntriesPerOwner: 64 });

  const entries = [
    {
      id: "m-pin-1",
      ownerId: "owner-1",
      version: 1,
      scope: "personal" as const,
      kind: "constraint" as const,
      title: "Обязательный лимит",
      content: "Не превышать бюджет 6000 байт UTF-8 и сохранять ссылки на источники.",
      pinned: true,
      source: { kind: "message", reference: "msg-1" },
      updatedAt: "2026-11-02T06:00:00.000Z"
    },
    {
      id: "m-opt-1",
      ownerId: "owner-1",
      version: 1,
      scope: "project" as const,
      kind: "fact" as const,
      title: "Дополнительный факт",
      content: "Сценарии Koswork поддерживают до 32 шагов и 64000 байт.",
      pinned: false,
      source: { kind: "message", reference: "msg-2" },
      updatedAt: "2026-11-02T06:01:00.000Z"
    }
  ];

  // First pack: 0 cache hits, 2 cache misses
  const pack1 = cache.packLinearWithPrefixBudget({
    ownerId: "owner-1",
    entries,
    maxBudgetBytes: 6000
  });
  assert.equal(pack1.packedEntries.length, 2);
  assert.equal(pack1.cacheHits, 0);
  assert.equal(pack1.cacheMisses, 2);

  // Second pack with unchanged versions: 2 cache hits, 0 cache misses
  const pack2 = cache.packLinearWithPrefixBudget({
    ownerId: "owner-1",
    entries,
    maxBudgetBytes: 6000
  });
  assert.equal(pack2.cacheHits, 2);
  assert.equal(pack2.cacheMisses, 0);
  assert.equal(pack2.totalUtf8Bytes, pack1.totalUtf8Bytes);

  // Bump version on m-opt-1 -> 1 cache hit, 1 cache miss
  const updatedEntries = [
    entries[0],
    { ...entries[1], version: 2, content: "Обновлённый текст записи v2." }
  ];
  const pack3 = cache.packLinearWithPrefixBudget({
    ownerId: "owner-1",
    entries: updatedEntries,
    maxBudgetBytes: 6000
  });
  assert.equal(pack3.cacheHits, 1);
  assert.equal(pack3.cacheMisses, 1);

  // If mandatory prefix alone exceeds maxBudgetBytes, throws MandatoryPrefixBudgetError
  assert.throws(
    () =>
      cache.packLinearWithPrefixBudget({
        ownerId: "owner-1",
        entries,
        maxBudgetBytes: 128,
        strictMandatoryPrefix: true
      }),
    (err: unknown) => err instanceof MandatoryPrefixBudgetError && err.code === "MANDATORY_PREFIX_BUDGET_EXCEEDED"
  );
});

test("inlines sub-workflows, blocks recursive workflow cycles, gates desktop/browser steps on consent, and deduplicates scheduled workflow ticks", () => {
  const sqlite = new DatabaseSync(":memory:");
  const runner = new WorkflowScheduleAndSubworkflowRunner(sqlite);

  // Child workflow with a browser_action step and a critic_review step
  runner.saveWorkflowVersion({
    workflowId: "wf-child-research",
    projectId: "proj-1",
    ownerId: "owner-1",
    version: 1,
    definition: {
      name: "Подсценарий поиска источников",
      description: "Ищет документ и проверяет цитаты",
      parameters: [{ name: "topic", type: "text", required: true }],
      nodes: [
        {
          id: "step-browse",
          title: "Открыть поиск по теме",
          kind: "browser_action",
          browserUrlTemplate: "koswork://search/{{topic}}"
        },
        {
          id: "step-critic",
          title: "Проверка Критиком",
          kind: "critic_review",
          dependsOn: ["step-browse"],
          promptTemplate: "Проверь полноту источников по теме {{topic}}"
        }
      ]
    }
  });

  // Parent workflow invoking wf-child-research as a sub_workflow
  runner.saveWorkflowVersion({
    workflowId: "wf-parent-report",
    projectId: "proj-1",
    ownerId: "owner-1",
    version: 1,
    definition: {
      name: "Главный сценарий отчёта",
      description: "Вызывает подсценарий и формирует итоговую записку",
      parameters: [{ name: "topic", type: "text", required: true }],
      nodes: [
        {
          id: "sub-1",
          title: "Вызов подсценария",
          kind: "sub_workflow",
          subWorkflowId: "wf-child-research",
          subWorkflowVersion: 1
        },
        {
          id: "step-summary",
          title: "Сборка итогового отчёта",
          kind: "work_prompt",
          dependsOn: ["sub-1"],
          promptTemplate: "Сформируй итоговую записку по теме {{topic}}"
        }
      ]
    }
  });

  // Without desktopOrBrowserConsentToken, resolving a workflow containing browser_action must throw
  assert.throws(
    () =>
      runner.resolveAndInlineSubWorkflows({
        ownerId: "owner-1",
        projectId: "proj-1",
        workflowId: "wf-parent-report",
        version: 1,
        inputs: { topic: "Kosmora Fable 5" },
        desktopOrBrowserConsentToken: null
      }),
    /WORKFLOW_DESKTOP_OR_BROWSER_CONSENT_REQUIRED/
  );

  // With consent token, sub-workflow is inlined into 3 concrete steps with interpolated parameters
  const plan = runner.resolveAndInlineSubWorkflows({
    ownerId: "owner-1",
    projectId: "proj-1",
    workflowId: "wf-parent-report",
    version: 1,
    inputs: { topic: "Kosmora Fable 5" },
    desktopOrBrowserConsentToken: "consent-token-valid-1"
  });
  assert.equal(plan.flattenedNodes.length, 3);
  assert.equal(plan.requiresDesktopOrBrowserConsent, true);
  assert.match(plan.flattenedNodes[0].interpolatedPrompt, /Kosmora Fable 5/);

  // Recursive cycle (wf-cycle-a -> wf-cycle-b -> wf-cycle-a) must be rejected immediately
  runner.saveWorkflowVersion({
    workflowId: "wf-cycle-a",
    projectId: "proj-1",
    ownerId: "owner-1",
    version: 1,
    definition: {
      name: "Цикл A",
      description: "",
      parameters: [],
      nodes: [{ id: "n1", title: "Call B", kind: "sub_workflow", subWorkflowId: "wf-cycle-b", subWorkflowVersion: 1 }]
    }
  });
  runner.saveWorkflowVersion({
    workflowId: "wf-cycle-b",
    projectId: "proj-1",
    ownerId: "owner-1",
    version: 1,
    definition: {
      name: "Цикл B",
      description: "",
      parameters: [],
      nodes: [{ id: "n2", title: "Call A", kind: "sub_workflow", subWorkflowId: "wf-cycle-a", subWorkflowVersion: 1 }]
    }
  });

  assert.throws(
    () =>
      runner.resolveAndInlineSubWorkflows({
        ownerId: "owner-1",
        projectId: "proj-1",
        workflowId: "wf-cycle-a",
        version: 1,
        inputs: {}
      }),
    /WORKFLOW_RECURSION_CYCLE_DETECTED/
  );

  // Schedule execution & idempotent slot deduplication
  const sched = runner.createSchedule({
    scheduleId: "sched-daily-1",
    workflowId: "wf-parent-report",
    workflowVersion: 1,
    projectId: "proj-1",
    ownerId: "owner-1",
    cronOrInterval: "0 9 * * *",
    inputs: { topic: "Ежедневная сводка" }
  });

  const tick1 = runner.triggerScheduledTick({
    scheduleId: sched.scheduleId,
    ownerId: "owner-1",
    slotIso: "2026-11-02T09:00:00.000Z",
    desktopOrBrowserConsentToken: "consent-token-valid-1"
  });
  assert.equal(tick1.deduplicated, false);
  assert.equal(tick1.flattenedStepCount, 3);

  // Duplicate tick for the same slotIso returns existing runId/dagId without creating a duplicate run
  const tick2 = runner.triggerScheduledTick({
    scheduleId: sched.scheduleId,
    ownerId: "owner-1",
    slotIso: "2026-11-02T09:00:00.000Z",
    desktopOrBrowserConsentToken: "consent-token-valid-1"
  });
  assert.equal(tick2.deduplicated, true);
  assert.equal(tick2.runId, tick1.runId);
  assert.equal(tick2.dagId, tick1.dagId);
});
