/**
 * Kosmora 160-Feature Comprehensive Verification & End-to-End Scenario Suite
 * Covers all 5 end-to-end functional scenarios, all 8 PR #380 blocker regressions,
 * negative/tamper/concurrency/timeout tests, SQLite persistence across reopen,
 * and all 160 feature adapters (F001-F160).
 */

import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { inflateRawSync } from "node:zlib";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import {
  CanvasVersionConflictError,
  ExternalConnectorError,
  KOSMORA_160_CATALOG,
  KosmoraAutonomyEngine,
  KosmoraCanvasEngine,
  KosmoraEnterpriseSecurityEngine,
  KosmoraIntelligenceGraph,
  KosmoraRuntimeStore,
  KosmoraSkillsBus,
  KOSMORA_192_EXTENDED_CATALOG,
  KOSMORA_STAGE7_CATALOG,
  KOSMORA_STAGE8_CATALOG,
  KOSMORA_STAGE9_CATALOG,
  KOSMORA_STAGE10_CATALOG,
  KOSMORA_STAGE11_CATALOG,
  KOSMORA_STAGE12_CATALOG,
  KOSMORA_256_COMPLETE_CATALOG,
  KOSMORA_320_ULTIMATE_CATALOG,
  KOSMORA_384_SOVEREIGN_CATALOG,
  KOSMORA_STAGE13_CATALOG,
  KOSMORA_STAGE14_CATALOG,
  KOSMORA_448_OMEGA_CATALOG,
  KOSMORA_STAGE15_CATALOG,
  KOSMORA_STAGE16_CATALOG,
  KOSMORA_512_APEX_CATALOG,
  verifyStage15TopologicalPersistenceModules,
  verifyStage16WasmEvolutionarySynthModules,
  KosmoraTopologicalPersistenceEngine,
  KosmoraWasmEvolutionarySynthEngine,
  verifyStage13NeurosymbolicSatModules,
  verifyStage14CyberneticControlModules,
  KosmoraNeurosymbolicSatEngine,
  KosmoraCyberneticControlEngine,
  KosmoraSovereignClusterEngine,
  KosmoraFormalVerificationEngine,
  KosmoraFinOpsComplianceEngine,
  KosmoraQuantumZkEngine,
  KosmoraGameTheoryEngine,
  KosmoraCausalBayesianEngine,
  KosmoraHomomorphicVdfEngine,
  verifyCoreStages96Modules,
  verifyStage6SovereignModules,
  verifyStage7FormalModules,
  verifyStage8FinOpsModules,
  verifyStage9QuantumZkModules,
  verifyStage10GameTheoryModules,
  verifyStage11CausalBayesianModules,
  verifyStage12HomomorphicVdfModules
} from "../../core/src/index.js";
import { verifyStage_stage3_skills_bus } from "../../tool-runtime/src/stage3-skills-bus/index.js";
import { verifyStage_stage5_enterprise } from "../../policy-engine/src/stage5-enterprise/index.js";
import { createKosmoraControlPlane, createKosmoraHttpServer, KosmoraApiController } from "../../../apps/api/src/kosmora-routes.js";
import {
  KosmoraDagWorker,
  SandboxIsolationUnavailableError
} from "../../../apps/worker/src/kosmora-dag-worker.js";
import {
  buildKosmoraWorkspaceViewModel,
  KOSMORA_MONOCHROME_THEME
} from "../../../apps/web/src/app/kosmora-workspace/view-model.js";

test("Scenario 1: Planning & DAG Execution (topological sort, cycle/missing-dep rejection, idempotency, HITL token gate, cancellation, and restart recovery)", () => {
  const autonomy = new KosmoraAutonomyEngine();

  // 1a. Reject missing dependency
  assert.throws(
    () =>
      autonomy.compilePlan({
        plan_id: "plan_bad_dep",
        tenant_id: "t1",
        workspace_id: "w1",
        project_id: "p1",
        goal: "Missing dep check",
        max_parallelism: 2,
        budget_limit_usd: 10,
        tasks: [
          {
            node_id: "n1",
            title: "Task 1",
            agent_role: "planner",
            dependencies: ["non_existent_node"],
            estimated_tokens: 100,
            estimated_cost_usd: 0.01
          }
        ]
      }),
    /non-existent dependency/i
  );

  // 1b. Reject cyclic dependency graph
  assert.throws(
    () =>
      autonomy.compilePlan({
        plan_id: "plan_cycle",
        tenant_id: "t1",
        workspace_id: "w1",
        project_id: "p1",
        goal: "Cycle check",
        max_parallelism: 2,
        budget_limit_usd: 10,
        tasks: [
          {
            node_id: "a",
            title: "A",
            agent_role: "planner",
            dependencies: ["b"],
            estimated_tokens: 100,
            estimated_cost_usd: 0.01
          },
          {
            node_id: "b",
            title: "B",
            agent_role: "coder",
            dependencies: ["a"],
            estimated_tokens: 100,
            estimated_cost_usd: 0.01
          }
        ]
      }),
    /Cycle detected/i
  );

  // 1c. Compile valid 4-node DAG with HITL gate on node 3
  const plan = autonomy.compilePlan({
    plan_id: "plan_e2e_1",
    tenant_id: "tenant_corp",
    workspace_id: "ws_main",
    project_id: "proj_dag_e2e",
    goal: "End-to-end financial audit and publication",
    max_parallelism: 2,
    budget_limit_usd: 5.0,
    tasks: [
      {
        node_id: "t1_ingest",
        title: "Ingest filings",
        agent_role: "researcher",
        dependencies: [],
        estimated_tokens: 500,
        estimated_cost_usd: 0.05
      },
      {
        node_id: "t2_model",
        title: "Build model",
        agent_role: "analyst",
        dependencies: ["t1_ingest"],
        estimated_tokens: 1000,
        estimated_cost_usd: 0.1
      },
      {
        node_id: "t3_hitl_publish",
        title: "Publish external report",
        agent_role: "synthesizer",
        dependencies: ["t2_model"],
        estimated_tokens: 400,
        estimated_cost_usd: 0.04,
        requires_hitl: true,
        hitl_action_scope: "publish:board_report_q4"
      },
      {
        node_id: "t4_notify",
        title: "Send completion summary",
        agent_role: "verifier",
        dependencies: ["t3_hitl_publish"],
        estimated_tokens: 200,
        estimated_cost_usd: 0.02
      }
    ]
  });

  assert.equal(plan.acyclic_verified, true);
  assert.deepEqual(plan.topological_order, [
    "t1_ingest",
    "t2_model",
    "t3_hitl_publish",
    "t4_notify"
  ]);

  // Step 1: only t1_ingest is ready
  const step1 = autonomy.scheduleNextBatch(plan);
  assert.deepEqual(
    step1.ready_batch.map((n) => n.node_id),
    ["t1_ingest"]
  );

  // Complete t1_ingest with delivery_id and verify idempotent replay does not double-count tokens
  const res1 = autonomy.recordTaskResult(plan, "t1_ingest", {
    succeeded: true,
    actual_tokens: 500,
    actual_cost_usd: 0.05,
    output_summary: "Filings ingested",
    delivery_id: "deliv_t1_001"
  });
  assert.equal(res1.idempotent_replay, false);
  assert.equal(plan.consumed_tokens, 500);

  const res1Replay = autonomy.recordTaskResult(plan, "t1_ingest", {
    succeeded: true,
    actual_tokens: 500,
    actual_cost_usd: 0.05,
    output_summary: "Duplicate delivery",
    delivery_id: "deliv_t1_001"
  });
  assert.equal(res1Replay.idempotent_replay, true);
  assert.equal(plan.consumed_tokens, 500);

  // Step 2: t2_model becomes ready and completes
  const step2 = autonomy.scheduleNextBatch(plan);
  assert.deepEqual(
    step2.ready_batch.map((n) => n.node_id),
    ["t2_model"]
  );
  autonomy.recordTaskResult(plan, "t2_model", {
    succeeded: true,
    actual_tokens: 1000,
    actual_cost_usd: 0.1,
    output_summary: "Model verified",
    delivery_id: "deliv_t2_001"
  });

  // Step 3: t3_hitl_publish requires HITL; worker must pause and NEVER auto-approve
  const store = new KosmoraRuntimeStore(":memory:");
  const worker = new KosmoraDagWorker(autonomy, store);
  const pausedSummary = worker.runAutonomyPlanJob(plan);
  assert.equal(pausedSummary.final_status, "paused_awaiting_hitl");
  assert.deepEqual(pausedSummary.awaiting_hitl_nodes, ["t3_hitl_publish"]);
  const t3Node = plan.nodes.find((n) => n.node_id === "t3_hitl_publish")!;
  assert.equal(t3Node.human_approved, false);

  // Request HITL approval token and verify forged token is rejected
  const hitlReq = autonomy.requestHitlApproval(
    plan,
    "t3_hitl_publish",
    "publish:board_report_q4"
  );
  assert.throws(
    () =>
      autonomy.approveHitlNode({
        plan,
        node_id: "t3_hitl_publish",
        approval_token: "forged_invalid_token",
        approver_id: "user_cfo"
      }),
    /not found/i
  );

  // Resume worker with valid HITL approval token -> completes t3_hitl_publish and t4_notify
  const finalSummary = worker.runAutonomyPlanJob(plan, {
    hitl_approvals: {
      t3_hitl_publish: {
        approval_token: hitlReq.approval_token,
        approver_id: "user_cfo_verified",
        reason: "Approved after Q4 balance sheet sign-off"
      }
    }
  });
  assert.equal(finalSummary.final_status, "completed");
  assert.equal(t3Node.human_approved, true);
  assert.equal(t3Node.approved_by, "user_cfo_verified");

  // Verify failure/cancellation propagation to downstream dependents
  const cancelPlan = autonomy.compilePlan({
    plan_id: "plan_cancel_prop",
    tenant_id: "t1",
    workspace_id: "w1",
    project_id: "p1",
    goal: "Cancellation propagation test",
    max_parallelism: 2,
    budget_limit_usd: 5,
    tasks: [
      {
        node_id: "up",
        title: "Upstream",
        agent_role: "planner",
        dependencies: [],
        estimated_tokens: 100,
        estimated_cost_usd: 0.01
      },
      {
        node_id: "down",
        title: "Downstream dependent",
        agent_role: "coder",
        dependencies: ["up"],
        estimated_tokens: 100,
        estimated_cost_usd: 0.01
      }
    ]
  });
  autonomy.cancelTaskNode(cancelPlan, "up", "User aborted upstream task");
  const afterCancel = autonomy.scheduleNextBatch(cancelPlan);
  assert.equal(afterCancel.ready_batch.length, 0);
  assert.equal(
    cancelPlan.nodes.find((n) => n.node_id === "down")?.status,
    "blocked"
  );

  store.close(true);
});

test("Scenario 2: Canvas Artifact Lifecycle (immutable revisions, optimistic concurrency conflict, true LCS diff, and real binary XLSX/PDF/ZIP exports)", () => {
  const canvas = new KosmoraCanvasEngine();

  const rev1 = canvas.commitRevision({
    artifact_id: "art_q4_memo",
    kind: "document",
    title: "Q4 Financial Memo",
    author_id: "analyst_01",
    commit_message: "Initial draft",
    blocks: [
      {
        block_id: "b1",
        type: "markdown",
        heading: "Executive Summary",
        content: "Line 1: Revenue reached $12.4M.\nLine 2: Operating margin was 22%.\nLine 3: Headcount remained flat.",
        citations: []
      }
    ]
  });

  assert.equal(rev1.version, 1);
  assert.equal(Object.isFrozen(rev1), true);
  assert.equal(Object.isFrozen(rev1.blocks), true);

  // Commit v2 with matching expected_version: 1
  const rev2 = canvas.commitRevision({
    artifact_id: "art_q4_memo",
    kind: "document",
    title: "Q4 Financial Memo (Revised)",
    author_id: "analyst_02",
    commit_message: "Inserted guidance line and updated margin",
    expected_version: 1,
    blocks: [
      {
        block_id: "b1",
        type: "markdown",
        heading: "Executive Summary",
        content: "Line 0: Board Prefatory Note.\nLine 1: Revenue reached $12.4M.\nLine 2: Operating margin expanded to 24.5%.\nLine 3: Headcount remained flat.",
        citations: []
      }
    ]
  });

  assert.equal(rev2.version, 2);
  assert.notEqual(rev1.content_sha256, rev2.content_sha256);

  // Concurrent edit with stale expected_version: 1 must throw CanvasVersionConflictError
  assert.throws(
    () =>
      canvas.commitRevision({
        artifact_id: "art_q4_memo",
        kind: "document",
        title: "Stale Concurrent Edit",
        author_id: "analyst_03",
        commit_message: "Should fail with conflict",
        expected_version: 1,
        blocks: []
      }),
    (err: unknown) =>
      err instanceof CanvasVersionConflictError &&
      err.expected_version === 1 &&
      err.actual_version === 2
  );

  // Verify true LCS line diff: inserting Line 0 at the top preserves Line 1 and Line 3 as unchanged
  const diff = canvas.computeRevisionDiff("art_q4_memo", 1, 2);
  assert.equal(diff.total_additions, 2); // Line 0 added + Line 2 replaced
  assert.equal(diff.total_deletions, 1); // Old Line 2 removed
  const unchangedLines = diff.block_diffs[0]!.line_changes.filter(
    (c) => c.type === "unchanged"
  );
  assert.equal(unchangedLines.length, 2);

  // Verify real binary XLSX export (PK\x03\x04 ZIP header + OpenXML parts + evaluated formulas)
  const xlsxExport = canvas.exportFinancialSheetModel({
    sheet_name: "Q4_P_and_L",
    columns: ["Quarter", "Revenue", "Cost"],
    rows: [
      { Quarter: "Q1", Revenue: 1200, Cost: 800 },
      { Quarter: "Q2", Revenue: 1500, Cost: 900 },
      { Quarter: "Q3", Revenue: 1800, Cost: 1000 }
    ],
    formulas: [
      { cell: "B5", expression: "=SUM(B2:B4)" },
      { cell: "C5", expression: "=AVERAGE(C2:C4)" }
    ]
  });
  assert.equal(xlsxExport.formulas[0]?.evaluated_value, 4500);
  assert.equal(xlsxExport.formulas[1]?.evaluated_value, 900);
  assert.equal(xlsxExport.xlsx_buffer.subarray(0, 4).toString("binary"), "PK\x03\x04");
  const xlsxBuf = xlsxExport.xlsx_buffer;
  const xlsxAscii = xlsxBuf.toString("utf8");
  assert.ok(xlsxAscii.includes("[Content_Types].xml"));
  assert.ok(xlsxAscii.includes("xl/workbook.xml"));
  assert.ok(xlsxAscii.includes("xl/worksheets/sheet1.xml"));

  // Parse ZIP entries and inflate xl/worksheets/sheet1.xml to verify real OpenXML content
  let offset = 0;
  let sheet1Xml = "";
  while (offset + 30 <= xlsxBuf.length && xlsxBuf.readUInt32LE(offset) === 0x04034b50) {
    const compSize = xlsxBuf.readUInt32LE(offset + 18);
    const nameLen = xlsxBuf.readUInt16LE(offset + 26);
    const extraLen = xlsxBuf.readUInt16LE(offset + 28);
    const entryName = xlsxBuf.subarray(offset + 30, offset + 30 + nameLen).toString("utf8");
    const dataStart = offset + 30 + nameLen + extraLen;
    const compData = xlsxBuf.subarray(dataStart, dataStart + compSize);
    if (entryName === "xl/worksheets/sheet1.xml") {
      sheet1Xml = inflateRawSync(compData).toString("utf8");
      break;
    }
    offset = dataStart + compSize;
  }
  assert.ok(sheet1Xml.includes("<f>SUM(B2:B4)</f><v>4500</v>"));
  assert.ok(sheet1Xml.includes("<f>AVERAGE(C2:C4)</f><v>900</v>"));

  // Verify real binary PDF export (%PDF-1.4 header, xref table, %%EOF trailer)
  const pdfBuffer = canvas.exportCorporatePdfBuffer("art_q4_memo", 2);
  assert.ok(pdfBuffer.subarray(0, 8).toString("ascii").startsWith("%PDF-1.4"));
  const pdfText = pdfBuffer.toString("latin1");
  assert.ok(pdfText.includes("/Type /Catalog"));
  assert.ok(pdfText.includes("xref"));
  assert.ok(pdfText.trimEnd().endsWith("%%EOF"));
});

test("Scenario 3: Knowledge Graph, Hybrid Search, Project Isolation, and Source Update Staleness Propagation", () => {
  const graph = new KosmoraIntelligenceGraph();

  // Default mode without embedding adapter must explicitly report keyword_bm25_fallback
  assert.equal(graph.getRetrievalMode(), "keyword_bm25_fallback");

  // Populate Project Alpha (source document + dependent claim) and Project Beta
  graph.upsertNode({
    node_id: "doc_policy_v1",
    project_id: "proj_alpha",
    workspace_id: "ws_alpha",
    owner_id: "user_1",
    type: "artifact",
    title: "Capital Allocation Policy",
    content: "Maximum autonomous cloud spend is capped at $25,000 per month.",
    confidence: 0.99,
    valid_from: "2026-01-01T00:00:00.000Z",
    citations: [],
    tags: ["finance", "policy"]
  });

  graph.upsertNode({
    node_id: "claim_cloud_cap",
    project_id: "proj_alpha",
    workspace_id: "ws_alpha",
    owner_id: "user_1",
    type: "claim",
    title: "Monthly Cloud Spend Cap Claim",
    content: "Autonomous agents may spend up to $25,000 monthly on cloud compute.",
    confidence: 0.95,
    valid_from: "2026-01-02T00:00:00.000Z",
    citations: [],
    tags: ["finance", "claim"]
  });

  graph.addEdge({
    edge_id: "edge_claim_derived_from_policy",
    project_id: "proj_alpha",
    from_node_id: "claim_cloud_cap",
    to_node_id: "doc_policy_v1",
    relation: "derived_from",
    weight: 1.0,
    created_at: "2026-01-02T00:00:00.000Z"
  });

  graph.upsertNode({
    node_id: "doc_beta_secret",
    project_id: "proj_beta",
    workspace_id: "ws_beta",
    owner_id: "user_2",
    type: "entity",
    title: "Project Beta Confidential Acquisition Target",
    content: "Cloud spend and acquisition budget for Project Beta is $9,000,000.",
    confidence: 0.99,
    valid_from: "2026-01-01T00:00:00.000Z",
    citations: [],
    tags: ["finance", "cloud"]
  });

  // 3a. Strict project isolation: searching proj_alpha NEVER leaks proj_beta nodes (Fixes Blocker 3)
  const alphaResults = graph.searchProjectMemory("proj_alpha", "cloud spend", 10);
  assert.equal(alphaResults.length, 2);
  assert.ok(alphaResults.every((r) => r.project_id === "proj_alpha"));
  assert.ok(alphaResults.every((r) => r.retrieval_mode === "keyword_bm25_fallback"));
  assert.ok(alphaResults.every((r) => r.stale_decay_alert === false));

  // Cross-project edge creation must be rejected
  assert.throws(
    () =>
      graph.addEdge({
        edge_id: "edge_cross_leak",
        project_id: "proj_alpha",
        from_node_id: "claim_cloud_cap",
        to_node_id: "doc_beta_secret",
        relation: "cites",
        weight: 0.5,
        created_at: new Date().toISOString()
      }),
    /Project isolation violation/i
  );

  // 3b. Updating source document increments its version, clears search cache, and marks dependent claims stale
  const updateOutcome = graph.updateSourceDocument(
    "proj_alpha",
    "doc_policy_v1",
    "Updated Policy: Maximum autonomous cloud spend is reduced to $15,000 per month.",
    "user_cfo"
  );
  assert.equal(updateOutcome.updated_node.version, 2);
  assert.deepEqual(updateOutcome.invalidated_dependents, ["claim_cloud_cap"]);

  const postUpdateHits = graph.searchProjectMemory("proj_alpha", "cloud spend", 10);
  const updatedClaimHit = postUpdateHits.find((h) => h.node_id === "claim_cloud_cap")!;
  const updatedDocHit = postUpdateHits.find((h) => h.node_id === "doc_policy_v1")!;
  assert.equal(updatedClaimHit.stale_decay_alert, true);
  assert.ok(updatedClaimHit.stale_reason?.includes("doc_policy_v1"));
  assert.equal(updatedDocHit.stale_decay_alert, false);
  assert.equal(updatedDocHit.version, 2);
});

test("Scenario 4: Protected Tool Invocation, GitHub HTTP Adapter, Subprocess Sandbox, and Atomic Billing Validation", async () => {
  const skills = new KosmoraSkillsBus();

  // 4a. Unconfigured GitHub adapter must throw UNCONFIGURED_ADAPTER instead of fabricating a random PR number
  await assert.rejects(
    () =>
      skills.createGitHubPullRequest({
        repository: "RLM-Company/Nexus-OS",
        base_branch: "main",
        head_branch: "feat/kosmora-160-master-architecture",
        title: "Test PR",
        body: "Body"
      }),
    (err: unknown) =>
      err instanceof ExternalConnectorError && err.code === "UNCONFIGURED_ADAPTER"
  );

  // 4b. Configure GitHub HTTP adapter with controlled transport testing 403, 429, malformed JSON, and 201 Created
  let simulatedMode: "forbidden" | "rate_limit" | "malformed" | "ok" = "forbidden";
  skills.configureGitHubAdapter({
    token: "ghp_test_controlled_token",
    fetchImpl: async (url) => {
      if (simulatedMode === "forbidden") {
        return {
          ok: false,
          status: 403,
          text: async () => "Resource not accessible by integration",
          json: async () => ({})
        };
      }
      if (simulatedMode === "rate_limit") {
        return {
          ok: false,
          status: 429,
          text: async () => "API rate limit exceeded",
          json: async () => ({})
        };
      }
      if (simulatedMode === "malformed") {
        return {
          ok: true,
          status: 201,
          text: async () => "{}",
          json: async () => ({ unexpected: true })
        };
      }
      return {
        ok: true,
        status: 201,
        text: async () => "",
        json: async () => ({
          number: 381,
          node_id: "PR_kwDO_remediated_381",
          url: url,
          html_url: "https://github.com/RLM-Company/Nexus-OS/pull/381",
          state: "open",
          merged: false
        })
      };
    }
  });

  await assert.rejects(
    () =>
      skills.createGitHubPullRequest({
        repository: "RLM-Company/Nexus-OS",
        base_branch: "main",
        head_branch: "feat/test",
        title: "PR",
        body: "Body"
      }),
    (err: unknown) =>
      err instanceof ExternalConnectorError && err.code === "AUTH_FORBIDDEN"
  );

  simulatedMode = "rate_limit";
  await assert.rejects(
    () =>
      skills.createGitHubPullRequest({
        repository: "RLM-Company/Nexus-OS",
        base_branch: "main",
        head_branch: "feat/test",
        title: "PR",
        body: "Body"
      }),
    (err: unknown) =>
      err instanceof ExternalConnectorError && err.code === "RATE_LIMITED"
  );

  simulatedMode = "malformed";
  await assert.rejects(
    () =>
      skills.createGitHubPullRequest({
        repository: "RLM-Company/Nexus-OS",
        base_branch: "main",
        head_branch: "feat/test",
        title: "PR",
        body: "Body"
      }),
    (err: unknown) =>
      err instanceof ExternalConnectorError && err.code === "AMBIGUOUS_RESPONSE"
  );

  simulatedMode = "ok";
  const createdPr = await skills.createGitHubPullRequest({
    repository: "RLM-Company/Nexus-OS",
    base_branch: "main",
    head_branch: "feat/kosmora-160-master-architecture",
    title: "Remediate Kosmora 160 functional implementation",
    body: "Full functional implementation with verified tests",
    files_changed: [{ path: "packages/core/src/index.ts", additions: 25, deletions: 5 }],
    linked_issue_numbers: [380]
  });
  assert.equal(createdPr.pr_number, 381);
  assert.equal(createdPr.node_id, "PR_kwDO_remediated_381");
  assert.equal(createdPr.provider_verified, true);

  // 4c. Real subprocess sandbox execution (Python 3 & Node) + timeout enforcement
  const store = new KosmoraRuntimeStore(":memory:");
  const worker = new KosmoraDagWorker(new KosmoraAutonomyEngine(), store);
  const pyRun = worker.executeInSandbox({
    language: "python3",
    code: "import json\nprint(json.dumps({'sum': sum([10, 20, 30])}))"
  });
  assert.equal(pyRun.exit_code, 0);
  assert.equal(pyRun.timed_out, false);
  assert.equal(JSON.parse(pyRun.stdout.trim()).sum, 60);

  const timeoutRun = worker.executeInSandbox({
    language: "node",
    code: "setTimeout(() => {}, 10000);",
    timeout_ms: 250
  });
  assert.equal(timeoutRun.timed_out, true);

  store.close(true);
});

test("Scenario 5: Enterprise Security, AES-256-GCM Vault, Hash-Chained Audit Tamper Detection, Atomic Billing, 3-State Webhooks, and SQLite Reopen/Snapshots", async () => {
  const security = new KosmoraEnterpriseSecurityEngine();

  // 5a. Signed session token authentication + RBAC + RLS
  const session = security.issueSignedSessionToken({
    user_id: "alice_sec_admin",
    tenant_id: "tenant_alpha",
    workspace_ids: ["ws_alpha_1"],
    role: "admin",
    mfa_verified: true
  });
  const validAuth = security.authenticateAndAuthorize(
    session.token,
    "tenant_alpha",
    "ws_alpha_1",
    "vault:manage_secrets"
  );
  assert.equal(validAuth.allowed, true);

  // Cross-tenant access must be denied
  const crossTenantAuth = security.authenticateAndAuthorize(
    session.token,
    "tenant_beta",
    "ws_alpha_1",
    "workspace:read"
  );
  assert.equal(crossTenantAuth.allowed, false);

  // Tampered session token must be rejected
  const tamperedToken = `${session.token.slice(0, -4)}ffff`;
  const forgedAuth = security.authenticateAndAuthorize(
    tamperedToken,
    "tenant_alpha",
    "ws_alpha_1",
    "workspace:read"
  );
  assert.equal(forgedAuth.allowed, false);

  // 5b. AES-256-GCM Vault encryption, key rotation, and tamper detection
  const secretRec = security.storeEncryptedSecret(
    "tenant_alpha",
    "OPENAI_ENTERPRISE_KEY",
    "sk-live-sovereign-secret-value-999",
    "alice_sec_admin"
  );
  assert.ok(!secretRec.ciphertext_hex.includes("sk-live"));
  assert.equal(
    security.decryptSecret(secretRec.secret_id, "tenant_alpha"),
    "sk-live-sovereign-secret-value-999"
  );
  assert.throws(
    () => security.decryptSecret(secretRec.secret_id, "tenant_beta"),
    /Cross-tenant secret decryption blocked/i
  );

  // Rotate Vault master key and confirm secret is re-encrypted to v2 and still decrypts cleanly
  const rotation = security.rotateVaultMasterKey();
  assert.equal(rotation.new_key_version, 2);
  assert.equal(rotation.reencrypted_secrets_count, 1);
  assert.equal(
    security.decryptSecret(secretRec.secret_id, "tenant_alpha"),
    "sk-live-sovereign-secret-value-999"
  );

  // 5c. Hash-chained audit trail integrity & field mutation detection (Fixes Blocker 4)
  const integrityBefore = security.verifyAuditTrailIntegrity();
  assert.equal(integrityBefore.valid, true);
  assert.ok(integrityBefore.entries_verified >= 3);

  // Audit entries must be frozen so direct property mutation throws in strict mode
  const chainRef = security.getAuditChain();
  assert.equal(Object.isFrozen(chainRef[0]), true);
  assert.throws(() => {
    (chainRef[0] as unknown as { action: string }).action = "tampered_action";
  });

  // 5d. Atomic FinOps token metering validation (Fixes Blocker 5)
  security.configureTenantBilling({
    tenant_id: "tenant_alpha",
    plan_tier: "enterprise",
    included_monthly_tokens: 1_000,
    consumed_tokens: 500,
    overage_rate_per_1k_usd: 0.1,
    accrued_spend_usd: 0.0,
    hard_limit_usd: 0.05,
    hard_stop_enforced: true
  });

  assert.throws(
    () => security.meterTenantTokenUsage("tenant_alpha", -50),
    /positive finite integer/i
  );
  assert.throws(
    () => security.meterTenantTokenUsage("tenant_alpha", 0),
    /positive finite integer/i
  );
  assert.throws(
    () => security.meterTenantTokenUsage("tenant_alpha", Number.NaN),
    /positive finite integer/i
  );

  // Over-limit usage must be rejected atomically without mutating consumed_tokens
  const overLimit = security.meterTenantTokenUsage("tenant_alpha", 2_000);
  assert.equal(overLimit.allowed, false);
  assert.equal(overLimit.ledger.consumed_tokens, 500);

  // 5e. 3-State Signed Webhook Lifecycle (Fixes Blocker 8)
  const webhookCreated = security.dispatchSignedWebhook(
    "artifact.committed",
    "https://hooks.enterprise.internal/kosmora",
    { artifact_id: "art_1", version: 2 },
    "whsec_test_secret_key"
  );
  assert.equal(webhookCreated.status, "created");
  assert.equal(webhookCreated.delivered, false);

  const webhookDelivered = await security.deliverSignedWebhook(
    webhookCreated,
    async () => ({
      ok: true,
      status: 202,
      text: async () => "Accepted"
    })
  );
  assert.equal(webhookDelivered.status, "delivered_confirmed");
  assert.equal(webhookDelivered.delivered, true);
  assert.equal(webhookDelivered.http_status, 202);

  // 5f. Persistent SQLite store survives close & reopen + project-isolated snapshots (Fixes Blocker 6)
  const dbFile = resolve(tmpdir(), `kosmora_persist_test_${Date.now()}.db`);
  try {
    const store1 = new KosmoraRuntimeStore(dbFile);
    store1.saveArtifactRevision({
      revision_id: "rev_a_1",
      artifact_id: "art_alpha",
      project_id: "proj_alpha",
      tenant_id: "tenant_alpha",
      version: 1,
      title: "Alpha v1",
      kind: "document",
      content_json: JSON.stringify([{ block_id: "b1", content: "Alpha baseline" }]),
      content_sha256: "hash_a1",
      author_id: "alice",
      created_at: new Date().toISOString()
    });
    store1.saveArtifactRevision({
      revision_id: "rev_b_1",
      artifact_id: "art_beta",
      project_id: "proj_beta",
      tenant_id: "tenant_beta",
      version: 1,
      title: "Beta v1",
      kind: "document",
      content_json: JSON.stringify([{ block_id: "b1", content: "Beta untouched" }]),
      content_sha256: "hash_b1",
      author_id: "bob",
      created_at: new Date().toISOString()
    });

    // Apply custom DDL migration v3 and verify column exists
    store1.applyMigration(
      3,
      "003_add_audit_tag_column",
      "ALTER TABLE kosmora_dag_plans ADD COLUMN compliance_tag TEXT DEFAULT 'SOC2';",
      "SELECT 1;"
    );

    const alphaSnap = store1.createProjectSnapshot("proj_alpha", "tenant_alpha");
    assert.equal(alphaSnap.artifact_revisions_count, 1);

    // Close and reopen SQLite database from disk
    store1.close();
    const store2 = new KosmoraRuntimeStore(dbFile);
    assert.equal(store2.listAppliedMigrations().length, 3);
    assert.ok(
      store2
        .inspectTableColumns("kosmora_dag_plans")
        .some((col) => col.name === "compliance_tag")
    );

    // Add a second revision to proj_alpha, then restore alphaSnap and confirm proj_beta is untouched
    store2.saveArtifactRevision({
      revision_id: "rev_a_2",
      artifact_id: "art_alpha",
      project_id: "proj_alpha",
      tenant_id: "tenant_alpha",
      version: 2,
      title: "Alpha v2 temporary",
      kind: "document",
      content_json: "[]",
      content_sha256: "hash_a2",
      author_id: "alice",
      created_at: new Date().toISOString()
    });
    assert.equal(store2.listArtifactRevisions("art_alpha", "proj_alpha").length, 2);

    const restored = store2.restoreProjectSnapshot(alphaSnap.snapshot_id);
    assert.equal(restored.project_id, "proj_alpha");
    assert.equal(restored.restored_artifacts, 1);
    assert.equal(store2.listArtifactRevisions("art_alpha", "proj_alpha").length, 1);
    assert.equal(store2.listArtifactRevisions("art_beta", "proj_beta").length, 1);

    // Verify project-isolated storage quota metering
    const alphaQuota = store2.evaluateProjectStorageQuota("proj_alpha", 10_000);
    const betaQuota = store2.evaluateProjectStorageQuota("proj_beta", 10_000);
    assert.ok(alphaQuota.used_bytes > 0);
    assert.ok(betaQuota.used_bytes > 0);

    store2.close();
  } finally {
    rmSync(dbFile, { force: true });
  }
});

test("Verification of All 160 Feature Modules (F001-F160), API Controller, and Monochrome Web ViewModel", () => {
  const core96 = verifyCoreStages96Modules();
  const stage3 = verifyStage_stage3_skills_bus();
  const stage5 = verifyStage_stage5_enterprise();
  const all160 = [...core96, ...stage3, ...stage5];

  assert.equal(KOSMORA_160_CATALOG.length, 160);
  assert.equal(all160.length, 160);
  for (const item of all160) {
    assert.equal(
      item.passed,
      true,
      `Feature module ${item.featureId} failed verification`
    );
  }

  // Verify API Controller end-to-end flow
  const cp = createKosmoraControlPlane(":memory:");
  const api = new KosmoraApiController(cp);
  const principal = {
    user_id: "op_1",
    tenant_id: "tenant_1",
    workspace_ids: ["ws_1"],
    role: "operator" as const,
    mfa_verified: true
  };

  const dagResp = api.handleDagCompileAndStep({
    principal,
    workspace_id: "ws_1",
    project_id: "proj_1",
    goal: "API DAG test",
    max_parallelism: 2,
    budget_limit_usd: 10,
    tasks: [
      {
        node_id: "n1",
        title: "Initial task",
        agent_role: "planner",
        dependencies: [],
        estimated_tokens: 100,
        estimated_cost_usd: 0.01
      }
    ]
  });
  assert.deepEqual(dagResp.ready_batch, ["n1"]);

  const canvasResp = api.handleCanvasCommitAndExport({
    principal,
    workspace_id: "ws_1",
    project_id: "proj_1",
    artifact_id: "art_api_1",
    kind: "sheet",
    title: "API Sheet",
    commit_message: "v1",
    export_format: "xlsx",
    blocks: [
      {
        block_id: "b1",
        type: "table",
        heading: "Metrics",
        content: "| A | B |\n| 1 | 2 |",
        citations: []
      }
    ]
  });
  assert.equal(canvasResp.revision.version, 1);
  assert.ok(canvasResp.binary_export);
  assert.equal(
    canvasResp.binary_export.buffer.subarray(0, 4).toString("binary"),
    "PK\x03\x04"
  );
  cp.store.close(true);

  // Verify Web Workspace ViewModel monochrome theme & Russian labels
  const vm = buildKosmoraWorkspaceViewModel();
  assert.equal(vm.theme.background_primary, KOSMORA_MONOCHROME_THEME.background_primary);
  assert.ok(vm.title.includes("Kosmora"));
});

test("Scenario 7: Live HTTP Control Plane Server (node:http + fetch), Bearer Auth (401/403/200), HTTP 409 Conflict, Binary XLSX Streaming, Worker DLQ Recovery, and Per-Feature Domain Invariants", async () => {
  const cp = createKosmoraControlPlane(":memory:");
  const server = createKosmoraHttpServer(cp);

  await new Promise<void>((resolveListen) => {
    server.listen(0, "127.0.0.1", () => resolveListen());
  });
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 7a. Health check endpoint
    const healthRes = await fetch(`${baseUrl}/api/v1/kosmora/health`);
    assert.equal(healthRes.status, 200);
    const healthJson = (await healthRes.json()) as { status: string; features_count: number };
    assert.equal(healthJson.status, "ok");
    assert.equal(healthJson.features_count, 160);

    // 7b. Unauthenticated request must return 401
    const unauthRes = await fetch(`${baseUrl}/api/v1/kosmora/dag/compile-and-step`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspace_id: "ws_1", project_id: "proj_1" })
    });
    assert.equal(unauthRes.status, 401);

    // Issue signed session token for tenant_http_1
    const session = cp.security.issueSignedSessionToken({
      user_id: "http_operator",
      tenant_id: "tenant_http_1",
      workspace_ids: ["ws_http_1"],
      role: "operator",
      mfa_verified: true
    });

    // 7c. Cross-tenant request must return 403
    const crossTenantRes = await fetch(`${baseUrl}/api/v1/kosmora/dag/compile-and-step`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${session.token}`
      },
      body: JSON.stringify({
        tenant_id: "tenant_other",
        workspace_id: "ws_http_1",
        project_id: "proj_1"
      })
    });
    assert.equal(crossTenantRes.status, 403);

    // 7d. Canvas commit v1 + binary XLSX stream over HTTP
    const xlsxStreamRes = await fetch(`${baseUrl}/api/v1/kosmora/canvas/commit-and-export`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${session.token}`
      },
      body: JSON.stringify({
        workspace_id: "ws_http_1",
        project_id: "proj_http_1",
        artifact_id: "art_http_1",
        kind: "sheet",
        title: "HTTP Sheet",
        commit_message: "v1 via HTTP",
        export_format: "xlsx",
        stream_binary: true,
        blocks: [
          {
            block_id: "b1",
            type: "table",
            heading: "Revenue",
            content: "| Q1 | Q2 |\n| 100 | 200 |",
            citations: []
          }
        ]
      })
    });
    assert.equal(xlsxStreamRes.status, 200);
    assert.ok(
      xlsxStreamRes.headers
        .get("content-type")
        ?.includes("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    );
    const xlsxBytes = Buffer.from(await xlsxStreamRes.arrayBuffer());
    assert.equal(xlsxBytes.subarray(0, 4).toString("binary"), "PK\x03\x04");

    // 7e. Concurrent Canvas commit with stale expected_version=99 must return HTTP 409 Conflict
    const conflictRes = await fetch(`${baseUrl}/api/v1/kosmora/canvas/commit-and-export`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${session.token}`
      },
      body: JSON.stringify({
        workspace_id: "ws_http_1",
        project_id: "proj_http_1",
        artifact_id: "art_http_1",
        kind: "sheet",
        title: "HTTP Sheet Stale Edit",
        commit_message: "stale",
        expected_version: 99,
        blocks: []
      })
    });
    assert.equal(conflictRes.status, 409);
    const conflictJson = (await conflictRes.json()) as { error: string; actual_version: number };
    assert.equal(conflictJson.error, "CANVAS_VERSION_CONFLICT");
    assert.equal(conflictJson.actual_version, 1);

    // 7f. Unified Feature Execution over HTTP (/api/v1/kosmora/features/execute)
    const featRes = await fetch(`${baseUrl}/api/v1/kosmora/features/execute`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${session.token}`
      },
      body: JSON.stringify({
        feature_id: "F002",
        request_id: "req_http_f002",
        project_id: "proj_http_1",
        workspace_id: "ws_http_1"
      })
    });
    assert.equal(featRes.status, 200);
    const featJson = (await featRes.json()) as {
      domainOutcome: { operationCode: string; stateChanged: boolean };
      resolvedFields: Record<string, unknown>;
    };
    assert.equal(featJson.domainOutcome.operationCode, "dag_scheduler");
    assert.equal(featJson.domainOutcome.stateChanged, true);
    assert.ok(String(featJson.resolvedFields.acyclic_verified ?? featJson.resolvedFields.topological_order).length > 0);

    // 7g. Worker Dead-Letter Queue (DLQ) capture & replay recovery (F147)
    const worker = new KosmoraDagWorker(cp.autonomy, cp.store);
    const dlqPlan = cp.autonomy.compilePlan({
      plan_id: "plan_dlq_test",
      tenant_id: "tenant_http_1",
      workspace_id: "ws_http_1",
      project_id: "proj_http_1",
      goal: "Test DLQ capture and recovery",
      max_parallelism: 2,
      budget_limit_usd: 10,
      tasks: [
        {
          node_id: "n_fail",
          title: "Transient failing node",
          agent_role: "coder",
          dependencies: [],
          estimated_tokens: 100,
          estimated_cost_usd: 0.01
        },
        {
          node_id: "n_dep",
          title: "Downstream dependent node",
          agent_role: "verifier",
          dependencies: ["n_fail"],
          estimated_tokens: 100,
          estimated_cost_usd: 0.01
        }
      ]
    });
    const failedSummary = worker.runAutonomyPlanJob(dlqPlan, {
      fail_node_ids: new Set(["n_fail"])
    });
    assert.equal(failedSummary.final_status, "failed_budget_or_error");
    assert.equal(failedSummary.dlq_enqueued_jobs.length, 1);
    assert.deepEqual(failedSummary.blocked_nodes, ["n_dep"]);

    const replayed = worker.replayDlqJob(failedSummary.dlq_enqueued_jobs[0]!, dlqPlan);
    assert.equal(replayed.status, "replayed_recovered");
    const recoveredSummary = worker.runAutonomyPlanJob(dlqPlan);
    assert.equal(recoveredSummary.final_status, "completed");
  } finally {
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    cp.store.close(true);
  }
});

// ============================================================================
// SCENARIO 8: Stage 6 Sovereign Cluster (F161-F192), Raft Fencing, CRDT Merge,
//             Unified Diff Rollback, Ed25519 Attestation & Full HTTP/SSE Suite
// ============================================================================
test("Scenario 8: Stage 6 Sovereign Cluster (F161-F192), Raft Fencing, CRDT, Unified Diff, Ed25519 & Full HTTP/SSE Endpoints", async () => {
  const cluster = new KosmoraSovereignClusterEngine();

  // 8a. Raft Quorum Leader Election & Split-Brain Fencing Token Guard (F161-F164)
  // Default cluster already seeds node_eu_1, node_us_1, node_ap_1 (3 peers, quorum=2)
  const election1 = cluster.electClusterLeader("node_eu_1", 1);
  assert.equal(election1.leader_id, "node_eu_1");
  assert.equal(election1.quorum_size, 2);
  assert.ok(election1.fencing_token > 100);

  const wal1 = cluster.replicateStateLogEntry({
    fencing_token: election1.fencing_token,
    command_type: "artifact.commit",
    payload: JSON.stringify({ artifact_id: "art-cluster-1", version: 1 })
  });
  assert.equal(wal1.log_index, 1);
  assert.equal(wal1.ack_nodes.length, 3);
  assert.equal(wal1.committed_by_quorum, true);

  // Elect a new leader in term 2 (higher fencing token) and verify old leader with stale token is fenced off
  const election2 = cluster.electClusterLeader("node_us_1", 2);
  assert.ok(election2.fencing_token > election1.fencing_token);
  assert.throws(
    () =>
      cluster.replicateStateLogEntry({
        fencing_token: election1.fencing_token,
        command_type: "artifact.commit",
        payload: JSON.stringify({ stale: true })
      }),
    /Split-brain fencing rejection/
  );

  // Mark majority of peers unhealthy and verify quorum loss blocks election & replication
  cluster.setPeerHealth("node_us_1", false);
  cluster.setPeerHealth("node_ap_1", false);
  assert.throws(() => cluster.electClusterLeader("node_eu_1", 3), /Leader election failed/);
  cluster.setPeerHealth("node_us_1", true);
  cluster.setPeerHealth("node_ap_1", true);

  // 8b. Commutative & Idempotent CRDT LWW-Element-Set Canvas Co-Editing (F165-F168)
  cluster.applyCrdtBlockOperation({
    artifact_id: "doc_crdt_1",
    replica_id: "rep_A",
    block_id: "b1",
    content: "Draft A",
    actor_id: "alice",
    lamport_clock: 1
  });
  const stateA = cluster.applyCrdtBlockOperation({
    artifact_id: "doc_crdt_1",
    replica_id: "rep_A",
    block_id: "b2",
    content: "To be deleted",
    actor_id: "alice",
    lamport_clock: 2
  });

  cluster.applyCrdtBlockOperation({
    artifact_id: "doc_crdt_1",
    replica_id: "rep_B",
    block_id: "b1",
    content: "Draft B Wins LWW",
    actor_id: "bob",
    lamport_clock: 3
  });
  const stateB = cluster.applyCrdtBlockOperation({
    artifact_id: "doc_crdt_1",
    replica_id: "rep_B",
    block_id: "b2",
    content: "",
    actor_id: "bob",
    lamport_clock: 4,
    tombstone: true
  });

  const mergeAB = cluster.mergeCrdtReplicaStates(stateA, stateB);
  const mergeBA = cluster.mergeCrdtReplicaStates(stateB, stateA);
  assert.equal(mergeAB.elements.b1?.content, "Draft B Wins LWW");
  assert.equal(mergeAB.elements.b2?.tombstone, true);
  assert.deepEqual(mergeAB.elements, mergeBA.elements);

  // 8c. Prompt Token Budget Optimizer preserving citations (F169-F174)
  const budgetOpt = cluster.optimizePromptTokenBudget({
    raw_prompt:
      "Please note that in order to verify [Security Audit](https://rlm.internal/doc-42) it is important to remember that all verbose history logs ".repeat(4),
    target_max_tokens: 35,
    preserve_citations: true
  });
  assert.ok(budgetOpt.saved_tokens > 0);
  assert.ok(budgetOpt.compressed_prompt.includes("[Security Audit](https://rlm.internal/doc-42)"));
  assert.ok(budgetOpt.preserved_citations_count >= 1);

  // 8d. Line-Accurate Unified Diff Patch Applier & Inverse Rollback (F175-F180)
  const originalSource = "line1\nline2\nline3\nline4";
  const unifiedPatch = "@@ -1,4 +1,4 @@\n line1\n-line2\n+line2_modified\n line3\n line4";
  const patched = cluster.applyUnifiedDiffPatch(originalSource, unifiedPatch);
  assert.equal(patched.patched_text, "line1\nline2_modified\nline3\nline4");
  const rolledBack = cluster.applyUnifiedDiffPatch(patched.patched_text, patched.inverse_rollback_patch);
  assert.equal(rolledBack.patched_text, originalSource);
  assert.throws(
    () => cluster.applyUnifiedDiffPatch("wrong_context\nline2\nline3\nline4", unifiedPatch),
    /Unified diff context mismatch/
  );

  // 8e. Asymmetric Ed25519 SLSA Provenance Attestation & Tamper Rejection (F181-F186)
  const artifactBytes = Buffer.from("official-compiled-bundle-v1", "utf8");
  const envelope = cluster.signArtifactAttestationEnvelope({
    artifact_id: "art-bundle-1",
    artifact_bytes: artifactBytes,
    builder_id: "builder-node-1",
    source_plan_id: "dag_run_99"
  });
  const validCheck = cluster.verifyArtifactAttestationEnvelope(envelope, artifactBytes);
  assert.equal(validCheck.valid, true);
  const tamperedCheck = cluster.verifyArtifactAttestationEnvelope(
    envelope,
    Buffer.from("official-compiled-bundle-v1-TAMPERED", "utf8")
  );
  assert.equal(tamperedCheck.valid, false);
  assert.match(tamperedCheck.reason, /Artifact digest mismatch/);

  // 8f. Self-Evolving Episodic Skill Distillation & Canary Gate (F187-F192)
  const distilled = cluster.distillEpisodicTrajectoryIntoSkill({
    skill_id: "skill_auto_audit",
    source_plan_id: "plan_99",
    executed_steps: ["sec.scan", "sec.verify_attestation"],
    baseline_accuracy: 0.9,
    candidate_accuracy: 0.97
  });
  assert.equal(distilled.canary_promoted, true);
  assert.equal(distilled.extracted_steps.length, 2);

  // 8g. Verify all 32 Stage 6 Feature Adapters (F161-F192) & Extended 192-Module Catalog
  assert.equal(KOSMORA_160_CATALOG.length, 160);
  assert.equal(KOSMORA_192_EXTENDED_CATALOG.length, 192);
  const stage6Results = verifyStage6SovereignModules();
  assert.equal(stage6Results.length, 32);
  for (const res of stage6Results) {
    assert.equal(res.passed, true, `Stage 6 feature ${res.featureId} failed verification`);
  }

  // 8h. Verify New Live HTTP & SSE Endpoints (/attestation/sign, /attestation/verify, /snapshots/create, /snapshots/restore, /audit/verify, /events/stream, /features/execute F182)
  const cp = createKosmoraControlPlane(":memory:");
  const server = createKosmoraHttpServer(cp);
  await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", () => resolveListen()));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const session = cp.security.issueSignedSessionToken({
      user_id: "usr_stage6_admin",
      tenant_id: "tenant_stage6",
      workspace_ids: ["ws_stage6"],
      role: "owner"
    });
    const headers = {
      "content-type": "application/json",
      authorization: `Bearer ${session.token}`
    };

    // Execute Stage 6 feature F182 over HTTP
    const f182Res = await fetch(`${baseUrl}/api/v1/kosmora/features/execute`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        feature_id: "F182",
        request_id: "req_http_f182",
        project_id: "proj_stage6",
        workspace_id: "ws_stage6"
      })
    });
    assert.equal(f182Res.status, 200);
    const f182Json = (await f182Res.json()) as {
      domainOutcome: { operationCode: string; stateChanged: boolean };
      resolvedFields: Record<string, unknown>;
    };
    assert.equal(f182Json.domainOutcome.operationCode, "slsa_provenance_attestation_signer");
    assert.equal(f182Json.domainOutcome.stateChanged, true);

    // Sign & Verify Attestation over HTTP
    const signRes = await fetch(`${baseUrl}/api/v1/kosmora/attestation/sign`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        workspace_id: "ws_stage6",
        project_id: "proj_stage6",
        artifact_id: "art_http_signed",
        artifact_content: "Signed over HTTP Control Plane"
      })
    });
    assert.equal(signRes.status, 200);
    const signedEnvelope = await signRes.json();

    const verifyRes = await fetch(`${baseUrl}/api/v1/kosmora/attestation/verify`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        workspace_id: "ws_stage6",
        envelope: signedEnvelope,
        artifact_content: "Signed over HTTP Control Plane"
      })
    });
    assert.equal(verifyRes.status, 200);
    const verifyJson = (await verifyRes.json()) as { valid: boolean };
    assert.equal(verifyJson.valid, true);

    // Create & Restore Snapshot over HTTP
    const snapRes = await fetch(`${baseUrl}/api/v1/kosmora/snapshots/create`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        workspace_id: "ws_stage6",
        project_id: "proj_stage6"
      })
    });
    assert.equal(snapRes.status, 200);
    const snapJson = (await snapRes.json()) as { snapshot_id: string };
    assert.ok(snapJson.snapshot_id.startsWith("snap_"));

    const restoreRes = await fetch(`${baseUrl}/api/v1/kosmora/snapshots/restore`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        workspace_id: "ws_stage6",
        snapshot_id: snapJson.snapshot_id
      })
    });
    assert.equal(restoreRes.status, 200);

    // Audit chain verification over HTTP
    const auditRes = await fetch(`${baseUrl}/api/v1/kosmora/audit/verify`, {
      method: "GET",
      headers: { authorization: `Bearer ${session.token}` }
    });
    assert.equal(auditRes.status, 200);
    const auditJson = (await auditRes.json()) as { valid: boolean };
    assert.equal(auditJson.valid, true);

    // SSE real-time stream over HTTP
    const sseRes = await fetch(`${baseUrl}/api/v1/kosmora/events/stream`, {
      method: "GET",
      headers: { authorization: `Bearer ${session.token}` }
    });
    assert.equal(sseRes.status, 200);
    assert.ok(sseRes.headers.get("content-type")?.includes("text/event-stream"));
    const sseText = await sseRes.text();
    assert.ok(sseText.includes("event: cluster.snapshot"));
  } finally {
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    cp.store.close(true);
  }
});


// ============================================================================
// SCENARIO 9: Stage 7 Formal Verification & Deterministic Replay (F193-F224)
// ============================================================================
test("Scenario 9: Stage 7 Formal Verification (F193-F224) — Bounded Model Checker, CSP Resource Solver, W3C Trace Critical Path, Deterministic Cassette Replay & Static Taint Analysis", async () => {
  const formal = new KosmoraFormalVerificationEngine();

  // 9a. Bounded Model Checker: safe FSM passes, unsafe FSM returns shortest counterexample path
  const safeRes = formal.verifyStateMachineInvariants({
    machine_id: "fsm_safe_1",
    initial_state: "INIT",
    states: ["INIT", "VALIDATED", "COMMITTED"],
    transitions: [
      { from: "INIT", to: "VALIDATED", action: "validate" },
      { from: "VALIDATED", to: "COMMITTED", action: "commit" }
    ],
    accepting_states: ["COMMITTED"],
    forbidden_states: []
  });
  assert.equal(safeRes.verified_safe, true);
  assert.equal(safeRes.reachable_states.length, 3);
  assert.equal(safeRes.forbidden_reached.length, 0);

  const unsafeRes = formal.verifyStateMachineInvariants({
    machine_id: "fsm_unsafe_1",
    initial_state: "INIT",
    states: ["INIT", "BYPASS", "UNAPPROVED_EXEC"],
    transitions: [
      { from: "INIT", to: "BYPASS", action: "skip_hitl" },
      { from: "BYPASS", to: "UNAPPROVED_EXEC", action: "force_run" }
    ],
    accepting_states: ["UNAPPROVED_EXEC"],
    forbidden_states: ["UNAPPROVED_EXEC"]
  });
  assert.equal(unsafeRes.verified_safe, false);
  assert.equal(unsafeRes.forbidden_reached.length, 1);
  assert.deepEqual(unsafeRes.forbidden_reached[0]?.counterexample_trace, [
    "INIT",
    "skip_hitl->BYPASS",
    "force_run->UNAPPROVED_EXEC"
  ]);

  // 9b. Backtracking CSP Resource & Anti-Affinity Solver: feasible vs UNSAT
  const cspSat = formal.solveResourceAllocationConstraints(
    [
      { task_id: "t_primary", cpu_cores: 2, memory_gb: 4, cost_usd: 0.1, anti_affinity_task_ids: ["t_replica"] },
      { task_id: "t_replica", cpu_cores: 2, memory_gb: 4, cost_usd: 0.1, anti_affinity_task_ids: ["t_primary"] }
    ],
    [
      { host_id: "w_eu_1", max_cpu_cores: 4, max_memory_gb: 8, cost_multiplier: 1.0 },
      { host_id: "w_eu_2", max_cpu_cores: 4, max_memory_gb: 8, cost_multiplier: 1.1 }
    ]
  );
  assert.equal(cspSat.feasible, true);
  assert.notEqual(cspSat.assignments.t_primary, cspSat.assignments.t_replica);

  const cspUnsat = formal.solveResourceAllocationConstraints(
    [
      { task_id: "t_a", cpu_cores: 2, memory_gb: 4, cost_usd: 0.1, anti_affinity_task_ids: ["t_b"] },
      { task_id: "t_b", cpu_cores: 2, memory_gb: 4, cost_usd: 0.1, anti_affinity_task_ids: ["t_a"] }
    ],
    [
      { host_id: "w_single", max_cpu_cores: 4, max_memory_gb: 8, cost_multiplier: 1.0 }
    ]
  );
  assert.equal(cspUnsat.feasible, false);

  // 9c. W3C Traceparent Parser/Propagator & Critical-Path Bottleneck Analyzer
  const traceCtx = formal.parseAndPropagateW3cTraceContext(
    "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
    "span_seed_1"
  );
  assert.equal(traceCtx.version, "00");
  assert.equal(traceCtx.trace_id, "4bf92f3577b34da6a3ce929d0e0e4736");
  assert.equal(traceCtx.parent_span_id, "00f067aa0ba902b7");
  assert.notEqual(traceCtx.child_span_id, traceCtx.parent_span_id);

  const critPath = formal.analyzeDistributedTraceCriticalPath([
    { trace_id: "tr_1", span_id: "s_root", parent_span_id: null, operation_name: "dag.compile", service_name: "core", start_ms: 0, end_ms: 200, attributes: {} },
    { trace_id: "tr_1", span_id: "s_fast", parent_span_id: "s_root", operation_name: "bm25.lookup", service_name: "graph", start_ms: 15, end_ms: 35, attributes: {} },
    { trace_id: "tr_1", span_id: "s_slow", parent_span_id: "s_root", operation_name: "llm.synthesis", service_name: "model", start_ms: 15, end_ms: 155, attributes: {} }
  ]);
  assert.deepEqual(critPath.critical_path_span_ids, ["s_root", "s_slow"]);
  assert.equal(critPath.total_duration_ms, 200);
  assert.equal(critPath.bottleneck_span_id, "s_slow");

  // 9d. Deterministic Execution Cassette Recording, Bit-Exact Replay & Divergence Detection
  const cassette = formal.recordExecutionCassette({
    cassette_id: "cas_run_42",
    plan_id: "plan_42",
    interactions: [
      { boundary_kind: "tool_io", input_canonical: JSON.stringify({ q: "SELECT 1" }), recorded_output: JSON.stringify({ rows: [1] }) },
      { boundary_kind: "tool_io", input_canonical: JSON.stringify({ k: "API_KEY" }), recorded_output: JSON.stringify({ redacted: true }) }
    ]
  });
  const exactReplay = formal.replayExecutionCassette(cassette.cassette_id, [
    { boundary_kind: "tool_io", input_canonical: JSON.stringify({ q: "SELECT 1" }) },
    { boundary_kind: "tool_io", input_canonical: JSON.stringify({ k: "API_KEY" }) }
  ]);
  assert.equal(exactReplay.deterministic_match, true);
  assert.equal(exactReplay.replayed_outputs.length, 2);

  const divergedReplay = formal.replayExecutionCassette(cassette.cassette_id, [
    { boundary_kind: "tool_io", input_canonical: JSON.stringify({ q: "SELECT 1" }) },
    { boundary_kind: "tool_io", input_canonical: JSON.stringify({ k: "TAMPERED_KEY" }) }
  ]);
  assert.equal(divergedReplay.deterministic_match, false);
  assert.equal(divergedReplay.divergence_step, 1);

  // 9e. Static Dataflow Taint Analysis: blocks unsanitized sink, permits sanitized flow
  const unsafeCode = [
    "const rawCmd = req.body.command;",
    "const cmd = rawCmd;",
    "execSync(cmd);"
  ].join("\n");
  const taintUnsafe = formal.analyzeCodeDataflowTaint(unsafeCode);
  assert.equal(taintUnsafe.safe, false);
  assert.equal(taintUnsafe.findings.length, 1);
  assert.equal(taintUnsafe.findings[0]?.severity, "critical");

  const safeCode = [
    "const rawInput = req.query.id;",
    "const cleanId = escapeSql(rawInput);",
    "rawSqlQuery(cleanId);"
  ].join("\n");
  const taintSafe = formal.analyzeCodeDataflowTaint(safeCode);
  assert.equal(taintSafe.safe, true);

  // 9f. Verify all 32 Stage 7 Feature Adapters (F193-F224)
  assert.equal(KOSMORA_STAGE7_CATALOG.length, 32);
  const stage7Summary = verifyStage7FormalModules();
  assert.equal(stage7Summary.totalModules, 32);
  assert.equal(stage7Summary.verifiedCount, 32);

  // 9g. Verify Stage 7 HTTP Endpoints (/formal/verify-model, /formal/solve-csp, /features/execute F200)
  const cp = createKosmoraControlPlane(":memory:");
  const server = createKosmoraHttpServer(cp);
  await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", () => resolveListen()));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const session = cp.security.issueSignedSessionToken({
      user_id: "usr_formal_verifier",
      tenant_id: "tenant_formal",
      workspace_ids: ["ws_formal"],
      role: "operator"
    });
    const headers = {
      "content-type": "application/json",
      authorization: `Bearer ${session.token}`
    };

    const modelHttpRes = await fetch(`${baseUrl}/api/v1/kosmora/formal/verify-model`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        workspace_id: "ws_formal",
        spec: {
          machine_id: "http_fsm_1",
          initial_state: "READY",
          states: ["READY", "DONE"],
          transitions: [{ from: "READY", to: "DONE", action: "finish" }],
          accepting_states: ["DONE"],
          forbidden_states: []
        }
      })
    });
    assert.equal(modelHttpRes.status, 200);
    const modelHttpJson = (await modelHttpRes.json()) as { verified_safe: boolean };
    assert.equal(modelHttpJson.verified_safe, true);

    const cspHttpRes = await fetch(`${baseUrl}/api/v1/kosmora/formal/solve-csp`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        workspace_id: "ws_formal",
        tasks: [{ task_id: "t1", cpu_cores: 1, memory_gb: 2, cost_usd: 0.05 }],
        hosts: [{ host_id: "w1", max_cpu_cores: 4, max_memory_gb: 8, cost_multiplier: 1.0 }]
      })
    });
    assert.equal(cspHttpRes.status, 200);
    const cspHttpJson = (await cspHttpRes.json()) as { feasible: boolean; assignments: Record<string, string> };
    assert.equal(cspHttpJson.feasible, true);
    assert.equal(cspHttpJson.assignments.t1, "w1");

    const f200Res = await fetch(`${baseUrl}/api/v1/kosmora/features/execute`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        feature_id: "F200",
        request_id: "req_http_f200",
        project_id: "proj_formal",
        workspace_id: "ws_formal"
      })
    });
    assert.equal(f200Res.status, 200);
    const f200Json = (await f200Res.json()) as { domainOutcome: { stateChanged: boolean } };
    assert.equal(f200Json.domainOutcome.stateChanged, true);
  } finally {
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    cp.store.close(true);
  }
});

// ============================================================================
// SCENARIO 10: Stage 8 FinOps, Differential Privacy & Compliance (F225-F256)
// ============================================================================
test("Scenario 10: Stage 8 Autonomous FinOps, Differential Privacy, Merkle Selective Disclosure & GDPR RTBF (F225-F256)", async () => {
  const finops = new KosmoraFinOpsComplianceEngine();

  // 10a. Multi-Armed Bandit UCB1 Routing & Circuit-Breaker Quarantine
  finops.registerProviderArm({
    provider_id: "arm_fast",
    model_id: "fast-v1",
    ewma_latency_ms: 95,
    cost_per_1k_usd: 0.0005
  });
  finops.registerProviderArm({
    provider_id: "arm_flaky",
    model_id: "flaky-v1",
    ewma_latency_ms: 400,
    cost_per_1k_usd: 0.0002
  });
  finops.recordProviderBanditReward({ provider_id: "arm_fast", succeeded: true, latency_ms: 90 });
  // Trigger repeated failures on arm_flaky -> circuit_open becomes true
  for (let i = 0; i < 5; i += 1) {
    finops.recordProviderBanditReward({ provider_id: "arm_flaky", succeeded: false, latency_ms: 900 });
  }
  const routeDecision = finops.selectOptimalProviderBandit({ max_latency_slo_ms: 1500 });
  assert.notEqual(routeDecision.selected_provider_id, "arm_flaky");
  assert.equal(
    routeDecision.ranked_candidates.some((c) => c.provider_id === "arm_flaky"),
    false
  );

  // 10b. OLS Hourly Burn-Rate Forecaster & Z-Score Anomaly Detector
  const forecast = finops.forecastTenantFinOpsBurnRate({
    tenant_id: "tenant_finops",
    budget_cap_usd: 500,
    hourly_spend_series: [
      { hour_index: 1, spend_usd: 10 },
      { hour_index: 2, spend_usd: 11 },
      { hour_index: 3, spend_usd: 10.5 },
      { hour_index: 4, spend_usd: 11.2 },
      { hour_index: 5, spend_usd: 10.8 },
      { hour_index: 6, spend_usd: 45.0 }
    ]
  });
  assert.ok(forecast.hourly_burn_slope_usd > 0);
  assert.equal(forecast.anomaly_detected, true);
  assert.ok(forecast.anomaly_z_score >= 2.5);

  // 10c. (epsilon) Differential Privacy Laplace Mechanism & Budget Exhaustion Guard
  finops.configureTenantPrivacyBudget("tenant_dp", 1.0);
  const dpQuery1 = finops.applyDifferentialPrivacyMechanism({
    tenant_id: "tenant_dp",
    true_value: 1000,
    query_sensitivity: 1.0,
    epsilon_cost: 0.6,
    deterministic_seed: "seed_audit_1"
  });
  assert.equal(dpQuery1.laplace_scale_b, Number((1.0 / 0.6).toFixed(4)));
  assert.equal(dpQuery1.remaining_epsilon_budget, 0.4);
  assert.notEqual(dpQuery1.noised_value, 1000);

  // Exceeding remaining epsilon (0.4) must throw privacy budget exhaustion error
  assert.throws(
    () =>
      finops.applyDifferentialPrivacyMechanism({
        tenant_id: "tenant_dp",
        true_value: 500,
        query_sensitivity: 1.0,
        epsilon_cost: 0.5,
        deterministic_seed: "seed_audit_2"
      }),
    /Differential privacy budget exhausted/
  );

  // 10d. Cryptographic SHA-256 Merkle Tree Selective Disclosure Proof & Tamper Rejection
  const claims = [
    { claim_id: "c_gdpr", category: "gdpr_residency" as const, statement: "EU residency enforced", verified_at_iso: "2026-10-25T00:00:00Z" },
    { claim_id: "c_soc2", category: "soc2_encryption" as const, statement: "AES-256-GCM active", verified_at_iso: "2026-10-25T00:00:00Z" },
    { claim_id: "c_hitl", category: "hitl_governance" as const, statement: "HITL gates enforced", verified_at_iso: "2026-10-25T00:00:00Z" },
    { claim_id: "c_rls", category: "rls_isolation" as const, statement: "Tenant RLS active", verified_at_iso: "2026-10-25T00:00:00Z" }
  ];
  const proof = finops.generateSelectiveDisclosureProof(claims, "c_soc2");
  assert.equal(proof.claim.claim_id, "c_soc2");
  assert.equal(proof.proof_steps.length, 2);
  assert.equal(finops.verifySelectiveDisclosureProof(proof), true);

  const tamperedProof = {
    ...proof,
    claim: {
      ...proof.claim,
      statement: "TAMPERED_STATEMENT"
    }
  };
  assert.equal(finops.verifySelectiveDisclosureProof(tamperedProof), false);

  // 10e. GDPR / 152-FZ Right-to-be-Forgotten Cascade & Signed Cryptographic Erasure Certificate
  finops.storeSubjectDataRecord({
    tenant_id: "tenant_gdpr",
    record_id: "rec_pii_1",
    subject_id: "subj_user_77",
    data: "User profile node"
  });
  finops.storeSubjectDataRecord({
    tenant_id: "tenant_gdpr",
    record_id: "rec_pii_2",
    subject_id: "subj_user_77",
    data: "Snapshot PII embedding"
  });
  const cert = finops.executeRightToBeForgottenCascade({
    tenant_id: "tenant_gdpr",
    subject_id: "subj_user_77"
  });
  assert.equal(cert.purged_records_count, 2);
  assert.ok(cert.certificate_sha256.length === 64);
  assert.equal(finops.listRemainingSubjectRecords("tenant_gdpr", "subj_user_77").length, 0);

  // 10f. Verify all 32 Stage 8 Feature Adapters (F225-F256) & Full 256-Module Catalog
  assert.equal(KOSMORA_STAGE8_CATALOG.length, 32);
  assert.equal(KOSMORA_256_COMPLETE_CATALOG.length, 256);
  const stage8Summary = verifyStage8FinOpsModules();
  assert.equal(stage8Summary.totalModules, 32);
  assert.equal(stage8Summary.verifiedCount, 32);

  // 10g. Verify Stage 8 HTTP Endpoints (/finops/bandit-route, /finops/forecast, /compliance/merkle-proof, /compliance/rtbf-erase, /features/execute F256)
  const cp = createKosmoraControlPlane(":memory:");
  const server = createKosmoraHttpServer(cp);
  await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", () => resolveListen()));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const session = cp.security.issueSignedSessionToken({
      user_id: "usr_finops_admin",
      tenant_id: "tenant_finops_http",
      workspace_ids: ["ws_finops"],
      role: "owner"
    });
    const headers = {
      "content-type": "application/json",
      authorization: `Bearer ${session.token}`
    };

    const banditRes = await fetch(`${baseUrl}/api/v1/kosmora/finops/bandit-route`, {
      method: "POST",
      headers,
      body: JSON.stringify({ workspace_id: "ws_finops", max_latency_slo_ms: 1800 })
    });
    assert.equal(banditRes.status, 200);
    const banditJson = (await banditRes.json()) as { selected_provider_id: string };
    assert.ok(banditJson.selected_provider_id.length > 0);

    const forecastRes = await fetch(`${baseUrl}/api/v1/kosmora/finops/forecast`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        workspace_id: "ws_finops",
        budget_cap_usd: 250,
        hourly_spend_series: [
          { hour_index: 1, spend_usd: 12 },
          { hour_index: 2, spend_usd: 13 },
          { hour_index: 3, spend_usd: 12.5 },
          { hour_index: 4, spend_usd: 13.2 },
          { hour_index: 5, spend_usd: 65 }
        ]
      })
    });
    assert.equal(forecastRes.status, 200);
    const forecastJson = (await forecastRes.json()) as { anomaly_detected: boolean };
    assert.equal(forecastJson.anomaly_detected, true);

    const merkleRes = await fetch(`${baseUrl}/api/v1/kosmora/compliance/merkle-proof`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        workspace_id: "ws_finops",
        claims,
        target_claim_id: "c_gdpr"
      })
    });
    assert.equal(merkleRes.status, 200);
    const merkleJson = (await merkleRes.json()) as { verified: boolean };
    assert.equal(merkleJson.verified, true);

    const rtbfRes = await fetch(`${baseUrl}/api/v1/kosmora/compliance/rtbf-erase`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        workspace_id: "ws_finops",
        subject_id: "subj_http_99"
      })
    });
    assert.equal(rtbfRes.status, 200);
    const rtbfJson = (await rtbfRes.json()) as { certificate_id: string; purged_records_count: number };
    assert.ok(rtbfJson.certificate_id.startsWith("rtbf_cert_"));

    const f256Res = await fetch(`${baseUrl}/api/v1/kosmora/features/execute`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        feature_id: "F256",
        request_id: "req_http_f256",
        project_id: "proj_finops",
        workspace_id: "ws_finops"
      })
    });
    assert.equal(f256Res.status, 200);
    const f256Json = (await f256Res.json()) as { domainOutcome: { stateChanged: boolean } };
    assert.equal(f256Json.domainOutcome.stateChanged, true);
  } finally {
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    cp.store.close(true);
  }
});

// ============================================================================
// SCENARIO 11: Stage 9 Quantum-Resistant Cryptography & Zero-Knowledge Proofs (F257-F288)
// ============================================================================
test("Scenario 11: Stage 9 Quantum-Resistant Cryptography, HKDF-SHA512, Shamir GF(65537) Secret Sharing, Fiat-Shamir NIZKP, Lamport PQC Signatures & RFC 6962 Transparency Log (F257-F288)", async () => {
  const qzk = new KosmoraQuantumZkEngine();

  // 11a. RFC 5869 HKDF-SHA512 Key Hierarchy Derivation
  const keyA = qzk.deriveHkdfKeyMaterial({
    input_key_material: "sovereign_master_ikm_2026",
    salt: "tenant_alpha_salt",
    context_info: "kosmora:vault:dek:v1",
    length_bytes: 48
  });
  const keyB = qzk.deriveHkdfKeyMaterial({
    input_key_material: "sovereign_master_ikm_2026",
    salt: "tenant_alpha_salt",
    context_info: "kosmora:vault:dek:v2",
    length_bytes: 48
  });
  assert.equal(keyA.byte_length, 48);
  assert.equal(keyA.derived_key_hex.length, 96);
  assert.notEqual(keyA.derived_key_hex, keyB.derived_key_hex);

  // 11b. Shamir's (k=3, n=5) Threshold Secret Sharing over GF(65537) & Lagrange Interpolation
  const masterSecret = "ksm_root_key_998877665544332211_sovereign";
  const shares = qzk.splitSecretShamirThreshold({
    secret_utf8: masterSecret,
    total_shares_n: 5,
    threshold_k: 3,
    deterministic_seed: "seed_shamir_test"
  });
  assert.equal(shares.length, 5);

  // Any 3 shares reconstruct the exact secret (e.g., shares #1, #3, #5)
  const recovered135 = qzk.reconstructSecretShamirLagrange([shares[0]!, shares[2]!, shares[4]!], 3);
  assert.equal(recovered135, masterSecret);

  // Different subset of 3 shares (#2, #3, #4) also reconstructs the exact secret
  const recovered234 = qzk.reconstructSecretShamirLagrange([shares[1]!, shares[2]!, shares[3]!], 3);
  assert.equal(recovered234, masterSecret);

  // Fewer than threshold_k shares (2 < 3) must throw an error
  assert.throws(
    () => qzk.reconstructSecretShamirLagrange([shares[0]!, shares[1]!], 3),
    /Insufficient Shamir shares/
  );

  // Tampered share y-value must be rejected by checksum verification
  const corruptedShare = {
    ...shares[0]!,
    y_values: [shares[0]!.y_values[0]! ^ 0xff, ...shares[0]!.y_values.slice(1)]
  };
  assert.throws(
    () => qzk.reconstructSecretShamirLagrange([corruptedShare, shares[1]!, shares[2]!], 3),
    /Corrupted Shamir share/
  );

  // 11c. Fiat-Shamir Non-Interactive Zero-Knowledge Proof (Schnorr NIZKP)
  const zkProof = qzk.generateFiatShamirZeroKnowledgeProof({
    statement_id: "stmt_policy_compliance_42",
    secret_witness_scalar: 987654321,
    nonce_seed: "nonce_zk_1"
  });
  assert.equal(qzk.verifyFiatShamirZeroKnowledgeProof(zkProof), true);

  // Tampered response_s must fail Schnorr verification equation g^s === t * y^c (mod p)
  const forgedZkProof = {
    ...zkProof,
    response_s: (BigInt(zkProof.response_s) + 1n).toString()
  };
  assert.equal(qzk.verifyFiatShamirZeroKnowledgeProof(forgedZkProof), false);

  // 11d. Post-Quantum Hash-Based Lamport-SHA256 One-Time Signatures
  const pqcSig = qzk.signPostQuantumLamportMessage({
    key_id: "pqc_ots_key_01",
    private_seed: "quantum_safe_private_seed_01",
    message: "Approve sovereign release v10.0"
  });
  assert.equal(qzk.verifyPostQuantumLamportSignature(pqcSig, "Approve sovereign release v10.0"), true);
  assert.equal(qzk.verifyPostQuantumLamportSignature(pqcSig, "Tampered release v10.0"), false);

  // 11e. RFC 6962 Verifiable Append-Only Transparency Log
  qzk.appendTransparencyLogEntry("entry_0_genesis");
  qzk.appendTransparencyLogEntry("entry_1_key_rotation");
  const receipt2 = qzk.appendTransparencyLogEntry("entry_2_artifact_attestation");
  assert.equal(receipt2.log_size, 3);
  assert.equal(qzk.verifyTransparencyLogReceipt(receipt2), true);
  assert.equal(
    qzk.verifyTransparencyLogReceipt({ ...receipt2, entry_hash: "0".repeat(64) }),
    false
  );

  // 11f. Verify all 32 Stage 9 Feature Adapters (F257-F288)
  assert.equal(KOSMORA_STAGE9_CATALOG.length, 32);
  const stage9Summary = verifyStage9QuantumZkModules();
  assert.equal(stage9Summary.totalModules, 32);
  assert.equal(stage9Summary.verifiedCount, 32);
  assert.equal(stage9Summary.allPassed, true);

  // 11g. Verify Stage 9 HTTP Endpoints (/quantum/shamir-split-recover, /quantum/zk-prove-verify, /quantum/pqc-sign-verify, /features/execute F270)
  const cp = createKosmoraControlPlane(":memory:");
  const server = createKosmoraHttpServer(cp);
  await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", () => resolveListen()));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const session = cp.security.issueSignedSessionToken({
      user_id: "usr_quantum_sec",
      tenant_id: "tenant_quantum",
      workspace_ids: ["ws_quantum"],
      role: "owner"
    });
    const headers = {
      "content-type": "application/json",
      authorization: `Bearer ${session.token}`
    };

    const shamirRes = await fetch(`${baseUrl}/api/v1/kosmora/quantum/shamir-split-recover`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        workspace_id: "ws_quantum",
        secret_utf8: "http_shamir_secret_2026",
        total_shares_n: 5,
        threshold_k: 3
      })
    });
    assert.equal(shamirRes.status, 200);
    const shamirJson = (await shamirRes.json()) as { recovered_exact_match: boolean; shares_count: number };
    assert.equal(shamirJson.shares_count, 5);
    assert.equal(shamirJson.recovered_exact_match, true);

    const zkRes = await fetch(`${baseUrl}/api/v1/kosmora/quantum/zk-prove-verify`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        workspace_id: "ws_quantum",
        statement_id: "stmt_http_zk",
        secret_witness_scalar: 777888
      })
    });
    assert.equal(zkRes.status, 200);
    const zkJson = (await zkRes.json()) as { verified: boolean };
    assert.equal(zkJson.verified, true);

    const pqcRes = await fetch(`${baseUrl}/api/v1/kosmora/quantum/pqc-sign-verify`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        workspace_id: "ws_quantum",
        key_id: "pqc_http_1",
        private_seed: "seed_http_pqc",
        message: "Quantum-resistant control plane payload"
      })
    });
    assert.equal(pqcRes.status, 200);
    const pqcJson = (await pqcRes.json()) as { verified: boolean };
    assert.equal(pqcJson.verified, true);

    const f270Res = await fetch(`${baseUrl}/api/v1/kosmora/features/execute`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        feature_id: "F270",
        request_id: "req_http_f270",
        project_id: "proj_quantum",
        workspace_id: "ws_quantum"
      })
    });
    assert.equal(f270Res.status, 200);
    const f270Json = (await f270Res.json()) as { domainOutcome: { stateChanged: boolean } };
    assert.equal(f270Json.domainOutcome.stateChanged, true);
  } finally {
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    cp.store.close(true);
  }
});

// ============================================================================
// SCENARIO 12: Stage 10 Multi-Agent Game-Theoretic Mechanism Design (F289-F320)
// ============================================================================
test("Scenario 12: Stage 10 Game-Theoretic Mechanism Design — Exact Shapley Attribution, Strategy-Proof VCG Task Auction, Schulze Condorcet Consensus & Gale-Shapley Stable Matching (F289-F320)", async () => {
  const gt = new KosmoraGameTheoryEngine();

  // 12a. Exact Coalition Shapley Value Attribution (Efficiency Axiom: Sum phi_i === v(N))
  const shapley = gt.computeExactShapleyAttribution({
    players: ["planner", "coder", "verifier"],
    coalition_values: {
      "planner": 20,
      "coder": 40,
      "verifier": 10,
      "coder,planner": 75,
      "planner,verifier": 40,
      "coder,verifier": 60,
      "coder,planner,verifier": 120
    }
  });
  assert.equal(shapley.grand_coalition_value, 120);
  assert.equal(shapley.efficiency_verified, true);
  const sumPhi = Object.values(shapley.shapley_values).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sumPhi - 120) < 1e-4);
  assert.ok(shapley.shapley_values["coder"]! > shapley.shapley_values["verifier"]!);

  // 12b. Strategy-Proof Vickrey-Clarke-Groves (VCG) Combinatorial Task Auction
  const vcg = gt.runVcgCombinatorialTaskAuction({
    tasks: ["slot_synthesis", "slot_verification"],
    bids: [
      { agent_id: "agent_a", task_id: "slot_synthesis", reported_cost_usd: 1.0, estimated_quality: 0.95 },
      { agent_id: "agent_b", task_id: "slot_synthesis", reported_cost_usd: 2.5, estimated_quality: 0.90 },
      { agent_id: "agent_b", task_id: "slot_verification", reported_cost_usd: 1.2, estimated_quality: 0.94 },
      { agent_id: "agent_c", task_id: "slot_verification", reported_cost_usd: 3.0, estimated_quality: 0.85 }
    ]
  });
  assert.equal(vcg.winning_assignments.slot_synthesis, "agent_a");
  assert.equal(vcg.winning_assignments.slot_verification, "agent_b");
  assert.equal(vcg.strategy_proof_verified, true);
  assert.ok(vcg.vcg_payments_usd.agent_a! >= 1.0);
  assert.ok(vcg.vcg_payments_usd.agent_b! >= 1.2);

  // 12c. Condorcet / Schulze Beatpath Ranked-Choice Consensus
  const schulze = gt.aggregateSchulzeCondorcetConsensus({
    candidates: ["plan_monolith", "plan_modular_dag", "plan_ad_hoc"],
    ranked_ballots: [
      ["plan_modular_dag", "plan_monolith", "plan_ad_hoc"],
      ["plan_modular_dag", "plan_ad_hoc", "plan_monolith"],
      ["plan_monolith", "plan_modular_dag", "plan_ad_hoc"]
    ]
  });
  assert.equal(schulze.condorcet_winner, "plan_modular_dag");
  assert.equal(schulze.ranking_order[0], "plan_modular_dag");

  // 12d. Gale-Shapley Deferred Acceptance Stable Agent-to-Task Matching
  const matching = gt.solveGaleShapleyStableMatching({
    agent_preferences: {
      agent_1: ["task_1", "task_2", "task_3"],
      agent_2: ["task_2", "task_1", "task_3"],
      agent_3: ["task_1", "task_3", "task_2"]
    },
    task_preferences: {
      task_1: ["agent_2", "agent_1", "agent_3"],
      task_2: ["agent_1", "agent_2", "agent_3"],
      task_3: ["agent_1", "agent_3", "agent_2"]
    }
  });
  assert.equal(matching.blocking_pairs_count, 0);
  assert.equal(matching.pareto_stable_verified, true);
  assert.equal(Object.keys(matching.agent_to_task).length, 3);

  // 12e. Verify all 32 Stage 10 Feature Adapters (F289-F320) & Full 320-Module Ultimate Catalog
  assert.equal(KOSMORA_STAGE10_CATALOG.length, 32);
  assert.equal(KOSMORA_320_ULTIMATE_CATALOG.length, 320);
  const stage10Summary = verifyStage10GameTheoryModules();
  assert.equal(stage10Summary.totalModules, 32);
  assert.equal(stage10Summary.verifiedCount, 32);
  assert.equal(stage10Summary.allPassed, true);

  // 12f. Verify Stage 10 HTTP Endpoints (/gametheory/shapley-allocate, /gametheory/vcg-auction, /gametheory/schulze-consensus, /gametheory/stable-matching, /features/execute F320)
  const cp = createKosmoraControlPlane(":memory:");
  const server = createKosmoraHttpServer(cp);
  await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", () => resolveListen()));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const session = cp.security.issueSignedSessionToken({
      user_id: "usr_gametheory_admin",
      tenant_id: "tenant_gt",
      workspace_ids: ["ws_gt"],
      role: "owner"
    });
    const headers = {
      "content-type": "application/json",
      authorization: `Bearer ${session.token}`
    };

    const shapleyRes = await fetch(`${baseUrl}/api/v1/kosmora/gametheory/shapley-allocate`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        workspace_id: "ws_gt",
        players: ["a1", "a2"],
        coalition_values: { "a1": 30, "a2": 20, "a1,a2": 80 }
      })
    });
    assert.equal(shapleyRes.status, 200);
    const shapleyJson = (await shapleyRes.json()) as { efficiency_verified: boolean; grand_coalition_value: number };
    assert.equal(shapleyJson.efficiency_verified, true);
    assert.equal(shapleyJson.grand_coalition_value, 80);

    const vcgRes = await fetch(`${baseUrl}/api/v1/kosmora/gametheory/vcg-auction`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        workspace_id: "ws_gt",
        tasks: ["t_1"],
        bids: [
          { agent_id: "ag_1", task_id: "t_1", reported_cost_usd: 1.0, estimated_quality: 0.95 },
          { agent_id: "ag_2", task_id: "t_1", reported_cost_usd: 2.0, estimated_quality: 0.85 }
        ]
      })
    });
    assert.equal(vcgRes.status, 200);
    const vcgJson = (await vcgRes.json()) as { strategy_proof_verified: boolean; winning_assignments: Record<string, string> };
    assert.equal(vcgJson.strategy_proof_verified, true);
    assert.equal(vcgJson.winning_assignments.t_1, "ag_1");

    const schulzeRes = await fetch(`${baseUrl}/api/v1/kosmora/gametheory/schulze-consensus`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        workspace_id: "ws_gt",
        candidates: ["opt_1", "opt_2"],
        ranked_ballots: [["opt_1", "opt_2"], ["opt_1", "opt_2"]]
      })
    });
    assert.equal(schulzeRes.status, 200);
    const schulzeJson = (await schulzeRes.json()) as { condorcet_winner: string };
    assert.equal(schulzeJson.condorcet_winner, "opt_1");

    const matchRes = await fetch(`${baseUrl}/api/v1/kosmora/gametheory/stable-matching`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        workspace_id: "ws_gt",
        agent_preferences: { a1: ["t1", "t2"], a2: ["t2", "t1"] },
        task_preferences: { t1: ["a1", "a2"], t2: ["a2", "a1"] }
      })
    });
    assert.equal(matchRes.status, 200);
    const matchJson = (await matchRes.json()) as { pareto_stable_verified: boolean; blocking_pairs_count: number };
    assert.equal(matchJson.pareto_stable_verified, true);
    assert.equal(matchJson.blocking_pairs_count, 0);

    const f320Res = await fetch(`${baseUrl}/api/v1/kosmora/features/execute`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        feature_id: "F320",
        request_id: "req_http_f320",
        project_id: "proj_gt",
        workspace_id: "ws_gt"
      })
    });
    assert.equal(f320Res.status, 200);
    const f320Json = (await f320Res.json()) as { domainOutcome: { stateChanged: boolean } };
    assert.equal(f320Json.domainOutcome.stateChanged, true);
  } finally {
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    cp.store.close(true);
  }
});

// ============================================================================
// SCENARIO 13: Stage 11 Causal Inference, Counterfactuals, Bayesian Belief Networks & Thompson Sampling (F321-F352)
// ============================================================================
test("Scenario 13: Stage 11 Causal Inference (do-Calculus), Counterfactual Abduction-Action-Prediction, Bayesian Belief Networks & Beta-Bernoulli Thompson Sampling (F321-F352)", async () => {
  const causal = new KosmoraCausalBayesianEngine();

  const scmModel = {
    variables: ["confounder_load", "treatment_tier", "mediator_context", "outcome_accuracy"],
    edges: [
      { from: "confounder_load", to: "treatment_tier", weight: -0.5 },
      { from: "confounder_load", to: "outcome_accuracy", weight: -0.4 },
      { from: "treatment_tier", to: "mediator_context", weight: 0.8 },
      { from: "mediator_context", to: "outcome_accuracy", weight: 0.5 },
      { from: "treatment_tier", to: "outcome_accuracy", weight: 0.6 }
    ],
    exogenous_means: {
      confounder_load: 2.0,
      treatment_tier: 1.0,
      mediator_context: 0.5,
      outcome_accuracy: 0.1
    }
  };

  // 13a. Pearl's do-Calculus Intervention & Backdoor Confounder Identification
  // Direct + indirect causal effect of 1 unit of treatment_tier on outcome_accuracy is 0.6 + (0.8 * 0.5) = 1.0
  const doRes = causal.evaluateStructuralCausalIntervention({
    model: scmModel,
    treatment_var: "treatment_tier",
    outcome_var: "outcome_accuracy",
    do_value: 2.0,
    baseline_value: 1.0
  });
  assert.equal(doRes.average_causal_effect, 1.0);
  assert.deepEqual(doRes.backdoor_confounders, ["confounder_load"]);
  assert.notEqual(doRes.interventional_outcome_do_v, doRes.observational_outcome);

  // 13b. 3-Step Counterfactual Calculus (Abduction -> Action -> Prediction)
  const cfRes = causal.computeCounterfactualTrajectory({
    model: scmModel,
    observed_evidence: {
      confounder_load: 4.0,
      treatment_tier: 0.0,
      mediator_context: 0.2,
      outcome_accuracy: -1.2
    },
    intervention_var: "treatment_tier",
    intervention_value: 3.0,
    outcome_var: "outcome_accuracy"
  });
  // Increasing treatment_tier by +3.0 units increases outcome_accuracy by +3.0 * (0.6 + 0.8*0.5) = +3.0
  assert.equal(cfRes.individual_treatment_effect, 3.0);
  assert.equal(cfRes.counterfactual_outcome, Number((-1.2 + 3.0).toFixed(6)));

  // 13c. Exact Bayesian Belief Network Posterior Updating & Information Gain
  const bayes = causal.updateBayesianBeliefNetwork({
    hypotheses: [
      {
        hypothesis_id: "h_rate_limit",
        prior_probability: 0.2,
        likelihood_given_evidence: { status_429: 0.95, timeout_spike: 0.7 }
      },
      {
        hypothesis_id: "h_healthy",
        prior_probability: 0.8,
        likelihood_given_evidence: { status_429: 0.01, timeout_spike: 0.05 }
      }
    ],
    observed_evidence: { status_429: true, timeout_spike: true }
  });
  assert.equal(bayes.map_hypothesis_id, "h_rate_limit");
  assert.ok(bayes.map_probability > 0.95);
  assert.ok(bayes.information_gain_bits > 0);

  // 13d. Beta-Bernoulli Conjugate Thompson Sampling
  const ts = causal.sampleThompsonBetaPosterior({
    arms: [
      { arm_id: "arm_dominant", alpha_successes: 120, beta_failures: 5 },
      { arm_id: "arm_weak", alpha_successes: 4, beta_failures: 80 }
    ],
    deterministic_seed: "seed_stage11_test"
  });
  assert.equal(ts.selected_arm_id, "arm_dominant");
  assert.ok(ts.credible_intervals_95.arm_dominant![0] > ts.credible_intervals_95.arm_weak![1]);

  // 13e. Verify all 32 Stage 11 Feature Adapters (F321-F352)
  assert.equal(KOSMORA_STAGE11_CATALOG.length, 32);
  const s11Summary = verifyStage11CausalBayesianModules();
  assert.equal(s11Summary.totalModules, 32);
  assert.equal(s11Summary.verifiedCount, 32);
  assert.equal(s11Summary.allPassed, true);

  // 13f. Verify Stage 11 HTTP Endpoints (/causal/do-intervention, /causal/counterfactual, /causal/bayesian-posterior, /causal/thompson-sample, /features/execute F330)
  const cp = createKosmoraControlPlane(":memory:");
  const server = createKosmoraHttpServer(cp);
  await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", () => resolveListen()));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const session = cp.security.issueSignedSessionToken({
      user_id: "usr_causal_scientist",
      tenant_id: "tenant_causal",
      workspace_ids: ["ws_causal"],
      role: "owner"
    });
    const headers = {
      "content-type": "application/json",
      authorization: `Bearer ${session.token}`
    };

    const doHttp = await fetch(`${baseUrl}/api/v1/kosmora/causal/do-intervention`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        workspace_id: "ws_causal",
        model: scmModel,
        treatment_var: "treatment_tier",
        outcome_var: "outcome_accuracy",
        do_value: 2.0,
        baseline_value: 1.0
      })
    });
    assert.equal(doHttp.status, 200);
    const doJson = (await doHttp.json()) as { average_causal_effect: number };
    assert.equal(doJson.average_causal_effect, 1.0);

    const cfHttp = await fetch(`${baseUrl}/api/v1/kosmora/causal/counterfactual`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        workspace_id: "ws_causal",
        model: scmModel,
        observed_evidence: { confounder_load: 2.0, treatment_tier: 1.0, mediator_context: 1.3, outcome_accuracy: 0.55 },
        intervention_var: "treatment_tier",
        intervention_value: 2.0,
        outcome_var: "outcome_accuracy"
      })
    });
    assert.equal(cfHttp.status, 200);
    const cfJson = (await cfHttp.json()) as { individual_treatment_effect: number };
    assert.equal(cfJson.individual_treatment_effect, 1.0);

    const f330Res = await fetch(`${baseUrl}/api/v1/kosmora/features/execute`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        feature_id: "F330",
        request_id: "req_http_f330",
        project_id: "proj_causal",
        workspace_id: "ws_causal"
      })
    });
    assert.equal(f330Res.status, 200);
    const f330Json = (await f330Res.json()) as { domainOutcome: { stateChanged: boolean } };
    assert.equal(f330Json.domainOutcome.stateChanged, true);
  } finally {
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    cp.store.close(true);
  }
});

// ============================================================================
// SCENARIO 14: Stage 12 Homomorphic Encryption (Paillier), Wesolowski VDF, Capability Macaroons & 3f+1 Byzantine Quorum (F353-F384)
// ============================================================================
test("Scenario 14: Stage 12 Paillier Additive Homomorphic Encryption, Wesolowski VDF Proofs, Attenuated Capability Macaroons & 3f+1 Byzantine Quorum Intersection (F353-F384)", async () => {
  const hvdf = new KosmoraHomomorphicVdfEngine();

  // 14a. Paillier Additive Homomorphic Encryption: D(E(m1) * E(m2) mod n^2) === m1 + m2
  const c1 = hvdf.encryptPaillierHomomorphic(4200, "r_seed_1");
  const c2 = hvdf.encryptPaillierHomomorphic(5800, "r_seed_2");
  assert.notEqual(c1.ciphertext_dec, "4200");
  const cSum = hvdf.addHomomorphicCiphertexts(c1, c2);
  assert.equal(hvdf.decryptPaillierHomomorphic(cSum), 10000);

  // Homomorphic scalar multiplication: D(E(m1)^3 mod n^2) === 3 * m1
  const cScaled = hvdf.multiplyHomomorphicScalar(c1, 3);
  assert.equal(hvdf.decryptPaillierHomomorphic(cScaled), 12600);

  // 14b. Wesolowski Verifiable Delay Function (VDF) Evaluation & Fast Algebraic Verification
  const vdfProof = hvdf.evaluateVerifiableDelayFunction({
    challenge_id: "vdf_epoch_100",
    seed_input: "beacon_seed_2026",
    iterations_t: 128
  });
  assert.equal(hvdf.verifyVerifiableDelayProof(vdfProof), true);
  assert.equal(
    hvdf.verifyVerifiableDelayProof({ ...vdfProof, output_y: (BigInt(vdfProof.output_y) + 1n).toString() }),
    false
  );

  // 14c. Chained HMAC Capability Macaroons with Offline Caveat Attenuation & Tamper Rejection
  const rootKey = "ksm_macaroon_master_secret_2026";
  const rootMac = hvdf.mintCapabilityMacaroon({
    root_secret: rootKey,
    identifier: "mac_worker_99",
    location: "kosmora://worker-pool",
    initial_caveats: ["tenant_id = tenant_sovereign"]
  });
  const attenuatedMac = hvdf.attenuateMacaroonWithCaveats(rootMac, [
    "op = export",
    "max_tokens <= 4000"
  ]);

  const validMacCheck = hvdf.verifyMacaroonAuthorization({
    root_secret: rootKey,
    macaroon: attenuatedMac,
    context: { tenant_id: "tenant_sovereign", op: "export", max_tokens: 2500 }
  });
  assert.equal(validMacCheck.valid, true);

  // Context violating caveat (max_tokens 8000 > 4000) must be denied
  const exceededMacCheck = hvdf.verifyMacaroonAuthorization({
    root_secret: rootKey,
    macaroon: attenuatedMac,
    context: { tenant_id: "tenant_sovereign", op: "export", max_tokens: 8000 }
  });
  assert.equal(exceededMacCheck.valid, false);
  assert.equal(exceededMacCheck.failed_caveat, "max_tokens <= 4000");

  // Stripping a caveat without knowing root_secret must fail HMAC verification
  const strippedMac = {
    ...attenuatedMac,
    caveats: attenuatedMac.caveats.slice(0, 1)
  };
  const strippedCheck = hvdf.verifyMacaroonAuthorization({
    root_secret: rootKey,
    macaroon: strippedMac,
    context: { tenant_id: "tenant_sovereign", op: "export", max_tokens: 8000 }
  });
  assert.equal(strippedCheck.valid, false);
  assert.equal(strippedCheck.failed_caveat, "HMAC_SIGNATURE_MISMATCH");

  // 14d. Malkhi-Reiter 3f+1 Byzantine Quorum Intersection & Equivocation Slasher
  const bftReport = hvdf.verifyByzantineQuorumIntersection({
    validators: ["n1", "n2", "n3", "n4"],
    quorum_a: ["n1", "n2", "n3"],
    quorum_b: ["n2", "n3", "n4"],
    votes: [
      { validator_id: "n1", view_number: 10, block_digest: "d_valid", signature_hex: "s1" },
      { validator_id: "n4", view_number: 10, block_digest: "d_valid", signature_hex: "s4_a" },
      { validator_id: "n4", view_number: 10, block_digest: "d_double_vote", signature_hex: "s4_b" }
    ]
  });
  assert.equal(bftReport.max_faulty_f, 1);
  assert.equal(bftReport.required_quorum_size, 3);
  assert.equal(bftReport.honest_intersection_guaranteed, true);
  assert.deepEqual(bftReport.intersection_nodes, ["n2", "n3"]);
  assert.deepEqual(bftReport.equivocating_validators, ["n4"]);

  // 14e. Verify all 32 Stage 12 Feature Adapters (F353-F384) & Full 384-Module Sovereign Catalog
  assert.equal(KOSMORA_STAGE12_CATALOG.length, 32);
  assert.equal(KOSMORA_384_SOVEREIGN_CATALOG.length, 384);
  const s12Summary = verifyStage12HomomorphicVdfModules();
  assert.equal(s12Summary.totalModules, 32);
  assert.equal(s12Summary.verifiedCount, 32);
  assert.equal(s12Summary.allPassed, true);

  // 14f. Verify Stage 12 HTTP Endpoints (/crypto/paillier-homomorphic-add, /crypto/vdf-evaluate-verify, /crypto/macaroon-mint-verify, /crypto/byzantine-quorum, /features/execute F384)
  const cp = createKosmoraControlPlane(":memory:");
  const server = createKosmoraHttpServer(cp);
  await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", () => resolveListen()));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const session = cp.security.issueSignedSessionToken({
      user_id: "usr_crypto_admin",
      tenant_id: "tenant_crypto",
      workspace_ids: ["ws_crypto"],
      role: "owner"
    });
    const headers = {
      "content-type": "application/json",
      authorization: `Bearer ${session.token}`
    };

    const paillierHttp = await fetch(`${baseUrl}/api/v1/kosmora/crypto/paillier-homomorphic-add`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        workspace_id: "ws_crypto",
        values: [1500, 2500, 6000]
      })
    });
    assert.equal(paillierHttp.status, 200);
    const paillierJson = (await paillierHttp.json()) as { decrypted_sum: number; homomorphic_verified: boolean };
    assert.equal(paillierJson.decrypted_sum, 10000);
    assert.equal(paillierJson.homomorphic_verified, true);

    const vdfHttp = await fetch(`${baseUrl}/api/v1/kosmora/crypto/vdf-evaluate-verify`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        workspace_id: "ws_crypto",
        challenge_id: "vdf_http_1",
        seed_input: "http_vdf_seed",
        iterations_t: 48
      })
    });
    assert.equal(vdfHttp.status, 200);
    const vdfJson = (await vdfHttp.json()) as { verified: boolean };
    assert.equal(vdfJson.verified, true);

    const macHttp = await fetch(`${baseUrl}/api/v1/kosmora/crypto/macaroon-mint-verify`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        workspace_id: "ws_crypto",
        identifier: "mac_http_1",
        caveats: ["role = analyst", "cost <= 25"],
        context: { role: "analyst", cost: 10 }
      })
    });
    assert.equal(macHttp.status, 200);
    const macJson = (await macHttp.json()) as { verification: { valid: boolean } };
    assert.equal(macJson.verification.valid, true);

    const f384Res = await fetch(`${baseUrl}/api/v1/kosmora/features/execute`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        feature_id: "F384",
        request_id: "req_http_f384",
        project_id: "proj_crypto",
        workspace_id: "ws_crypto"
      })
    });
    assert.equal(f384Res.status, 200);
    const f384Json = (await f384Res.json()) as { domainOutcome: { stateChanged: boolean } };
    assert.equal(f384Json.domainOutcome.stateChanged, true);
  } finally {
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    cp.store.close(true);
  }
});

test("Scenario 15: Stage 13 Neurosymbolic Datalog, DPLL SAT, Robinson Unification & Deontic Logic (F385–F416) + HTTP Control Plane", async () => {
  assert.equal(KOSMORA_STAGE13_CATALOG.length, 32);
  const stage13Report = verifyStage13NeurosymbolicSatModules();
  assert.equal(stage13Report.totalModules, 32);
  assert.equal(stage13Report.verifiedCount, 32);
  assert.equal(stage13Report.allPassed, true);

  const engine = new KosmoraNeurosymbolicSatEngine();

  // 1. Stratified Datalog recursive transitive closure + Negation-as-Failure
  const datalogOut = engine.evaluateDatalogFixpoint({
    edb_facts: [
      { predicate: "edge", terms: ["n1", "n2"] },
      { predicate: "edge", terms: ["n2", "n3"] },
      { predicate: "edge", terms: ["n3", "n4"] },
      { predicate: "quarantined", terms: ["n4"] }
    ],
    rules: [
      {
        rule_id: "R_BASE",
        head: { predicate: "reachable", terms: ["?X", "?Y"] },
        body: [{ predicate: "edge", terms: ["?X", "?Y"] }]
      },
      {
        rule_id: "R_REC",
        head: { predicate: "reachable", terms: ["?X", "?Z"] },
        body: [
          { predicate: "edge", terms: ["?X", "?Y"] },
          { predicate: "reachable", terms: ["?Y", "?Z"] }
        ]
      },
      {
        rule_id: "R_SAFE_REACH",
        head: { predicate: "safe_target", terms: ["?X", "?Y"] },
        body: [
          { predicate: "reachable", terms: ["?X", "?Y"] },
          { predicate: "quarantined", terms: ["?Y"], negated: true }
        ]
      }
    ]
  });
  const safeTargets = datalogOut.derived_facts.filter((f) => f.startsWith("safe_target("));
  assert.equal(safeTargets.length, 3); // (n1,n2), (n1,n3), (n2,n3) — n4 excluded by NAF
  assert.equal(datalogOut.fixpoint_digest.length, 64);

  // 2. DPLL SAT Solver (SAT & UNSAT cases)
  const satRes = engine.solveDpllBooleanSat({
    num_vars: 4,
    clauses: [[1, 2], [-1, 3], [-2, 3], [-3, 4]]
  });
  assert.equal(satRes.satisfiable, true);
  assert.equal(satRes.assignment[3], true);
  assert.equal(satRes.assignment[4], true);
  assert.equal(satRes.verified_all_clauses, true);

  const unsatRes = engine.solveDpllBooleanSat({
    num_vars: 1,
    clauses: [[1], [-1]]
  });
  assert.equal(unsatRes.satisfiable, false);

  // 3. Robinson First-Order Unification (MGU + Occurs-Check rejection)
  const mguOk = engine.unifyFirstOrderTerms(
    {
      kind: "func",
      symbol: "deploy",
      args: [
        { kind: "var", name: "?Service" },
        { kind: "func", symbol: "region", args: [{ kind: "const", value: "eu_central" }] }
      ]
    },
    {
      kind: "func",
      symbol: "deploy",
      args: [
        { kind: "const", value: "kosmora_core" },
        { kind: "var", name: "?TargetRegion" }
      ]
    }
  );
  assert.equal(mguOk.unifiable, true);
  assert.equal(mguOk.occurs_check_failed, false);
  assert.equal(mguOk.mgu_bindings["?Service"], "kosmora_core");
  assert.equal(mguOk.mgu_bindings["?TargetRegion"], "region(eu_central)");

  const mguCycle = engine.unifyFirstOrderTerms(
    { kind: "var", name: "?X" },
    { kind: "func", symbol: "f", args: [{ kind: "var", name: "?X" }] }
  );
  assert.equal(mguCycle.unifiable, false);
  assert.equal(mguCycle.occurs_check_failed, true);

  // 4. Deontic Policy Consistency
  const deonticConflict = engine.verifyDeonticPolicyConsistency([
    { norm_id: "D1", modality: "obligation", action: "rotate_master_key", role: "secops", condition: "tier:critical" },
    { norm_id: "D2", modality: "prohibition", action: "rotate_master_key", role: "secops", condition: "*" }
  ]);
  assert.equal(deonticConflict.consistent, false);
  assert.equal(deonticConflict.deontic_conflicts.length, 1);

  // 5. Verify HTTP endpoints
  const cp = createKosmoraControlPlane(":memory:");
  const server = createKosmoraHttpServer(cp);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const addr = server.address() as { port: number };
  try {
    const session = cp.security.issueSignedSessionToken({
      user_id: "usr_symbolic",
      tenant_id: "tenant_symbolic",
      workspace_ids: ["ws_symbolic"],
      role: "owner"
    });
    const headers = {
      "content-type": "application/json",
      authorization: `Bearer ${session.token}`
    };

    const resp = await fetch(`http://127.0.0.1:${addr.port}/api/v1/kosmora/symbolic/dpll-sat`, {
      method: "POST",
      headers,
      body: JSON.stringify({ num_vars: 2, clauses: [[1, 2], [-1, 2]] })
    });
    assert.equal(resp.status, 200);
    const json = (await resp.json()) as any;
    assert.equal(json.satisfiable, true);

    const f400Res = await fetch(`http://127.0.0.1:${addr.port}/api/v1/kosmora/features/execute`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        feature_id: "F400",
        request_id: "req_http_f400",
        project_id: "proj_symbolic",
        workspace_id: "ws_symbolic"
      })
    });
    assert.equal(f400Res.status, 200);
    const f400Json = (await f400Res.json()) as any;
    assert.equal(f400Json.domainOutcome.stateChanged, true);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    cp.store.close(true);
  }
});

test("Scenario 16: Stage 14 Cybernetic Control, Discrete PID, Kalman Filter, Graph Laplacian & Submodular Optimization (F417–F448) + 448 Omega Catalog", async () => {
  assert.equal(KOSMORA_STAGE14_CATALOG.length, 32);
  assert.equal(KOSMORA_448_OMEGA_CATALOG.length, 448);

  const stage14Report = verifyStage14CyberneticControlModules();
  assert.equal(stage14Report.totalModules, 32);
  assert.equal(stage14Report.verifiedCount, 32);
  assert.equal(stage14Report.allPassed, true);

  const engine = new KosmoraCyberneticControlEngine();

  // 1. Discrete PID Controller with Anti-Windup
  const pidOut = engine.simulateDiscretePidControlLoop({
    config: {
      kp: 0.7,
      ki: 0.2,
      kd: 0.05,
      setpoint: 120,
      integral_min: -40,
      integral_max: 40,
      output_min: -60,
      output_max: 60
    },
    initial_measurement: 10,
    plant_gain: 0.5,
    steps: 45,
    dt_sec: 0.5
  });
  assert.equal(pidOut.settled_within_tolerance, true);
  assert.ok(Math.abs(pidOut.final_error) < 5.0);

  // 2. 1D Discrete Kalman Filter
  const kalmanOut = engine.runKalmanFilterEstimation({
    initial_estimate_x0: 45.0,
    initial_covariance_p0: 2.0,
    process_noise_q: 0.002,
    measurement_noise_r: 0.4,
    measurements_z: [50.8, 49.2, 50.3, 49.7, 50.1, 49.9, 50.05, 49.95]
  });
  assert.ok(Math.abs(kalmanOut.final_estimate - 50.0) < 0.5);
  assert.ok(kalmanOut.final_covariance_p < 0.2);
  assert.ok(kalmanOut.covariance_reduction_ratio > 0.9);

  // 3. Graph Laplacian Spectral Connectivity (Fiedler value lambda_2 > 0)
  const lapOut = engine.analyzeGraphLaplacianConnectivity({
    nodes: ["core_1", "core_2", "core_3", "core_4"],
    undirected_edges: [
      ["core_1", "core_2"],
      ["core_2", "core_3"],
      ["core_3", "core_4"],
      ["core_4", "core_1"],
      ["core_1", "core_3"]
    ]
  });
  assert.equal(lapOut.is_connected, true);
  assert.ok(lapOut.algebraic_connectivity_lambda2 > 1.0);
  assert.equal(lapOut.topology_digest.length, 64);

  // 4. Nemhauser-Wolsey Submodular Greedy Coverage
  const submodOut = engine.maximizeSubmodularCoverageGreedy({
    universe_elements: ["t1", "t2", "t3", "t4", "t5", "t6", "t7"],
    max_picks_k: 2,
    candidates: [
      { item_id: "probe_north", covered_elements: ["t1", "t2", "t3", "t4"], cost: 1 },
      { item_id: "probe_south", covered_elements: ["t3", "t4", "t5", "t6"], cost: 1 },
      { item_id: "probe_east", covered_elements: ["t1", "t2", "t7"], cost: 1 }
    ]
  });
  assert.deepEqual(submodOut.selected_item_ids, ["probe_north", "probe_south"]);
  assert.equal(submodOut.covered_elements_count, 6);
  assert.equal(submodOut.diminishing_returns_verified, true);

  // 5. Verify HTTP endpoints + Health 448 Omega catalog
  const cp = createKosmoraControlPlane(":memory:");
  const server = createKosmoraHttpServer(cp);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const addr = server.address() as { port: number };
  try {
    const session = cp.security.issueSignedSessionToken({
      user_id: "usr_control",
      tenant_id: "tenant_control",
      workspace_ids: ["ws_control"],
      role: "owner"
    });
    const headers = {
      "content-type": "application/json",
      authorization: `Bearer ${session.token}`
    };

    const pidResp = await fetch(`http://127.0.0.1:${addr.port}/api/v1/kosmora/control/pid-simulate`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        config: {
          kp: 0.65,
          ki: 0.18,
          kd: 0.05,
          setpoint: 80,
          integral_min: -40,
          integral_max: 40,
          output_min: -50,
          output_max: 50
        },
        initial_measurement: 0,
        plant_gain: 0.5,
        steps: 35,
        dt_sec: 0.5
      })
    });
    assert.equal(pidResp.status, 200);
    const pidJson = (await pidResp.json()) as any;
    assert.equal(pidJson.settled_within_tolerance, true);

    const f448Res = await fetch(`http://127.0.0.1:${addr.port}/api/v1/kosmora/features/execute`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        feature_id: "F448",
        request_id: "req_http_f448",
        project_id: "proj_control",
        workspace_id: "ws_control"
      })
    });
    assert.equal(f448Res.status, 200);
    const f448Json = (await f448Res.json()) as any;
    assert.equal(f448Json.domainOutcome.stateChanged, true);

    const healthResp = await fetch(`http://127.0.0.1:${addr.port}/api/v1/kosmora/health`);
    assert.equal(healthResp.status, 200);
    const healthJson = (await healthResp.json()) as any;
    assert.equal(healthJson.omega_features_count, 448);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    cp.store.close(true);
  }
});

test("Scenario 17: Stage 15 Topological Data Analysis, Vietoris-Rips Betti Numbers, Persistent Homology, Ollivier-Ricci Curvature & Hodge Helmholtz Decomposition (F449–F480)", async () => {
  assert.equal(KOSMORA_STAGE15_CATALOG.length, 32);
  const stage15Report = verifyStage15TopologicalPersistenceModules();
  assert.equal(stage15Report.totalModules, 32);
  assert.equal(stage15Report.verifiedCount, 32);
  assert.equal(stage15Report.allPassed, true);

  const engine = new KosmoraTopologicalPersistenceEngine();

  // 1. Unit square point cloud at epsilon = 1.1: 4 vertices, 4 edges, 0 triangles => beta_0 = 1, beta_1 = 1 (one 1D hole!)
  const vrSquare = engine.computeVietorisRipsBettiNumbers({
    points: [
      { id: "v0", x: 0, y: 0 },
      { id: "v1", x: 1, y: 0 },
      { id: "v2", x: 1, y: 1 },
      { id: "v3", x: 0, y: 1 }
    ],
    epsilon: 1.1
  });
  assert.equal(vrSquare.vertices_v, 4);
  assert.equal(vrSquare.edges_e, 4);
  assert.equal(vrSquare.triangles_f, 0);
  assert.equal(vrSquare.betti_0_components, 1);
  assert.equal(vrSquare.betti_1_holes, 1);
  assert.equal(vrSquare.euler_poincare_verified, true);

  // At epsilon = 1.5 (> sqrt(2)), diagonals form triangles and fill the hole => beta_1 = 0
  const vrFilled = engine.computeVietorisRipsBettiNumbers({
    points: [
      { id: "v0", x: 0, y: 0 },
      { id: "v1", x: 1, y: 0 },
      { id: "v2", x: 1, y: 1 },
      { id: "v3", x: 0, y: 1 }
    ],
    epsilon: 1.5
  });
  assert.equal(vrFilled.betti_0_components, 1);
  assert.equal(vrFilled.betti_1_holes, 0);
  assert.equal(vrFilled.euler_poincare_verified, true);

  // 2. Persistent Homology Barcode over the unit square: H1 cycle born at 1.0, dies at sqrt(2) ~= 1.414214
  const barcode = engine.computePersistentHomologyBarcode({
    points: [
      { id: "v0", x: 0, y: 0 },
      { id: "v1", x: 1, y: 0 },
      { id: "v2", x: 1, y: 1 },
      { id: "v3", x: 0, y: 1 }
    ],
    max_epsilon: 2.0
  });
  assert.equal(barcode.h0_intervals.length, 3);
  assert.ok(barcode.h1_intervals.length >= 1);
  assert.equal(barcode.h1_intervals[0]!.birth_epsilon, 1);
  assert.ok(Math.abs(barcode.h1_intervals[0]!.death_epsilon - Math.SQRT2) < 1e-4);

  // 3. Ollivier-Ricci Curvature on a triangle (positive curvature) vs dumbbell bridge (negative curvature)
  const ricci = engine.computeOllivierRicciGraphCurvature({
    nodes: ["c1", "c2", "c3", "b1", "b2", "b3"],
    edges: [
      ["c1", "c2"],
      ["c2", "c3"],
      ["c1", "c3"],
      ["c3", "b1"], // bridge edge between two triangles
      ["b1", "b2"],
      ["b2", "b3"],
      ["b1", "b3"]
    ],
    lazy_alpha: 0.2
  });
  const cliqueEdge = ricci.edge_curvatures.find((e) => e.edge[0] === "c1" && e.edge[1] === "c2")!;
  const bridgeEdge = ricci.edge_curvatures.find((e) => e.edge[0] === "c3" && e.edge[1] === "b1")!;
  assert.ok(cliqueEdge.ollivier_ricci_kappa > 0, "Triangle edge must have positive Ollivier-Ricci curvature");
  assert.ok(bridgeEdge.ollivier_ricci_kappa < cliqueEdge.ollivier_ricci_kappa, "Bridge edge must have lower curvature than clique");

  // 4. Hodge 1-Laplacian Helmholtz Decomposition: pure cyclic flow has zero gradient component
  const hodgePureCycle = engine.decomposeEdgeFlowHodgeHelmholtz({
    nodes: ["n1", "n2", "n3"],
    directed_edges: [
      { from: "n1", to: "n2", flow: 5.0 },
      { from: "n2", to: "n3", flow: 5.0 },
      { from: "n3", to: "n1", flow: 5.0 }
    ]
  });
  assert.equal(hodgePureCycle.orthogonal_verified, true);
  assert.equal(hodgePureCycle.energy_conservation_verified, true);
  assert.ok(Math.abs(hodgePureCycle.divergence_free_cyclic_flow[0]! - 5.0) < 1e-3);

  // 5. Verify HTTP endpoints
  const cp = createKosmoraControlPlane(":memory:");
  const server = createKosmoraHttpServer(cp);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const addr = server.address() as { port: number };
  try {
    const session = cp.security.issueSignedSessionToken({
      user_id: "usr_tda",
      tenant_id: "tenant_tda",
      workspace_ids: ["ws_tda"],
      role: "owner"
    });
    const headers = {
      "content-type": "application/json",
      authorization: `Bearer ${session.token}`
    };

    const vrResp = await fetch(`http://127.0.0.1:${addr.port}/api/v1/kosmora/topology/vietoris-rips-betti`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        points: [
          { id: "v0", x: 0, y: 0 },
          { id: "v1", x: 1, y: 0 },
          { id: "v2", x: 1, y: 1 },
          { id: "v3", x: 0, y: 1 }
        ],
        epsilon: 1.1
      })
    });
    assert.equal(vrResp.status, 200);
    const vrJson = (await vrResp.json()) as any;
    assert.equal(vrJson.betti_1_holes, 1);

    const f480Res = await fetch(`http://127.0.0.1:${addr.port}/api/v1/kosmora/features/execute`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        feature_id: "F480",
        request_id: "req_http_f480",
        project_id: "proj_tda",
        workspace_id: "ws_tda"
      })
    });
    assert.equal(f480Res.status, 200);
    const f480Json = (await f480Res.json()) as any;
    assert.equal(f480Json.domainOutcome.stateChanged, true);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    cp.store.close(true);
  }
});

test("Scenario 18: Stage 16 Deterministic Stack-Bytecode VM, NSGA-II Pareto Fronts, AST Edit Script & Zlib NCD (F481–F512) + 512 Apex Catalog", async () => {
  assert.equal(KOSMORA_STAGE16_CATALOG.length, 32);
  assert.equal(KOSMORA_512_APEX_CATALOG.length, 512);

  const stage16Report = verifyStage16WasmEvolutionarySynthModules();
  assert.equal(stage16Report.totalModules, 32);
  assert.equal(stage16Report.verifiedCount, 32);
  assert.equal(stage16Report.allPassed, true);

  const engine = new KosmoraWasmEvolutionarySynthEngine();

  // 1. Static Stack-Bytecode Verifier & Gas-Metered Execution: (15 + 25) * 3 = 120
  const vmOk = engine.verifyAndExecuteStackBytecode({
    program: [
      { op: "PUSH", value: 15 },
      { op: "PUSH", value: 25 },
      { op: "ADD" },
      { op: "PUSH", value: 3 },
      { op: "MUL" },
      { op: "STORE", slot: 1 },
      { op: "LOAD", slot: 1 },
      { op: "HALT" }
    ],
    gas_limit: 100
  });
  assert.equal(vmOk.static_verification_passed, true);
  assert.equal(vmOk.halted_cleanly, true);
  assert.equal(vmOk.return_value, 120);
  assert.equal(vmOk.memory_slots[1], 120);

  // Stack underflow must be rejected statically before consuming any gas
  const vmUnderflow = engine.verifyAndExecuteStackBytecode({
    program: [{ op: "ADD" }, { op: "HALT" }],
    gas_limit: 100
  });
  assert.equal(vmUnderflow.static_verification_passed, false);
  assert.equal(vmUnderflow.gas_consumed, 0);

  // Out-of-gas protection must halt execution when gas_limit is exceeded
  const vmOog = engine.verifyAndExecuteStackBytecode({
    program: [
      { op: "PUSH", value: 10 },
      { op: "PUSH", value: 20 },
      { op: "MUL" },
      { op: "HALT" }
    ],
    gas_limit: 5
  });
  assert.equal(vmOog.static_verification_passed, true);
  assert.equal(vmOog.halted_cleanly, false);
  assert.ok(vmOog.failure_reason?.startsWith("OUT_OF_GAS"));

  // 2. NSGA-II Multi-Objective Pareto Front & Crowding Distance
  const nsga2 = engine.computeNsga2ParetoFronts({
    candidates: [
      { candidate_id: "c_ultra_fast", objectives_minimize: [5, 100] },
      { candidate_id: "c_balanced", objectives_minimize: [20, 30] },
      { candidate_id: "c_ultra_cheap", objectives_minimize: [80, 8] },
      { candidate_id: "c_suboptimal_1", objectives_minimize: [35, 45] },
      { candidate_id: "c_suboptimal_2", objectives_minimize: [90, 120] }
    ]
  });
  assert.equal(nsga2.pareto_front_f1_ids.length, 3);
  assert.ok(nsga2.pareto_front_f1_ids.includes("c_ultra_fast"));
  assert.ok(nsga2.pareto_front_f1_ids.includes("c_balanced"));
  assert.ok(nsga2.pareto_front_f1_ids.includes("c_ultra_cheap"));
  assert.equal(nsga2.fronts_count, 3);

  // 3. Wagner-Fischer AST Edit Distance & Reconstructible Patch Script
  const astDiff = engine.computeAstEditDistanceAndScript({
    source_ast_tokens: ["Module", "ImportDecl", "FuncBody", "CallExpr", "Return"],
    target_ast_tokens: ["Module", "ImportDecl", "AuthGuard", "FuncBody", "SafeCallExpr", "Return"]
  });
  assert.equal(astDiff.edit_distance, 2);
  assert.equal(astDiff.reconstructed_target_matches, true);

  // 4. Zlib Normalized Compression Distance (NCD): identical strings have much lower NCD than unrelated strings
  const textA = "export class KosmoraAutonomousDagEngine { public scheduleBatch() { return true; } } ".repeat(6);
  const textB = "SELECT tenant_id, sum(accrued_cost_usd) FROM billing_ledger GROUP BY tenant_id; ".repeat(6);
  const ncdSame = engine.computeNormalizedCompressionDistance({ payload_x: textA, payload_y: textA });
  const ncdDiff = engine.computeNormalizedCompressionDistance({ payload_x: textA, payload_y: textB });
  assert.ok(ncdSame.ncd_score < 0.15, `Expected identical NCD < 0.15, got ${ncdSame.ncd_score}`);
  assert.ok(ncdDiff.ncd_score > 0.65, `Expected unrelated NCD > 0.65, got ${ncdDiff.ncd_score}`);
  assert.equal(ncdDiff.metric_axioms_verified, true);

  // 5. Verify HTTP endpoints + 512 Apex Catalog Health
  const cp = createKosmoraControlPlane(":memory:");
  const server = createKosmoraHttpServer(cp);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const addr = server.address() as { port: number };
  try {
    const session = cp.security.issueSignedSessionToken({
      user_id: "usr_apex",
      tenant_id: "tenant_apex",
      workspace_ids: ["ws_apex"],
      role: "owner"
    });
    const headers = {
      "content-type": "application/json",
      authorization: `Bearer ${session.token}`
    };

    const vmResp = await fetch(`http://127.0.0.1:${addr.port}/api/v1/kosmora/synth/bytecode-verify-run`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        program: [
          { op: "PUSH", value: 64 },
          { op: "PUSH", value: 8 },
          { op: "MUL" },
          { op: "HALT" }
        ],
        gas_limit: 50
      })
    });
    assert.equal(vmResp.status, 200);
    const vmJson = (await vmResp.json()) as any;
    assert.equal(vmJson.return_value, 512);

    const f512Res = await fetch(`http://127.0.0.1:${addr.port}/api/v1/kosmora/features/execute`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        feature_id: "F512",
        request_id: "req_http_f512",
        project_id: "proj_apex",
        workspace_id: "ws_apex"
      })
    });
    assert.equal(f512Res.status, 200);
    const f512Json = (await f512Res.json()) as any;
    assert.equal(f512Json.domainOutcome.stateChanged, true);

    const healthResp = await fetch(`http://127.0.0.1:${addr.port}/api/v1/kosmora/health`);
    assert.equal(healthResp.status, 200);
    const healthJson = (await healthResp.json()) as any;
    assert.equal(healthJson.apex_features_count, 512);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    cp.store.close(true);
  }
});
