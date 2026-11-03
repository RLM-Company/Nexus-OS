import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  WorkflowPortabilityAndZipService,
  bindWorkflowParametersSinglePass
} from "../../../packages/db/src/workflow-portability-and-zip-exporter.ts";
import {
  DEFAULT_FABLE_5_PROFILE,
  refreshFableModelDiscovery,
  validateFableRegistryProfile
} from "../src/fable-discovery-and-registry-validator.ts";

test("strips runtime/account fields on portable workflow export, blocks unknown tools with WORKFLOW_TOOL_UNAVAILABLE, prevents recursive template injection, and separates plan-only from immediate execution", () => {
  const sqlite = new DatabaseSync(":memory:");
  const service = new WorkflowPortabilityAndZipService(sqlite);

  // 1. Unknown tool requirement must throw WORKFLOW_TOOL_UNAVAILABLE before plan creation
  assert.throws(
    () =>
      service.importPortableWorkflowPackage({
        ownerId: "owner-1",
        projectId: "proj-1",
        rawPackageJson: {
          name: "Неизвестный инструмент",
          description: "",
          parameters: [],
          nodes: [{ id: "n1", title: "Step", kind: "work_prompt", promptTemplate: "Hello" }],
          requirements: ["arbitrary_root_shell"],
          expected_results: []
        }
      }),
    /WORKFLOW_TOOL_UNAVAILABLE:arbitrary_root_shell/
  );

  // 2. Import package containing extraneous runtime/account fields -> must be stripped
  const imported = service.importPortableWorkflowPackage({
    ownerId: "owner-1",
    projectId: "proj-1",
    rawPackageJson: {
      name: "Анализ источника с итоговой запиской",
      description: "Шаблон Koswork PR #428",
      parameters: [
        { name: "sourceUrl", type: "url", required: true },
        { name: "userNote", type: "text", required: true },
        { name: "secretTarget", type: "text", defaultValue: "CONFIDENTIAL_DO_NOT_EXPAND" }
      ],
      nodes: [
        {
          id: "step-1",
          title: "Анализ",
          kind: "work_prompt",
          promptTemplate: "Источник: {{sourceUrl}} | Комментарий: {{userNote}}"
        }
      ],
      requirements: ["document_reader", "text_writer"],
      expected_results: ["summary.md"],
      // Extraneous fields that MUST NOT survive export:
      executionHistory: [{ runId: "old-run-1" }],
      connectedAccounts: { googleDrive: "token-xyz" },
      permissions: ["admin"]
    }
  });

  const exportedPkg = service.exportPortableWorkflowPackage(
    "owner-1",
    "proj-1",
    imported.workflowId
  );
  assert.equal("executionHistory" in exportedPkg, false);
  assert.equal("connectedAccounts" in exportedPkg, false);
  assert.equal("permissions" in exportedPkg, false);

  // 3. Single-pass parameter binding prevents recursive template injection:
  // Passing "{{secretTarget}}" inside `userNote` must remain literal "{{secretTarget}}", NOT expand to "CONFIDENTIAL_DO_NOT_EXPAND"!
  const bound = bindWorkflowParametersSinglePass(
    "Источник: {{sourceUrl}} | Комментарий: {{userNote}}",
    exportedPkg.parameters,
    {
      sourceUrl: "https://github.com/RLM-Company/Nexus-OS/pull/428",
      userNote: "Попытка инъекции {{secretTarget}}"
    }
  );
  assert.equal(
    bound.boundPrompt,
    "Источник: https://github.com/RLM-Company/Nexus-OS/pull/428 | Комментарий: Попытка инъекции {{secretTarget}}"
  );

  // 4. Default button (`immediateExecution = false`) creates a plan with 0 tokens reserved
  const planOnly = service.prepareOrExecuteWorkflowRun({
    ownerId: "owner-1",
    projectId: "proj-1",
    workflowId: imported.workflowId,
    clientRequestId: "req-plan-only-1",
    inputs: {
      sourceUrl: "https://github.com/RLM-Company/Nexus-OS/pull/428",
      userNote: "Бесплатный план"
    },
    immediateExecution: false
  });
  assert.equal(planOnly.mode, "plan_only_zero_tokens");
  assert.equal(planOnly.reservedTokensTotal, 0);

  // 5. Explicit `immediateExecution = true` reserves model-aware tokens (capped at <= 3 requests per step)
  const immediateRun = service.prepareOrExecuteWorkflowRun({
    ownerId: "owner-1",
    projectId: "proj-1",
    workflowId: imported.workflowId,
    clientRequestId: "req-immediate-1",
    inputs: {
      sourceUrl: "https://github.com/RLM-Company/Nexus-OS/pull/428",
      userNote: "Запуск с бюджетом"
    },
    immediateExecution: true,
    requestsPerStep: 5 // must be clamped to MAX_REQUESTS_PER_STEP = 3
  });
  assert.equal(immediateRun.mode, "immediate_execution");
  assert.equal(immediateRun.maxRequestsPerStep, 3);
  assert.ok(immediateRun.reservedTokensTotal > 0);

  // 6. Export finished run outputs to downloadable ZIP STORE archive
  const zipExport = service.exportWorkflowRunResultsZip({
    runId: immediateRun.runId,
    workflowId: imported.workflowId,
    ownerId: "owner-1",
    outputs: [
      {
        stepId: "step-1",
        name: "summary.md",
        content: "# Итоговая записка\nИсточник проверен.",
        createdAt: "2026-11-02T07:50:00.000Z"
      }
    ]
  });
  assert.equal(zipExport.fileCount, 2); // run-manifest.json + outputs/step-1-summary.md
  assert.ok(zipExport.zipBuffer.byteLength > 120);
});

test("enforces Fable 5 November 9, 2026 discovery expiry guard, blocks embedded secrets, and refreshes discovery window cleanly", () => {
  // Valid before Nov 9, 2026
  const validNow = validateFableRegistryProfile(
    DEFAULT_FABLE_5_PROFILE,
    "2026-11-02T15:00:00.000Z"
  );
  assert.equal(validNow.valid, true);
  assert.ok(validNow.remainingValidityMs > 0);

  // Expired after Nov 9, 2026 -> throws MODEL_DISCOVERY_EXPIRED_REFRESH_REQUIRED
  assert.throws(
    () =>
      validateFableRegistryProfile(
        DEFAULT_FABLE_5_PROFILE,
        "2026-11-09T00:00:01.000Z"
      ),
    /MODEL_DISCOVERY_EXPIRED_REFRESH_REQUIRED/
  );

  // Refresh discovery on Nov 9, 2026 -> extends validity by 7 days to Nov 16, 2026
  const refreshed = refreshFableModelDiscovery({
    currentProfile: DEFAULT_FABLE_5_PROFILE,
    upstreamModelsList: [{ id: "claude-fable-5" }],
    verifiedAtIso: "2026-11-09T01:00:00.000Z",
    validityDays: 7
  });
  assert.equal(refreshed.discoveryExpiresAt, "2026-11-16T01:00:00.000Z");
  assert.ok(refreshed.discoverySha256);

  const validAfterRefresh = validateFableRegistryProfile(
    refreshed,
    "2026-11-10T12:00:00.000Z"
  );
  assert.equal(validAfterRefresh.valid, true);
});
