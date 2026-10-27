/**
 * Kosmora Unified Control Plane API Router & Live HTTP/SSE Server (Fastify / node:http Compatible)
 * Exposes all 8 architectural stages (F001-F256) with real RBAC/RLS verification,
 * signed Bearer token authentication (ksm_sess), token-based HITL approval,
 * optimistic concurrency Canvas revisions (HTTP 409 Conflict), real binary exports (.xlsx / .pdf),
 * project-isolated knowledge graph search, SQLite persistence, Ed25519 SLSA provenance attestation,
 * Stage 7 Formal Verification (Bounded Model Checker, CSP Solver, W3C Trace, Replay, Taint Analysis),
 * Stage 8 FinOps & Zero-Knowledge Compliance (UCB1 Bandit, OLS Burn-Rate, Differential Privacy, Merkle Proofs, RTBF),
 * and Server-Sent Events (SSE) real-time cluster telemetry streaming.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import {
  CanvasVersionConflictError,
  KOSMORA_160_CATALOG,
  KOSMORA_192_EXTENDED_CATALOG,
  KOSMORA_256_COMPLETE_CATALOG,
  KOSMORA_320_ULTIMATE_CATALOG,
  KOSMORA_384_SOVEREIGN_CATALOG,
  KOSMORA_448_OMEGA_CATALOG,
  KOSMORA_512_APEX_CATALOG,
  KosmoraAutonomyEngine,
  KosmoraCanvasEngine,
  KosmoraEnterpriseSecurityEngine,
  KosmoraFinOpsComplianceEngine,
  KosmoraFormalVerificationEngine,
  KosmoraCausalBayesianEngine,
  KosmoraGameTheoryEngine,
  KosmoraHomomorphicVdfEngine,
  KosmoraQuantumZkEngine,
  KosmoraIntelligenceGraph,
  KosmoraRuntimeStore,
  KosmoraSkillsBus,
  KosmoraSovereignClusterEngine,
  Stage1AutonomyKernel,
  Stage2CanvasKernel,
  Stage4GraphKernel,
  Stage6SovereignKernel,
  Stage7FormalKernel,
  Stage8FinOpsKernel,
  Stage9QuantumZkKernel,
  Stage10GameTheoryKernel,
  Stage11CausalBayesianKernel,
  Stage12HomomorphicVdfKernel,
  Stage13NeurosymbolicSatKernel,
  Stage14CyberneticControlKernel,
  Stage15TopologicalPersistenceKernel,
  Stage16WasmEvolutionarySynthKernel,
  KosmoraTopologicalPersistenceEngine,
  KosmoraWasmEvolutionarySynthEngine,
  KosmoraNeurosymbolicSatEngine,
  KosmoraCyberneticControlEngine,
  KosmoraMissionControlService,
  MissionAccessDeniedError,
  MissionBudgetExceededError,
  MissionDependencyCycleError,
  MissionNotFoundError,
  MissionRoleToolViolationError,
  MissionValidationError,
  MissionVersionConflictError,
  KosmoraSchedulesService,
  ScheduleAccessDeniedError,
  ScheduleConcurrencyConflictError,
  ScheduleNotFoundError,
  ScheduleValidationError,
  ScheduleWebhookSignatureError,
  validateCronExpression,
  type ScheduleStatus,
  type ScheduleTriggerType,
  type ScheduleVariableMapping,
  KosmoraEvaluationsService,
  KosmoraKnowledgeVaultService,
  KosmoraKnowledgeVaultError,
  type KnowledgeChunkingStrategy,
  type KnowledgeCollectionVisibility,
  type KnowledgeDocumentSourceType,
  type KnowledgeDocumentStatus,
  EvaluationAccessDeniedError,
  EvaluationConcurrencyConflictError,
  EvaluationRunNotFoundError,
  EvaluationSuiteNotFoundError,
  EvaluationValidationError,
  QualityGateBlockedError,
  type EvaluationCriterion,
  type EvaluationGoldenTestCase,
  type EvaluationRunVerdict,
  type EvaluationSuiteStatus,
  type EvaluationSuiteVisibility,
  type EvaluationTargetKind,
  KosmoraPlaybooksService,
  PlaybookAccessDeniedError,
  PlaybookBudgetExceededError,
  PlaybookChecksumMismatchError,
  PlaybookConditionSyntaxError,
  PlaybookDependencyCycleError,
  PlaybookImmutableVersionError,
  PlaybookNotFoundError,
  PlaybookValidationError,
  PlaybookVariableValidationError,
  PlaybookVersionConflictError,
  type PlaybookDefinition,
  type PlaybookStatus,
  type PlaybookVisibility,
  type MissionAgentRole,
  type MissionPriority,
  type MissionReviewDecision,
  type MissionStatus,
  type MissionTaskExecutionMode,
  type MissionTaskStatus,
  type CanvasArtifactKind,
  type CanvasArtifactRevision,
  type CanvasBlock,
  type Ed25519AttestationEnvelope,
  type HitlApprovalRequest,
  type HostNodeCapacity,
  type KosmoraDagPlan,
  type ResourceTaskSpec,
  type StateMachineSpec,
  type TenantPrincipal
} from "@cosmora/core";

export interface KosmoraControlPlaneContext {
  autonomy: KosmoraAutonomyEngine;
  canvas: KosmoraCanvasEngine;
  skills: KosmoraSkillsBus;
  graph: KosmoraIntelligenceGraph;
  security: KosmoraEnterpriseSecurityEngine;
  store: KosmoraRuntimeStore;
  sovereign: KosmoraSovereignClusterEngine;
  formal: KosmoraFormalVerificationEngine;
  finops: KosmoraFinOpsComplianceEngine;
  quantumZk: KosmoraQuantumZkEngine;
  gameTheory: KosmoraGameTheoryEngine;
  causalBayesian: KosmoraCausalBayesianEngine;
  homomorphicVdf: KosmoraHomomorphicVdfEngine;
  neurosymbolicSat: KosmoraNeurosymbolicSatEngine;
  cyberneticControl: KosmoraCyberneticControlEngine;
  topologicalPersistence: KosmoraTopologicalPersistenceEngine;
  wasmEvolutionarySynth: KosmoraWasmEvolutionarySynthEngine;
  missionControl: KosmoraMissionControlService;
  playbooks: KosmoraPlaybooksService;
  schedules: KosmoraSchedulesService;
  evaluations: KosmoraEvaluationsService;
  knowledgeVault: KosmoraKnowledgeVaultService;
  stageKernels: {
    stage1: Stage1AutonomyKernel;
    stage2: Stage2CanvasKernel;
    stage4: Stage4GraphKernel;
    stage6: Stage6SovereignKernel;
    stage7: Stage7FormalKernel;
    stage8: Stage8FinOpsKernel;
    stage9: Stage9QuantumZkKernel;
    stage10: Stage10GameTheoryKernel;
    stage11: Stage11CausalBayesianKernel;
    stage12: Stage12HomomorphicVdfKernel;
    stage13: Stage13NeurosymbolicSatKernel;
    stage14: Stage14CyberneticControlKernel;
    stage15: Stage15TopologicalPersistenceKernel;
    stage16: Stage16WasmEvolutionarySynthKernel;
  };
}

export function createKosmoraControlPlane(
  dbPath = ":memory:"
): KosmoraControlPlaneContext {
  const sovereign = new KosmoraSovereignClusterEngine();
  const formal = new KosmoraFormalVerificationEngine();
  const finops = new KosmoraFinOpsComplianceEngine();
  const quantumZk = new KosmoraQuantumZkEngine();
  const gameTheory = new KosmoraGameTheoryEngine();
  const causalBayesian = new KosmoraCausalBayesianEngine();
  const homomorphicVdf = new KosmoraHomomorphicVdfEngine();
  const neurosymbolicSat = new KosmoraNeurosymbolicSatEngine();
  const cyberneticControl = new KosmoraCyberneticControlEngine();
  const topologicalPersistence = new KosmoraTopologicalPersistenceEngine();
  const wasmEvolutionarySynth = new KosmoraWasmEvolutionarySynthEngine();
  const security = new KosmoraEnterpriseSecurityEngine();
  const store = new KosmoraRuntimeStore(dbPath);
  const missionControl = new KosmoraMissionControlService(store, security);
  const playbooks = new KosmoraPlaybooksService(store, security, missionControl);
  const schedules = new KosmoraSchedulesService(store, security, missionControl, playbooks);
  const evaluations = new KosmoraEvaluationsService(store, security, missionControl, playbooks);
  const knowledgeVault = new KosmoraKnowledgeVaultService({ store, security, missionControl });
  return {
    autonomy: new KosmoraAutonomyEngine(),
    canvas: new KosmoraCanvasEngine(),
    skills: new KosmoraSkillsBus(),
    graph: new KosmoraIntelligenceGraph(),
    security,
    store,
    sovereign,
    formal,
    finops,
    quantumZk,
    gameTheory,
    causalBayesian,
    homomorphicVdf,
    neurosymbolicSat,
    cyberneticControl,
    topologicalPersistence,
    wasmEvolutionarySynth,
    missionControl,
    playbooks,
    schedules,
    evaluations,
    knowledgeVault,
    stageKernels: {
      stage1: new Stage1AutonomyKernel(),
      stage2: new Stage2CanvasKernel(),
      stage4: new Stage4GraphKernel(),
      stage6: new Stage6SovereignKernel(sovereign),
      stage7: new Stage7FormalKernel(formal),
      stage8: new Stage8FinOpsKernel(finops),
      stage9: new Stage9QuantumZkKernel(quantumZk),
      stage10: new Stage10GameTheoryKernel(gameTheory),
      stage11: new Stage11CausalBayesianKernel(causalBayesian),
      stage12: new Stage12HomomorphicVdfKernel(homomorphicVdf),
      stage13: new Stage13NeurosymbolicSatKernel(neurosymbolicSat),
      stage14: new Stage14CyberneticControlKernel(cyberneticControl),
      stage15: new Stage15TopologicalPersistenceKernel(topologicalPersistence),
      stage16: new Stage16WasmEvolutionarySynthKernel(wasmEvolutionarySynth)
    }
  };
}

export class KosmoraApiController {
  constructor(private readonly ctx: KosmoraControlPlaneContext) {}

  /**
   * POST /api/v1/kosmora/dag/compile-and-step
   */
  public handleDagCompileAndStep(params: {
    principal: TenantPrincipal;
    workspace_id: string;
    project_id: string;
    goal: string;
    max_parallelism: number;
    budget_limit_usd: number;
    tasks: Array<{
      node_id: string;
      title: string;
      agent_role:
        | "planner"
        | "researcher"
        | "coder"
        | "analyst"
        | "critic"
        | "verifier"
        | "synthesizer";
      dependencies: string[];
      estimated_tokens: number;
      estimated_cost_usd: number;
      requires_hitl?: boolean;
      hitl_action_scope?: string;
    }>;
  }): {
    plan: KosmoraDagPlan;
    ready_batch: string[];
    budget_status: ReturnType<KosmoraAutonomyEngine["evaluateBudgetGuard"]>;
  } {
    const auth = this.ctx.security.authorizeAction(
      params.principal,
      params.principal.tenant_id,
      params.workspace_id,
      "dag:execute"
    );
    if (!auth.allowed) {
      throw new Error(auth.reason);
    }

    const plan = this.ctx.autonomy.compilePlan({
      plan_id: `plan_${params.project_id}_${Date.now()}`,
      tenant_id: params.principal.tenant_id,
      workspace_id: params.workspace_id,
      project_id: params.project_id,
      goal: params.goal,
      max_parallelism: params.max_parallelism,
      budget_limit_usd: params.budget_limit_usd,
      tasks: params.tasks
    });

    const schedule = this.ctx.autonomy.scheduleNextBatch(plan);
    const budgetStatus = this.ctx.autonomy.evaluateBudgetGuard(plan);

    this.ctx.store.saveDagPlan({
      plan_id: plan.plan_id,
      project_id: plan.project_id,
      tenant_id: plan.tenant_id,
      workspace_id: plan.workspace_id,
      goal: plan.goal,
      state_json: JSON.stringify(plan),
      status:
        schedule.awaiting_hitl_nodes.length > 0 ? "awaiting_hitl" : "running",
      updated_at: new Date().toISOString()
    });

    this.ctx.security.appendAuditEntry({
      tenant_id: params.principal.tenant_id,
      actor_id: params.principal.user_id,
      action: "dag.compile_and_step",
      resource_id: plan.plan_id,
      metadata: {
        project_id: params.project_id,
        ready_count: schedule.ready_batch.length
      }
    });

    return {
      plan,
      ready_batch: schedule.ready_batch.map((n) => n.node_id),
      budget_status: budgetStatus
    };
  }

  /**
   * POST /api/v1/kosmora/dag/hitl/request
   */
  public handleRequestHitlApproval(params: {
    principal: TenantPrincipal;
    workspace_id: string;
    plan: KosmoraDagPlan;
    node_id: string;
    action_scope?: string;
  }): HitlApprovalRequest {
    const auth = this.ctx.security.authorizeAction(
      params.principal,
      params.principal.tenant_id,
      params.workspace_id,
      "dag:execute"
    );
    if (!auth.allowed) {
      throw new Error(auth.reason);
    }
    return this.ctx.autonomy.requestHitlApproval(
      params.plan,
      params.node_id,
      params.action_scope
    );
  }

  /**
   * POST /api/v1/kosmora/dag/hitl/approve
   */
  public handleApproveHitlNode(params: {
    principal: TenantPrincipal;
    workspace_id: string;
    plan: KosmoraDagPlan;
    node_id: string;
    approval_token: string;
    reason?: string;
  }): HitlApprovalRequest {
    const auth = this.ctx.security.authorizeAction(
      params.principal,
      params.principal.tenant_id,
      params.workspace_id,
      "dag:approve_hitl"
    );
    if (!auth.allowed) {
      throw new Error(auth.reason);
    }
    const approved = this.ctx.autonomy.approveHitlNode({
      plan: params.plan,
      node_id: params.node_id,
      approval_token: params.approval_token,
      approver_id: params.principal.user_id,
      reason: params.reason
    });

    this.ctx.store.saveDagPlan({
      plan_id: params.plan.plan_id,
      project_id: params.plan.project_id,
      tenant_id: params.plan.tenant_id,
      workspace_id: params.plan.workspace_id,
      goal: params.plan.goal,
      state_json: JSON.stringify(params.plan),
      status: "running",
      updated_at: new Date().toISOString()
    });

    return approved;
  }

  /**
   * POST /api/v1/kosmora/canvas/commit-and-export
   */
  public handleCanvasCommitAndExport(params: {
    principal: TenantPrincipal;
    workspace_id: string;
    project_id?: string;
    artifact_id: string;
    kind: CanvasArtifactKind;
    title: string;
    blocks: CanvasBlock[];
    commit_message: string;
    expected_version?: number;
    export_format?: "xlsx" | "pdf" | "md";
  }): {
    revision: CanvasArtifactRevision;
    markdown_export: string;
    binary_export?: {
      filename: string;
      mime_type: string;
      buffer: Buffer;
      byte_length: number;
    };
  } {
    const auth = this.ctx.security.authorizeAction(
      params.principal,
      params.principal.tenant_id,
      params.workspace_id,
      "workspace:write"
    );
    if (!auth.allowed) {
      throw new Error(auth.reason);
    }

    const revision = this.ctx.canvas.commitRevision({
      artifact_id: params.artifact_id,
      kind: params.kind,
      title: params.title,
      author_id: params.principal.user_id,
      commit_message: params.commit_message,
      blocks: params.blocks,
      expected_version: params.expected_version
    });

    this.ctx.store.saveArtifactRevision({
      revision_id: revision.revision_id,
      artifact_id: revision.artifact_id,
      project_id: params.project_id ?? "proj_default",
      tenant_id: params.principal.tenant_id,
      version: revision.version,
      title: revision.title,
      kind: revision.kind,
      content_json: JSON.stringify(revision.blocks),
      content_sha256: revision.content_sha256,
      author_id: revision.author_id,
      created_at: revision.created_at
    });

    const markdownExport = this.ctx.canvas.exportToMarkdown(
      params.artifact_id,
      revision.version
    );

    let binaryExport:
      | {
          filename: string;
          mime_type: string;
          buffer: Buffer;
          byte_length: number;
        }
      | undefined;

    if (params.export_format === "xlsx") {
      const sheetPayload = this.ctx.canvas.exportFinancialSheetModel({
        sheet_name: params.title.slice(0, 31) || "Sheet1",
        columns: ["Block_ID", "Heading", "Content_Length", "Version"],
        rows: revision.blocks.map((b, idx) => ({
          Block_ID: b.block_id,
          Heading: b.heading ?? `Block ${idx + 1}`,
          Content_Length: b.content.length,
          Version: revision.version
        })),
        formulas: [
          {
            cell: `C${revision.blocks.length + 2}`,
            expression: `=SUM(C2:C${Math.max(2, revision.blocks.length + 1)})`
          }
        ]
      });
      binaryExport = {
        filename: `${params.artifact_id}-v${revision.version}.xlsx`,
        mime_type:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        buffer: sheetPayload.xlsx_buffer,
        byte_length: sheetPayload.xlsx_byte_length
      };
    } else if (params.export_format === "pdf") {
      const pdfBuffer = this.ctx.canvas.exportCorporatePdfBuffer(
        params.artifact_id,
        revision.version
      );
      binaryExport = {
        filename: `${params.artifact_id}-v${revision.version}.pdf`,
        mime_type: "application/pdf",
        buffer: pdfBuffer,
        byte_length: pdfBuffer.length
      };
    }

    return {
      revision,
      markdown_export: markdownExport,
      binary_export: binaryExport
    };
  }

  /**
   * POST /api/v1/kosmora/memory/hybrid-search
   */
  public handleHybridMemorySearch(params: {
    principal: TenantPrincipal;
    workspace_id: string;
    project_id: string;
    query: string;
    top_k?: number;
  }) {
    const auth = this.ctx.security.authorizeAction(
      params.principal,
      params.principal.tenant_id,
      params.workspace_id,
      "workspace:read"
    );
    if (!auth.allowed) {
      throw new Error(auth.reason);
    }

    return this.ctx.graph.searchProjectMemory(
      params.project_id,
      params.query,
      params.top_k ?? 5,
      { workspace_id: params.workspace_id }
    );
  }

  /**
   * POST /api/v1/kosmora/snapshots/create
   */
  public handleCreateSnapshot(params: {
    principal: TenantPrincipal;
    workspace_id: string;
    project_id: string;
  }) {
    const auth = this.ctx.security.authorizeAction(
      params.principal,
      params.principal.tenant_id,
      params.workspace_id,
      "workspace:write"
    );
    if (!auth.allowed) {
      throw new Error(auth.reason);
    }
    return this.ctx.store.createProjectSnapshot(
      params.project_id,
      params.principal.tenant_id
    );
  }

  /**
   * POST /api/v1/kosmora/snapshots/restore
   */
  public handleRestoreSnapshot(params: {
    principal: TenantPrincipal;
    workspace_id: string;
    snapshot_id: string;
  }) {
    const auth = this.ctx.security.authorizeAction(
      params.principal,
      params.principal.tenant_id,
      params.workspace_id,
      "workspace:write"
    );
    if (!auth.allowed) {
      throw new Error(auth.reason);
    }
    return this.ctx.store.restoreProjectSnapshot(params.snapshot_id);
  }

  /**
   * POST /api/v1/kosmora/attestation/sign
   */
  public handleSignArtifactAttestation(params: {
    principal: TenantPrincipal;
    workspace_id: string;
    project_id: string;
    artifact_id: string;
    artifact_content: string;
    source_dag_run_id?: string;
  }): Ed25519AttestationEnvelope {
    const auth = this.ctx.security.authorizeAction(
      params.principal,
      params.principal.tenant_id,
      params.workspace_id,
      "workspace:write"
    );
    if (!auth.allowed) {
      throw new Error(auth.reason);
    }
    return this.ctx.sovereign.signArtifactAttestationEnvelope({
      artifact_id: params.artifact_id,
      artifact_bytes: Buffer.from(params.artifact_content, "utf8"),
      builder_id: "kosmora-api-attestation-service",
      source_plan_id: params.source_dag_run_id ?? `dag_${Date.now()}`
    });
  }

  /**
   * POST /api/v1/kosmora/attestation/verify
   */
  public handleVerifyArtifactAttestation(params: {
    principal: TenantPrincipal;
    workspace_id: string;
    envelope: Ed25519AttestationEnvelope;
    artifact_content: string;
  }): { valid: boolean; reason: string } {
    const auth = this.ctx.security.authorizeAction(
      params.principal,
      params.principal.tenant_id,
      params.workspace_id,
      "workspace:read"
    );
    if (!auth.allowed) {
      throw new Error(auth.reason);
    }
    return this.ctx.sovereign.verifyArtifactAttestationEnvelope(
      params.envelope,
      Buffer.from(params.artifact_content, "utf8")
    );
  }

  /**
   * POST /api/v1/kosmora/formal/verify-model (Stage 7: F193-F198)
   */
  public handleVerifyStateMachineModel(params: {
    principal: TenantPrincipal;
    workspace_id: string;
    spec: Parameters<KosmoraFormalVerificationEngine["verifyStateMachineInvariants"]>[0];
  }) {
    const auth = this.ctx.security.authorizeAction(
      params.principal,
      params.principal.tenant_id,
      params.workspace_id,
      "workspace:read"
    );
    if (!auth.allowed) {
      throw new Error(auth.reason);
    }
    return this.ctx.formal.verifyStateMachineInvariants(params.spec);
  }

  /**
   * POST /api/v1/kosmora/formal/solve-csp (Stage 7: F199-F204)
   */
  public handleSolveResourceCsp(params: {
    principal: TenantPrincipal;
    workspace_id: string;
    tasks: Parameters<KosmoraFormalVerificationEngine["solveResourceAllocationConstraints"]>[0];
    hosts: Parameters<KosmoraFormalVerificationEngine["solveResourceAllocationConstraints"]>[1];
  }) {
    const auth = this.ctx.security.authorizeAction(
      params.principal,
      params.principal.tenant_id,
      params.workspace_id,
      "dag:execute"
    );
    if (!auth.allowed) {
      throw new Error(auth.reason);
    }
    return this.ctx.formal.solveResourceAllocationConstraints(params.tasks, params.hosts);
  }

  /**
   * POST /api/v1/kosmora/finops/bandit-route (Stage 8: F225-F230)
   */
  public handleSelectBanditRoute(params: {
    principal: TenantPrincipal;
    workspace_id: string;
    max_latency_slo_ms?: number;
    cost_weight?: number;
  }) {
    const auth = this.ctx.security.authorizeAction(
      params.principal,
      params.principal.tenant_id,
      params.workspace_id,
      "dag:execute"
    );
    if (!auth.allowed) {
      throw new Error(auth.reason);
    }
    return this.ctx.finops.selectOptimalProviderBandit({
      max_latency_slo_ms: params.max_latency_slo_ms,
      cost_weight: params.cost_weight
    });
  }

  /**
   * POST /api/v1/kosmora/finops/forecast (Stage 8: F231-F236)
   */
  public handleForecastFinOpsBurnRate(params: {
    principal: TenantPrincipal;
    workspace_id: string;
    budget_cap_usd: number;
    hourly_spend_series: Array<{ hour_index: number; spend_usd: number }>;
  }) {
    const auth = this.ctx.security.authorizeAction(
      params.principal,
      params.principal.tenant_id,
      params.workspace_id,
      "workspace:read"
    );
    if (!auth.allowed) {
      throw new Error(auth.reason);
    }
    return this.ctx.finops.forecastTenantFinOpsBurnRate({
      tenant_id: params.principal.tenant_id,
      budget_cap_usd: params.budget_cap_usd,
      hourly_spend_series: params.hourly_spend_series
    });
  }

  /**
   * POST /api/v1/kosmora/compliance/merkle-proof (Stage 8: F243-F248)
   */
  public handleGenerateMerkleComplianceProof(params: {
    principal: TenantPrincipal;
    workspace_id: string;
    claims: Parameters<KosmoraFinOpsComplianceEngine["generateSelectiveDisclosureProof"]>[0];
    target_claim_id: string;
  }) {
    const auth = this.ctx.security.authorizeAction(
      params.principal,
      params.principal.tenant_id,
      params.workspace_id,
      "workspace:write"
    );
    if (!auth.allowed) {
      throw new Error(auth.reason);
    }
    const proof = this.ctx.finops.generateSelectiveDisclosureProof(
      params.claims,
      params.target_claim_id
    );
    const verified = this.ctx.finops.verifySelectiveDisclosureProof(proof);
    return { proof, verified };
  }

  /**
   * POST /api/v1/kosmora/compliance/rtbf-erase (Stage 8: F249-F254)
   */
  public handleRightToBeForgottenErase(params: {
    principal: TenantPrincipal;
    workspace_id: string;
    subject_id: string;
  }) {
    const auth = this.ctx.security.authorizeAction(
      params.principal,
      params.principal.tenant_id,
      params.workspace_id,
      "workspace:write"
    );
    if (!auth.allowed) {
      throw new Error(auth.reason);
    }
    return this.ctx.finops.executeRightToBeForgottenCascade({
      tenant_id: params.principal.tenant_id,
      subject_id: params.subject_id
    });
  }

  /**
   * POST /api/v1/kosmora/quantum/shamir-split-recover (Stage 9: F263-F268)
   */
  public handleShamirSplitAndRecover(params: {
    principal: TenantPrincipal;
    workspace_id: string;
    secret_utf8: string;
    total_shares_n: number;
    threshold_k: number;
  }) {
    const auth = this.ctx.security.authorizeAction(
      params.principal,
      params.principal.tenant_id,
      params.workspace_id,
      "workspace:write"
    );
    if (!auth.allowed) {
      throw new Error(auth.reason);
    }
    const shares = this.ctx.quantumZk.splitSecretShamirThreshold({
      secret_utf8: params.secret_utf8,
      total_shares_n: params.total_shares_n,
      threshold_k: params.threshold_k
    });
    const recovered = this.ctx.quantumZk.reconstructSecretShamirLagrange(
      shares.slice(0, params.threshold_k),
      params.threshold_k
    );
    return {
      shares_count: shares.length,
      threshold_k: params.threshold_k,
      shares,
      recovered_exact_match: recovered === params.secret_utf8
    };
  }

  /**
   * POST /api/v1/kosmora/quantum/zk-prove-verify (Stage 9: F269-F274)
   */
  public handleZkProveAndVerify(params: {
    principal: TenantPrincipal;
    workspace_id: string;
    statement_id: string;
    secret_witness_scalar: number;
    nonce_seed?: string;
  }) {
    const auth = this.ctx.security.authorizeAction(
      params.principal,
      params.principal.tenant_id,
      params.workspace_id,
      "workspace:write"
    );
    if (!auth.allowed) {
      throw new Error(auth.reason);
    }
    const proof = this.ctx.quantumZk.generateFiatShamirZeroKnowledgeProof({
      statement_id: params.statement_id,
      secret_witness_scalar: params.secret_witness_scalar,
      nonce_seed: params.nonce_seed ?? params.principal.tenant_id
    });
    const verified = this.ctx.quantumZk.verifyFiatShamirZeroKnowledgeProof(proof);
    return { proof, verified };
  }

  /**
   * POST /api/v1/kosmora/quantum/pqc-sign-verify (Stage 9: F275-F280)
   */
  public handlePqcSignAndVerify(params: {
    principal: TenantPrincipal;
    workspace_id: string;
    key_id: string;
    private_seed: string;
    message: string;
  }) {
    const auth = this.ctx.security.authorizeAction(
      params.principal,
      params.principal.tenant_id,
      params.workspace_id,
      "workspace:write"
    );
    if (!auth.allowed) {
      throw new Error(auth.reason);
    }
    const signature = this.ctx.quantumZk.signPostQuantumLamportMessage({
      key_id: params.key_id,
      private_seed: params.private_seed,
      message: params.message
    });
    const verified = this.ctx.quantumZk.verifyPostQuantumLamportSignature(
      signature,
      params.message
    );
    return { signature, verified };
  }

  /**
   * POST /api/v1/kosmora/gametheory/shapley-allocate (Stage 10: F289-F296)
   */
  public handleShapleyAttribution(params: {
    principal: TenantPrincipal;
    workspace_id: string;
    players: string[];
    coalition_values: Record<string, number>;
  }) {
    const auth = this.ctx.security.authorizeAction(
      params.principal,
      params.principal.tenant_id,
      params.workspace_id,
      "workspace:write"
    );
    if (!auth.allowed) {
      throw new Error(auth.reason);
    }
    return this.ctx.gameTheory.computeExactShapleyAttribution({
      players: params.players,
      coalition_values: params.coalition_values
    });
  }

  /**
   * POST /api/v1/kosmora/gametheory/vcg-auction (Stage 10: F297-F304)
   */
  public handleVcgTaskAuction(params: {
    principal: TenantPrincipal;
    workspace_id: string;
    tasks: string[];
    bids: Parameters<KosmoraGameTheoryEngine["runVcgCombinatorialTaskAuction"]>[0]["bids"];
  }) {
    const auth = this.ctx.security.authorizeAction(
      params.principal,
      params.principal.tenant_id,
      params.workspace_id,
      "workspace:write"
    );
    if (!auth.allowed) {
      throw new Error(auth.reason);
    }
    return this.ctx.gameTheory.runVcgCombinatorialTaskAuction({
      tasks: params.tasks,
      bids: params.bids
    });
  }

  /**
   * POST /api/v1/kosmora/gametheory/schulze-consensus (Stage 10: F305-F312)
   */
  public handleSchulzeConsensus(params: {
    principal: TenantPrincipal;
    workspace_id: string;
    candidates: string[];
    ranked_ballots: string[][];
  }) {
    const auth = this.ctx.security.authorizeAction(
      params.principal,
      params.principal.tenant_id,
      params.workspace_id,
      "workspace:write"
    );
    if (!auth.allowed) {
      throw new Error(auth.reason);
    }
    return this.ctx.gameTheory.aggregateSchulzeCondorcetConsensus({
      candidates: params.candidates,
      ranked_ballots: params.ranked_ballots
    });
  }

  /**
   * POST /api/v1/kosmora/gametheory/stable-matching (Stage 10: F313-F320)
   */
  public handleGaleShapleyMatching(params: {
    principal: TenantPrincipal;
    workspace_id: string;
    agent_preferences: Record<string, string[]>;
    task_preferences: Record<string, string[]>;
  }) {
    const auth = this.ctx.security.authorizeAction(
      params.principal,
      params.principal.tenant_id,
      params.workspace_id,
      "workspace:write"
    );
    if (!auth.allowed) {
      throw new Error(auth.reason);
    }
    return this.ctx.gameTheory.solveGaleShapleyStableMatching({
      agent_preferences: params.agent_preferences,
      task_preferences: params.task_preferences
    });
  }

  /**
   * POST /api/v1/kosmora/causal/do-intervention (Stage 11: F321-F328)
   */
  public handleCausalDoIntervention(params: {
    principal: TenantPrincipal;
    workspace_id: string;
    model: Parameters<KosmoraCausalBayesianEngine["evaluateStructuralCausalIntervention"]>[0]["model"];
    treatment_var: string;
    outcome_var: string;
    do_value: number;
    baseline_value?: number;
  }) {
    const auth = this.ctx.security.authorizeAction(
      params.principal,
      params.principal.tenant_id,
      params.workspace_id,
      "workspace:write"
    );
    if (!auth.allowed) throw new Error(auth.reason);
    return this.ctx.causalBayesian.evaluateStructuralCausalIntervention({
      model: params.model,
      treatment_var: params.treatment_var,
      outcome_var: params.outcome_var,
      do_value: params.do_value,
      baseline_value: params.baseline_value
    });
  }

  /**
   * POST /api/v1/kosmora/causal/counterfactual (Stage 11: F329-F336)
   */
  public handleCounterfactualTrajectory(params: {
    principal: TenantPrincipal;
    workspace_id: string;
    model: Parameters<KosmoraCausalBayesianEngine["computeCounterfactualTrajectory"]>[0]["model"];
    observed_evidence: Record<string, number>;
    intervention_var: string;
    intervention_value: number;
    outcome_var: string;
  }) {
    const auth = this.ctx.security.authorizeAction(
      params.principal,
      params.principal.tenant_id,
      params.workspace_id,
      "workspace:write"
    );
    if (!auth.allowed) throw new Error(auth.reason);
    return this.ctx.causalBayesian.computeCounterfactualTrajectory({
      model: params.model,
      observed_evidence: params.observed_evidence,
      intervention_var: params.intervention_var,
      intervention_value: params.intervention_value,
      outcome_var: params.outcome_var
    });
  }

  /**
   * POST /api/v1/kosmora/causal/bayesian-posterior (Stage 11: F337-F344)
   */
  public handleBayesianPosteriorUpdate(params: {
    principal: TenantPrincipal;
    workspace_id: string;
    hypotheses: Parameters<KosmoraCausalBayesianEngine["updateBayesianBeliefNetwork"]>[0]["hypotheses"];
    observed_evidence: Record<string, boolean>;
  }) {
    const auth = this.ctx.security.authorizeAction(
      params.principal,
      params.principal.tenant_id,
      params.workspace_id,
      "workspace:write"
    );
    if (!auth.allowed) throw new Error(auth.reason);
    return this.ctx.causalBayesian.updateBayesianBeliefNetwork({
      hypotheses: params.hypotheses,
      observed_evidence: params.observed_evidence
    });
  }

  /**
   * POST /api/v1/kosmora/causal/thompson-sample (Stage 11: F345-F352)
   */
  public handleThompsonSampling(params: {
    principal: TenantPrincipal;
    workspace_id: string;
    arms: Parameters<KosmoraCausalBayesianEngine["sampleThompsonBetaPosterior"]>[0]["arms"];
    deterministic_seed: string;
  }) {
    const auth = this.ctx.security.authorizeAction(
      params.principal,
      params.principal.tenant_id,
      params.workspace_id,
      "workspace:write"
    );
    if (!auth.allowed) throw new Error(auth.reason);
    return this.ctx.causalBayesian.sampleThompsonBetaPosterior({
      arms: params.arms,
      deterministic_seed: params.deterministic_seed
    });
  }

  /**
   * POST /api/v1/kosmora/crypto/paillier-homomorphic-add (Stage 12: F353-F360)
   */
  public handlePaillierHomomorphicAdd(params: {
    principal: TenantPrincipal;
    workspace_id: string;
    values: number[];
  }) {
    const auth = this.ctx.security.authorizeAction(
      params.principal,
      params.principal.tenant_id,
      params.workspace_id,
      "workspace:write"
    );
    if (!auth.allowed) throw new Error(auth.reason);
    if (params.values.length === 0) {
      throw new Error("At least one integer value is required for Paillier homomorphic encryption.");
    }
    const ciphertexts = params.values.map((v, idx) =>
      this.ctx.homomorphicVdf.encryptPaillierHomomorphic(v, `seed_${idx}`)
    );
    let combined = ciphertexts[0]!;
    for (let i = 1; i < ciphertexts.length; i++) {
      combined = this.ctx.homomorphicVdf.addHomomorphicCiphertexts(combined, ciphertexts[i]!);
    }
    const decryptedSum = this.ctx.homomorphicVdf.decryptPaillierHomomorphic(combined);
    const expectedSum = params.values.reduce((a, b) => a + b, 0);
    return {
      ciphertexts_count: ciphertexts.length,
      combined_ciphertext: combined,
      decrypted_sum: decryptedSum,
      homomorphic_verified: decryptedSum === expectedSum
    };
  }

  /**
   * POST /api/v1/kosmora/crypto/vdf-evaluate-verify (Stage 12: F361-F368)
   */
  public handleVdfEvaluateAndVerify(params: {
    principal: TenantPrincipal;
    workspace_id: string;
    challenge_id: string;
    seed_input: string;
    iterations_t: number;
  }) {
    const auth = this.ctx.security.authorizeAction(
      params.principal,
      params.principal.tenant_id,
      params.workspace_id,
      "workspace:write"
    );
    if (!auth.allowed) throw new Error(auth.reason);
    const proof = this.ctx.homomorphicVdf.evaluateVerifiableDelayFunction({
      challenge_id: params.challenge_id,
      seed_input: params.seed_input,
      iterations_t: params.iterations_t
    });
    const verified = this.ctx.homomorphicVdf.verifyVerifiableDelayProof(proof);
    return { proof, verified };
  }

  /**
   * POST /api/v1/kosmora/crypto/macaroon-mint-verify (Stage 12: F369-F376)
   */
  public handleMacaroonMintAndVerify(params: {
    principal: TenantPrincipal;
    workspace_id: string;
    identifier: string;
    caveats: string[];
    context: Record<string, string | number>;
  }) {
    const auth = this.ctx.security.authorizeAction(
      params.principal,
      params.principal.tenant_id,
      params.workspace_id,
      "workspace:write"
    );
    if (!auth.allowed) throw new Error(auth.reason);
    const rootSecret = `root_mac_${params.principal.tenant_id}`;
    const base = this.ctx.homomorphicVdf.mintCapabilityMacaroon({
      root_secret: rootSecret,
      identifier: params.identifier,
      location: "kosmora://control-plane",
      initial_caveats: [`tenant_id = ${params.principal.tenant_id}`]
    });
    const attenuated = this.ctx.homomorphicVdf.attenuateMacaroonWithCaveats(base, params.caveats);
    const verification = this.ctx.homomorphicVdf.verifyMacaroonAuthorization({
      root_secret: rootSecret,
      macaroon: attenuated,
      context: { ...params.context, tenant_id: params.principal.tenant_id }
    });
    return { macaroon: attenuated, verification };
  }

  /**
   * POST /api/v1/kosmora/crypto/byzantine-quorum (Stage 12: F377-F384)
   */
  public handleByzantineQuorumVerify(params: {
    principal: TenantPrincipal;
    workspace_id: string;
    validators: string[];
    quorum_a: string[];
    quorum_b: string[];
    votes: Parameters<KosmoraHomomorphicVdfEngine["verifyByzantineQuorumIntersection"]>[0]["votes"];
  }) {
    const auth = this.ctx.security.authorizeAction(
      params.principal,
      params.principal.tenant_id,
      params.workspace_id,
      "workspace:write"
    );
    if (!auth.allowed) throw new Error(auth.reason);
    return this.ctx.homomorphicVdf.verifyByzantineQuorumIntersection({
      validators: params.validators,
      quorum_a: params.quorum_a,
      quorum_b: params.quorum_b,
      votes: params.votes
    });
  }

  /**
   * POST /api/v1/kosmora/features/execute
   * Unified runtime dispatcher executing any F001-F256 feature by ID with RBAC/RLS verification.
   */
  public handleExecuteFeatureById(params: {
    principal: TenantPrincipal;
    feature_id: string;
    request_id: string;
    project_id: string;
    workspace_id: string;
    autonomy_level?: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
    domain_fields?: Record<string, unknown>;
  }) {
    const auth = this.ctx.security.authorizeAction(
      params.principal,
      params.principal.tenant_id,
      params.workspace_id,
      "workspace:write"
    );
    if (!auth.allowed) {
      throw new Error(auth.reason);
    }

    const descriptor = KOSMORA_512_APEX_CATALOG.find(
      (f) => f.featureId.toUpperCase() === params.feature_id.toUpperCase()
    );
    if (!descriptor) {
      throw new Error(`Unknown Kosmora feature ID '${params.feature_id}'.`);
    }

    const [f0, f1, f2, f3] = descriptor.domainFields.map((x) =>
      x.replace(/\s+/g, "")
    ) as [string, string, string, string];
    const supplied = params.domain_fields ?? {};
    const domainFields: Record<string, unknown> = {
      [f0]: supplied[f0] ?? `${descriptor.featureId.toLowerCase()}_seed`,
      [f1]: supplied[f1] ?? 42,
      [f2]: supplied[f2] ?? true,
      [f3]: supplied[f3] ?? "verified_api_payload"
    };

    const kernelInput = {
      featureId: descriptor.featureId,
      operationCode: descriptor.operationCode,
      requestId: params.request_id,
      projectId: params.project_id,
      workspaceId: params.workspace_id,
      tenantId: params.principal.tenant_id,
      actorId: params.principal.user_id,
      autonomyLevel: params.autonomy_level ?? "A3",
      requiredFields: [f0, f1, f2, f3],
      domainFields
    };

    if (descriptor.stage === "stage2-canvas") {
      return this.ctx.stageKernels.stage2.executeDomainOperation(kernelInput);
    }
    if (descriptor.stage === "stage4-intelligence-graph") {
      return this.ctx.stageKernels.stage4.executeDomainOperation(kernelInput);
    }
    if (descriptor.stage === "stage6-sovereign-cluster") {
      return this.ctx.stageKernels.stage6.executeDomainOperation(kernelInput);
    }
    if (descriptor.stage === "stage7-formal-verification") {
      return this.ctx.stageKernels.stage7.executeDomainOperation(kernelInput);
    }
    if (descriptor.stage === "stage8-finops-compliance") {
      return this.ctx.stageKernels.stage8.executeDomainOperation(kernelInput);
    }
    if (descriptor.stage === "stage9-quantum-zk") {
      return this.ctx.stageKernels.stage9.executeDomainOperation(kernelInput);
    }
    if (descriptor.stage === "stage10-game-theory") {
      return this.ctx.stageKernels.stage10.executeDomainOperation(kernelInput);
    }
    if (descriptor.stage === "stage11-causal-bayesian") {
      return this.ctx.stageKernels.stage11.executeDomainOperation(kernelInput);
    }
    if (descriptor.stage === "stage12-homomorphic-vdf") {
      return this.ctx.stageKernels.stage12.executeDomainOperation(kernelInput);
    }
    if (descriptor.stage === "stage13-neurosymbolic-sat") {
      return this.ctx.stageKernels.stage13.executeDomainOperation(kernelInput);
    }
    if (descriptor.stage === "stage14-cybernetic-control") {
      return this.ctx.stageKernels.stage14.executeDomainOperation(kernelInput);
    }
    if (descriptor.stage === "stage15-topological-persistence") {
      return this.ctx.stageKernels.stage15.executeDomainOperation(kernelInput);
    }
    if (descriptor.stage === "stage16-wasm-evolutionary-synth") {
      return this.ctx.stageKernels.stage16.executeDomainOperation(kernelInput);
    }
    return this.ctx.stageKernels.stage1.executeDomainOperation(kernelInput);
  }
}

async function readRawBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const raw = (await readRawBody(req)).trim();
  if (!raw) return {};
  return JSON.parse(raw) as Record<string, unknown>;
}

function sendJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body)
  });
  res.end(body);
}

/**
 * Creates a live Node HTTP & SSE server exposing the Kosmora Control Plane endpoints with
 * Bearer session token verification, HTTP 409 Conflict handling, and binary file streaming.
 */
export function createKosmoraHttpServer(ctx: KosmoraControlPlaneContext): Server {
  const controller = new KosmoraApiController(ctx);

  return createServer(async (req, res) => {
    try {
      const urlObj = new URL(req.url ?? "/", "http://127.0.0.1");
      const pathname = urlObj.pathname;

      if (req.method === "GET" && pathname === "/api/v1/kosmora/health") {
        sendJson(res, 200, {
          status: "ok",
          features_count: KOSMORA_160_CATALOG.length,
          extended_features_count: KOSMORA_192_EXTENDED_CATALOG.length,
          complete_features_count: KOSMORA_256_COMPLETE_CATALOG.length,
          ultimate_features_count: KOSMORA_320_ULTIMATE_CATALOG.length,
          sovereign_features_count: KOSMORA_384_SOVEREIGN_CATALOG.length,
        omega_features_count: KOSMORA_448_OMEGA_CATALOG.length,
        apex_features_count: KOSMORA_512_APEX_CATALOG.length,
          migrations_applied: ctx.store.listAppliedMigrations().length
        });
        return;
      }

      // Public HMAC-SHA256 authenticated webhook receiver (does not use session Bearer token)
      const scheduleWebhookMatch = pathname.match(
        /^\/api\/v1\/schedules\/([^/]+)\/webhook$/
      );
      if (req.method === "POST" && scheduleWebhookMatch) {
        const scheduleId = decodeURIComponent(scheduleWebhookMatch[1]!);
        const signatureHeader = String(
          req.headers["x-kosmora-signature-256"] ??
            req.headers["x-hub-signature-256"] ??
            ""
        );
        const idempotencyKey = req.headers["x-kosmora-idempotency-key"]
          ? String(req.headers["x-kosmora-idempotency-key"])
          : undefined;
        const nowIsoHeader = req.headers["x-kosmora-timestamp"]
          ? String(req.headers["x-kosmora-timestamp"])
          : undefined;
        const rawBody = await readRawBody(req);
        const execution = ctx.schedules.receiveWebhookTrigger({
          schedule_id: scheduleId,
          signature_header: signatureHeader,
          raw_body: rawBody,
          idempotency_key: idempotencyKey,
          now_iso: nowIsoHeader
        });
        sendJson(
          res,
          execution.run.status === "triggered" ? 201 : 200,
          execution
        );
        return;
      }

      const authHeader = req.headers.authorization ?? "";
      const token = authHeader.startsWith("Bearer ")
        ? authHeader.slice("Bearer ".length).trim()
        : "";
      let principal: TenantPrincipal;
      try {
        principal = ctx.security.verifySignedSessionToken(token);
      } catch (authErr) {
        sendJson(res, 401, {
          error: "UNAUTHORIZED",
          message: authErr instanceof Error ? authErr.message : "Invalid token"
        });
        return;
      }

      if (req.method === "GET" && pathname === "/api/v1/kosmora/audit/verify") {
        const integrity = ctx.security.verifyAuditTrailIntegrity();
        sendJson(res, 200, {
          ...integrity,
          entries_count: ctx.security.getAuditChain().length
        });
        return;
      }

      if (req.method === "GET" && pathname === "/api/v1/kosmora/events/stream") {
        res.writeHead(200, {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache, no-transform",
          connection: "keep-alive"
        });
        const snapshotEvent = {
          event_type: "cluster.snapshot",
          tenant_id: principal.tenant_id,
          peers_count: ctx.stageKernels.stage6.clusterEngine.listClusterPeers().length,
          fencing_token: ctx.stageKernels.stage6.clusterEngine.getCurrentFencingToken(),
          audit_entries: ctx.security.getAuditChain().length,
          complete_features_count: KOSMORA_256_COMPLETE_CATALOG.length,
          ultimate_features_count: KOSMORA_320_ULTIMATE_CATALOG.length,
          sovereign_features_count: KOSMORA_384_SOVEREIGN_CATALOG.length,
          timestamp_iso: new Date().toISOString()
        };
        res.write(`event: cluster.snapshot\ndata: ${JSON.stringify(snapshotEvent)}\n\n`);
        res.end();
        return;
      }

      const body = await readJsonBody(req);
      const targetTenant = String(
        body.tenant_id ?? principal.tenant_id
      );
      if (targetTenant !== principal.tenant_id) {
        sendJson(res, 403, {
          error: "FORBIDDEN_RLS_TENANT_MISMATCH",
          message: `Cross-tenant request blocked (${principal.tenant_id} -> ${targetTenant})`
        });
        return;
      }

      if (req.method === "POST" && pathname === "/api/v1/kosmora/dag/compile-and-step") {
        const result = controller.handleDagCompileAndStep({
          principal,
          workspace_id: String(body.workspace_id ?? "ws_1"),
          project_id: String(body.project_id ?? "proj_1"),
          goal: String(body.goal ?? "Execute DAG"),
          max_parallelism: Number(body.max_parallelism ?? 2),
          budget_limit_usd: Number(body.budget_limit_usd ?? 10),
          tasks: (body.tasks as Parameters<KosmoraApiController["handleDagCompileAndStep"]>[0]["tasks"]) ?? []
        });
        sendJson(res, 200, result);
        return;
      }

      if (req.method === "POST" && pathname === "/api/v1/kosmora/dag/hitl/request") {
        const result = controller.handleRequestHitlApproval({
          principal,
          workspace_id: String(body.workspace_id ?? "ws_1"),
          plan: body.plan as KosmoraDagPlan,
          node_id: String(body.node_id ?? ""),
          action_scope: body.action_scope ? String(body.action_scope) : undefined
        });
        sendJson(res, 200, result);
        return;
      }

      if (req.method === "POST" && pathname === "/api/v1/kosmora/dag/hitl/approve") {
        const result = controller.handleApproveHitlNode({
          principal,
          workspace_id: String(body.workspace_id ?? "ws_1"),
          plan: body.plan as KosmoraDagPlan,
          node_id: String(body.node_id ?? ""),
          approval_token: String(body.approval_token ?? ""),
          reason: body.reason ? String(body.reason) : undefined
        });
        sendJson(res, 200, result);
        return;
      }

      if (req.method === "POST" && pathname === "/api/v1/kosmora/canvas/commit-and-export") {
        const result = controller.handleCanvasCommitAndExport({
          principal,
          workspace_id: String(body.workspace_id ?? "ws_1"),
          project_id: String(body.project_id ?? "proj_1"),
          artifact_id: String(body.artifact_id ?? "art_1"),
          kind: (body.kind as CanvasArtifactKind) ?? "document",
          title: String(body.title ?? "Untitled"),
          blocks: (body.blocks as CanvasBlock[]) ?? [],
          commit_message: String(body.commit_message ?? "Update"),
          expected_version:
            typeof body.expected_version === "number" ? body.expected_version : undefined,
          export_format: body.export_format as "xlsx" | "pdf" | "md" | undefined
        });

        if (body.stream_binary === true && result.binary_export) {
          res.writeHead(200, {
            "content-type": result.binary_export.mime_type,
            "content-disposition": `attachment; filename="${result.binary_export.filename}"`,
            "content-length": result.binary_export.byte_length
          });
          res.end(result.binary_export.buffer);
          return;
        }

        sendJson(res, 200, {
          revision: result.revision,
          markdown_export: result.markdown_export,
          binary_export: result.binary_export
            ? {
                filename: result.binary_export.filename,
                mime_type: result.binary_export.mime_type,
                byte_length: result.binary_export.byte_length,
                base64: result.binary_export.buffer.toString("base64")
              }
            : undefined
        });
        return;
      }

      if (req.method === "POST" && pathname === "/api/v1/kosmora/memory/hybrid-search") {
        const result = controller.handleHybridMemorySearch({
          principal,
          workspace_id: String(body.workspace_id ?? "ws_1"),
          project_id: String(body.project_id ?? "proj_1"),
          query: String(body.query ?? ""),
          top_k: typeof body.top_k === "number" ? body.top_k : 5
        });
        sendJson(res, 200, result);
        return;
      }

      if (req.method === "POST" && pathname === "/api/v1/kosmora/snapshots/create") {
        const result = controller.handleCreateSnapshot({
          principal,
          workspace_id: String(body.workspace_id ?? "ws_1"),
          project_id: String(body.project_id ?? "proj_1")
        });
        sendJson(res, 200, result);
        return;
      }

      if (req.method === "POST" && pathname === "/api/v1/kosmora/snapshots/restore") {
        const result = controller.handleRestoreSnapshot({
          principal,
          workspace_id: String(body.workspace_id ?? "ws_1"),
          snapshot_id: String(body.snapshot_id ?? "")
        });
        sendJson(res, 200, result);
        return;
      }

      if (req.method === "POST" && pathname === "/api/v1/kosmora/attestation/sign") {
        const result = controller.handleSignArtifactAttestation({
          principal,
          workspace_id: String(body.workspace_id ?? "ws_1"),
          project_id: String(body.project_id ?? "proj_1"),
          artifact_id: String(body.artifact_id ?? "art_1"),
          artifact_content: String(body.artifact_content ?? ""),
          source_dag_run_id: body.source_dag_run_id ? String(body.source_dag_run_id) : undefined
        });
        sendJson(res, 200, result);
        return;
      }

      if (req.method === "POST" && pathname === "/api/v1/kosmora/attestation/verify") {
        const result = controller.handleVerifyArtifactAttestation({
          principal,
          workspace_id: String(body.workspace_id ?? "ws_1"),
          envelope: body.envelope as Ed25519AttestationEnvelope,
          artifact_content: String(body.artifact_content ?? "")
        });
        sendJson(res, 200, result);
        return;
      }

      if (req.method === "POST" && pathname === "/api/v1/kosmora/formal/verify-model") {
        const result = controller.handleVerifyStateMachineModel({
          principal,
          workspace_id: String(body.workspace_id ?? "ws_1"),
          spec: (body.spec ?? body) as Parameters<KosmoraFormalVerificationEngine["verifyStateMachineInvariants"]>[0]
        });
        sendJson(res, 200, result);
        return;
      }

      if (req.method === "POST" && pathname === "/api/v1/kosmora/formal/solve-csp") {
        const result = controller.handleSolveResourceCsp({
          principal,
          workspace_id: String(body.workspace_id ?? "ws_1"),
          tasks: (body.tasks as Parameters<KosmoraFormalVerificationEngine["solveResourceAllocationConstraints"]>[0]) ?? [],
          hosts: (body.hosts as Parameters<KosmoraFormalVerificationEngine["solveResourceAllocationConstraints"]>[1]) ?? []
        });
        sendJson(res, 200, result);
        return;
      }

      if (req.method === "POST" && pathname === "/api/v1/kosmora/finops/bandit-route") {
        const result = controller.handleSelectBanditRoute({
          principal,
          workspace_id: String(body.workspace_id ?? "ws_1"),
          max_latency_slo_ms: typeof body.max_latency_slo_ms === "number" ? body.max_latency_slo_ms : 1800,
          cost_weight: typeof body.cost_weight === "number" ? body.cost_weight : undefined
        });
        sendJson(res, 200, result);
        return;
      }

      if (req.method === "POST" && pathname === "/api/v1/kosmora/finops/forecast") {
        const result = controller.handleForecastFinOpsBurnRate({
          principal,
          workspace_id: String(body.workspace_id ?? "ws_1"),
          budget_cap_usd: Number(body.budget_cap_usd ?? 500),
          hourly_spend_series:
            (body.hourly_spend_series as Array<{ hour_index: number; spend_usd: number }>) ?? []
        });
        sendJson(res, 200, result);
        return;
      }

      if (req.method === "POST" && pathname === "/api/v1/kosmora/compliance/merkle-proof") {
        const result = controller.handleGenerateMerkleComplianceProof({
          principal,
          workspace_id: String(body.workspace_id ?? "ws_1"),
          claims: (body.claims as Parameters<KosmoraFinOpsComplianceEngine["generateSelectiveDisclosureProof"]>[0]) ?? [],
          target_claim_id: String(body.target_claim_id ?? "")
        });
        sendJson(res, 200, result);
        return;
      }

      if (req.method === "POST" && pathname === "/api/v1/kosmora/compliance/rtbf-erase") {
        const result = controller.handleRightToBeForgottenErase({
          principal,
          workspace_id: String(body.workspace_id ?? "ws_1"),
          subject_id: String(body.subject_id ?? "")
        });
        sendJson(res, 200, result);
        return;
      }

      if (req.method === "POST" && pathname === "/api/v1/kosmora/quantum/shamir-split-recover") {
        const result = controller.handleShamirSplitAndRecover({
          principal,
          workspace_id: String(body.workspace_id ?? "ws_1"),
          secret_utf8: String(body.secret_utf8 ?? ""),
          total_shares_n: Number(body.total_shares_n ?? 5),
          threshold_k: Number(body.threshold_k ?? 3)
        });
        sendJson(res, 200, result);
        return;
      }

      if (req.method === "POST" && pathname === "/api/v1/kosmora/quantum/zk-prove-verify") {
        const result = controller.handleZkProveAndVerify({
          principal,
          workspace_id: String(body.workspace_id ?? "ws_1"),
          statement_id: String(body.statement_id ?? "stmt_default"),
          secret_witness_scalar: Number(body.secret_witness_scalar ?? 42),
          nonce_seed: body.nonce_seed ? String(body.nonce_seed) : undefined
        });
        sendJson(res, 200, result);
        return;
      }

      if (req.method === "POST" && pathname === "/api/v1/kosmora/quantum/pqc-sign-verify") {
        const result = controller.handlePqcSignAndVerify({
          principal,
          workspace_id: String(body.workspace_id ?? "ws_1"),
          key_id: String(body.key_id ?? "pqc_key_1"),
          private_seed: String(body.private_seed ?? "default_seed"),
          message: String(body.message ?? "")
        });
        sendJson(res, 200, result);
        return;
      }

      if (req.method === "POST" && pathname === "/api/v1/kosmora/gametheory/shapley-allocate") {
        const result = controller.handleShapleyAttribution({
          principal,
          workspace_id: String(body.workspace_id ?? "ws_1"),
          players: (body.players as string[]) ?? [],
          coalition_values: (body.coalition_values as Record<string, number>) ?? {}
        });
        sendJson(res, 200, result);
        return;
      }

      if (req.method === "POST" && pathname === "/api/v1/kosmora/gametheory/vcg-auction") {
        const result = controller.handleVcgTaskAuction({
          principal,
          workspace_id: String(body.workspace_id ?? "ws_1"),
          tasks: (body.tasks as string[]) ?? [],
          bids: (body.bids as Parameters<KosmoraGameTheoryEngine["runVcgCombinatorialTaskAuction"]>[0]["bids"]) ?? []
        });
        sendJson(res, 200, result);
        return;
      }

      if (req.method === "POST" && pathname === "/api/v1/kosmora/gametheory/schulze-consensus") {
        const result = controller.handleSchulzeConsensus({
          principal,
          workspace_id: String(body.workspace_id ?? "ws_1"),
          candidates: (body.candidates as string[]) ?? [],
          ranked_ballots: (body.ranked_ballots as string[][]) ?? []
        });
        sendJson(res, 200, result);
        return;
      }

      if (req.method === "POST" && pathname === "/api/v1/kosmora/gametheory/stable-matching") {
        const result = controller.handleGaleShapleyMatching({
          principal,
          workspace_id: String(body.workspace_id ?? "ws_1"),
          agent_preferences: (body.agent_preferences as Record<string, string[]>) ?? {},
          task_preferences: (body.task_preferences as Record<string, string[]>) ?? {}
        });
        sendJson(res, 200, result);
        return;
      }

      if (req.method === "POST" && pathname === "/api/v1/kosmora/causal/do-intervention") {
        const result = controller.handleCausalDoIntervention({
          principal,
          workspace_id: String(body.workspace_id ?? "ws_1"),
          model: body.model as Parameters<KosmoraCausalBayesianEngine["evaluateStructuralCausalIntervention"]>[0]["model"],
          treatment_var: String(body.treatment_var ?? ""),
          outcome_var: String(body.outcome_var ?? ""),
          do_value: Number(body.do_value ?? 1),
          baseline_value: typeof body.baseline_value === "number" ? body.baseline_value : 0
        });
        sendJson(res, 200, result);
        return;
      }

      if (req.method === "POST" && pathname === "/api/v1/kosmora/causal/counterfactual") {
        const result = controller.handleCounterfactualTrajectory({
          principal,
          workspace_id: String(body.workspace_id ?? "ws_1"),
          model: body.model as Parameters<KosmoraCausalBayesianEngine["computeCounterfactualTrajectory"]>[0]["model"],
          observed_evidence: (body.observed_evidence as Record<string, number>) ?? {},
          intervention_var: String(body.intervention_var ?? ""),
          intervention_value: Number(body.intervention_value ?? 1),
          outcome_var: String(body.outcome_var ?? "")
        });
        sendJson(res, 200, result);
        return;
      }

      if (req.method === "POST" && pathname === "/api/v1/kosmora/causal/bayesian-posterior") {
        const result = controller.handleBayesianPosteriorUpdate({
          principal,
          workspace_id: String(body.workspace_id ?? "ws_1"),
          hypotheses: (body.hypotheses as Parameters<KosmoraCausalBayesianEngine["updateBayesianBeliefNetwork"]>[0]["hypotheses"]) ?? [],
          observed_evidence: (body.observed_evidence as Record<string, boolean>) ?? {}
        });
        sendJson(res, 200, result);
        return;
      }

      if (req.method === "POST" && pathname === "/api/v1/kosmora/causal/thompson-sample") {
        const result = controller.handleThompsonSampling({
          principal,
          workspace_id: String(body.workspace_id ?? "ws_1"),
          arms: (body.arms as Parameters<KosmoraCausalBayesianEngine["sampleThompsonBetaPosterior"]>[0]["arms"]) ?? [],
          deterministic_seed: String(body.deterministic_seed ?? "default_seed")
        });
        sendJson(res, 200, result);
        return;
      }

      if (req.method === "POST" && pathname === "/api/v1/kosmora/crypto/paillier-homomorphic-add") {
        const result = controller.handlePaillierHomomorphicAdd({
          principal,
          workspace_id: String(body.workspace_id ?? "ws_1"),
          values: (body.values as number[]) ?? []
        });
        sendJson(res, 200, result);
        return;
      }

      if (req.method === "POST" && pathname === "/api/v1/kosmora/crypto/vdf-evaluate-verify") {
        const result = controller.handleVdfEvaluateAndVerify({
          principal,
          workspace_id: String(body.workspace_id ?? "ws_1"),
          challenge_id: String(body.challenge_id ?? "vdf_1"),
          seed_input: String(body.seed_input ?? "seed_1"),
          iterations_t: Number(body.iterations_t ?? 32)
        });
        sendJson(res, 200, result);
        return;
      }

      if (req.method === "POST" && pathname === "/api/v1/kosmora/crypto/macaroon-mint-verify") {
        const result = controller.handleMacaroonMintAndVerify({
          principal,
          workspace_id: String(body.workspace_id ?? "ws_1"),
          identifier: String(body.identifier ?? "mac_1"),
          caveats: (body.caveats as string[]) ?? [],
          context: (body.context as Record<string, string | number>) ?? {}
        });
        sendJson(res, 200, result);
        return;
      }

      if (req.method === "POST" && pathname === "/api/v1/kosmora/crypto/byzantine-quorum") {
        const result = controller.handleByzantineQuorumVerify({
          principal,
          workspace_id: String(body.workspace_id ?? "ws_1"),
          validators: (body.validators as string[]) ?? [],
          quorum_a: (body.quorum_a as string[]) ?? [],
          quorum_b: (body.quorum_b as string[]) ?? [],
          votes: (body.votes as Parameters<KosmoraHomomorphicVdfEngine["verifyByzantineQuorumIntersection"]>[0]["votes"]) ?? []
        });
        sendJson(res, 200, result);
        return;
      }


      if (req.method === "POST" && pathname === "/api/v1/kosmora/symbolic/datalog-fixpoint") {
        const result = ctx.neurosymbolicSat.evaluateDatalogFixpoint(body as any);
        sendJson(res, 200, result);
        return;
      }

      if (req.method === "POST" && pathname === "/api/v1/kosmora/symbolic/dpll-sat") {
        const result = ctx.neurosymbolicSat.solveDpllBooleanSat(body as any);
        sendJson(res, 200, result);
        return;
      }

      if (req.method === "POST" && pathname === "/api/v1/kosmora/symbolic/unify-terms") {
        const result = ctx.neurosymbolicSat.unifyFirstOrderTerms((body as any).t1, (body as any).t2);
        sendJson(res, 200, result);
        return;
      }

      if (req.method === "POST" && pathname === "/api/v1/kosmora/symbolic/deontic-check") {
        const result = ctx.neurosymbolicSat.verifyDeonticPolicyConsistency(((body as any).norms ?? []) as any);
        sendJson(res, 200, result);
        return;
      }

      if (req.method === "POST" && pathname === "/api/v1/kosmora/control/pid-simulate") {
        const result = ctx.cyberneticControl.simulateDiscretePidControlLoop(body as any);
        sendJson(res, 200, result);
        return;
      }

      if (req.method === "POST" && pathname === "/api/v1/kosmora/control/kalman-filter") {
        const result = ctx.cyberneticControl.runKalmanFilterEstimation(body as any);
        sendJson(res, 200, result);
        return;
      }

      if (req.method === "POST" && pathname === "/api/v1/kosmora/control/laplacian-connectivity") {
        const result = ctx.cyberneticControl.analyzeGraphLaplacianConnectivity(body as any);
        sendJson(res, 200, result);
        return;
      }

      if (req.method === "POST" && pathname === "/api/v1/kosmora/control/submodular-greedy") {
        const result = ctx.cyberneticControl.maximizeSubmodularCoverageGreedy(body as any);
        sendJson(res, 200, result);
        return;
      }


      if (req.method === "POST" && pathname === "/api/v1/kosmora/topology/vietoris-rips-betti") {
        const result = ctx.topologicalPersistence.computeVietorisRipsBettiNumbers(body as any);
        sendJson(res, 200, result);
        return;
      }

      if (req.method === "POST" && pathname === "/api/v1/kosmora/topology/persistent-barcode") {
        const result = ctx.topologicalPersistence.computePersistentHomologyBarcode(body as any);
        sendJson(res, 200, result);
        return;
      }

      if (req.method === "POST" && pathname === "/api/v1/kosmora/topology/ollivier-ricci") {
        const result = ctx.topologicalPersistence.computeOllivierRicciGraphCurvature(body as any);
        sendJson(res, 200, result);
        return;
      }

      if (req.method === "POST" && pathname === "/api/v1/kosmora/topology/hodge-helmholtz") {
        const result = ctx.topologicalPersistence.decomposeEdgeFlowHodgeHelmholtz(body as any);
        sendJson(res, 200, result);
        return;
      }

      if (req.method === "POST" && pathname === "/api/v1/kosmora/synth/bytecode-verify-run") {
        const result = ctx.wasmEvolutionarySynth.verifyAndExecuteStackBytecode(body as any);
        sendJson(res, 200, result);
        return;
      }

      if (req.method === "POST" && pathname === "/api/v1/kosmora/synth/nsga2-pareto") {
        const result = ctx.wasmEvolutionarySynth.computeNsga2ParetoFronts(body as any);
        sendJson(res, 200, result);
        return;
      }

      if (req.method === "POST" && pathname === "/api/v1/kosmora/synth/ast-edit-script") {
        const result = ctx.wasmEvolutionarySynth.computeAstEditDistanceAndScript(body as any);
        sendJson(res, 200, result);
        return;
      }

      if (req.method === "POST" && pathname === "/api/v1/kosmora/synth/compression-ncd") {
        const result = ctx.wasmEvolutionarySynth.computeNormalizedCompressionDistance(body as any);
        sendJson(res, 200, result);
        return;
      }

      if (req.method === "POST" && pathname === "/api/v1/kosmora/features/execute") {
        const result = controller.handleExecuteFeatureById({
          principal,
          feature_id: String(body.feature_id ?? "F001"),
          request_id: String(body.request_id ?? `req_${Date.now()}`),
          project_id: String(body.project_id ?? "proj_1"),
          workspace_id: String(body.workspace_id ?? "ws_1"),
          autonomy_level: (body.autonomy_level as "A3") ?? "A3",
          domain_fields: (body.domain_fields as Record<string, unknown>) ?? {}
        });
        sendJson(res, 200, result);
        return;
      }

      // =======================================================================
      // Kosmora Mission Control REST & SSE API Routes (/api/v1/missions...)
      // =======================================================================

      if (req.method === "POST" && pathname === "/api/v1/missions") {
        const mission = ctx.missionControl.createMission({
          principal,
          workspace_id: body.workspace_id ? String(body.workspace_id) : "ws_default",
          project_id: String(body.project_id ?? "proj_default"),
          title: String(body.title ?? ""),
          goal: String(body.goal ?? ""),
          context: body.context ? String(body.context) : "",
          priority: (body.priority as MissionPriority) ?? "medium",
          budget_limit:
            body.budget_limit !== undefined ? Number(body.budget_limit) : 25.0
        });
        sendJson(res, 201, { mission });
        return;
      }

      if (req.method === "GET" && pathname === "/api/v1/missions") {
        const projectId = urlObj.searchParams.get("project_id") ?? undefined;
        const status = (urlObj.searchParams.get("status") as MissionStatus) ?? undefined;
        const missions = ctx.missionControl.listMissions({
          principal,
          project_id: projectId,
          status
        });
        sendJson(res, 200, {
          missions,
          roles: ctx.missionControl.listAgentRoles()
        });
        return;
      }

      const missionEventsStreamMatch = pathname.match(
        /^\/api\/v1\/missions\/([^/]+)\/events\/stream$/
      );
      if (req.method === "GET" && missionEventsStreamMatch) {
        const missionId = decodeURIComponent(missionEventsStreamMatch[1]!);
        const history = ctx.missionControl.listEvents({
          principal,
          mission_id: missionId
        });

        res.writeHead(200, {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache, no-transform",
          connection: "keep-alive"
        });

        for (const ev of history) {
          res.write(
            `id: ${ev.id}\nevent: ${ev.event_type}\ndata: ${JSON.stringify(ev)}\n\n`
          );
        }

        const keepAlive = urlObj.searchParams.get("keepAlive") === "1";
        if (!keepAlive) {
          res.end();
          return;
        }

        const unsubscribe = ctx.missionControl.subscribeMissionEvents(
          missionId,
          (ev) => {
            if (!res.writableEnded) {
              res.write(
                `id: ${ev.id}\nevent: ${ev.event_type}\ndata: ${JSON.stringify(ev)}\n\n`
              );
            }
          }
        );

        req.on("close", () => {
          unsubscribe();
        });
        return;
      }

      const missionEventsMatch = pathname.match(
        /^\/api\/v1\/missions\/([^/]+)\/events$/
      );
      if (req.method === "GET" && missionEventsMatch) {
        const missionId = decodeURIComponent(missionEventsMatch[1]!);
        const events = ctx.missionControl.listEvents({
          principal,
          mission_id: missionId
        });
        sendJson(res, 200, { events });
        return;
      }

      const missionActionMatch = pathname.match(
        /^\/api\/v1\/missions\/([^/]+)\/(start|pause|cancel|export)$/
      );
      if (missionActionMatch) {
        const missionId = decodeURIComponent(missionActionMatch[1]!);
        const action = missionActionMatch[2]!;

        if (req.method === "POST" && action === "start") {
          const mission = ctx.missionControl.startMission({
            principal,
            mission_id: missionId
          });
          const details = ctx.missionControl.getMissionDetails({
            principal,
            mission_id: mission.id
          });
          sendJson(res, 200, details);
          return;
        }

        if (req.method === "POST" && action === "pause") {
          const mission = ctx.missionControl.pauseMission({
            principal,
            mission_id: missionId
          });
          sendJson(res, 200, { mission });
          return;
        }

        if (req.method === "POST" && action === "cancel") {
          const mission = ctx.missionControl.cancelMission({
            principal,
            mission_id: missionId,
            reason: body.reason ? String(body.reason) : undefined
          });
          sendJson(res, 200, { mission });
          return;
        }

        if (req.method === "GET" && action === "export") {
          const formatParam =
            urlObj.searchParams.get("format")?.toLowerCase() === "markdown" ||
            urlObj.searchParams.get("format")?.toLowerCase() === "md"
              ? "markdown"
              : "json";
          const exported = ctx.missionControl.exportMission({
            principal,
            mission_id: missionId,
            format: formatParam
          });
          sendJson(res, 200, exported);
          return;
        }
      }

      const taskActionMatch = pathname.match(
        /^\/api\/v1\/missions\/([^/]+)\/tasks\/([^/]+)\/(retry|review)$/
      );
      if (req.method === "POST" && taskActionMatch) {
        const missionId = decodeURIComponent(taskActionMatch[1]!);
        const taskId = decodeURIComponent(taskActionMatch[2]!);
        const action = taskActionMatch[3]!;

        if (action === "retry") {
          const result = ctx.missionControl.retryTask({
            principal,
            mission_id: missionId,
            task_id: taskId
          });
          sendJson(res, 200, result);
          return;
        }

        if (action === "review") {
          const result = ctx.missionControl.reviewTask({
            principal,
            mission_id: missionId,
            task_id: taskId,
            decision: String(body.decision ?? "") as MissionReviewDecision,
            comment: body.comment !== undefined ? String(body.comment) : undefined
          });
          sendJson(res, 200, result);
          return;
        }
      }

      const singleTaskMatch = pathname.match(
        /^\/api\/v1\/missions\/([^/]+)\/tasks\/([^/]+)$/
      );
      if (singleTaskMatch) {
        const missionId = decodeURIComponent(singleTaskMatch[1]!);
        const taskId = decodeURIComponent(singleTaskMatch[2]!);

        if (req.method === "PATCH") {
          const task = ctx.missionControl.updateTask({
            principal,
            mission_id: missionId,
            task_id: taskId,
            expected_version:
              body.expected_version !== undefined
                ? Number(body.expected_version)
                : undefined,
            title: body.title !== undefined ? String(body.title) : undefined,
            instruction:
              body.instruction !== undefined
                ? String(body.instruction)
                : undefined,
            assigned_agent_role:
              body.assigned_agent_role !== undefined
                ? (String(body.assigned_agent_role) as MissionAgentRole)
                : undefined,
            execution_mode:
              body.execution_mode !== undefined
                ? (String(body.execution_mode) as MissionTaskExecutionMode)
                : undefined,
            requested_tools: Array.isArray(body.requested_tools)
              ? (body.requested_tools as string[])
              : undefined,
            priority:
              body.priority !== undefined
                ? (String(body.priority) as MissionPriority)
                : undefined,
            dependencies: Array.isArray(body.dependencies)
              ? (body.dependencies as string[])
              : undefined,
            input_artifact_ids: Array.isArray(body.input_artifact_ids)
              ? (body.input_artifact_ids as string[])
              : undefined,
            max_attempts:
              body.max_attempts !== undefined
                ? Number(body.max_attempts)
                : undefined,
            budget_limit:
              body.budget_limit !== undefined
                ? Number(body.budget_limit)
                : undefined,
            status:
              body.status !== undefined
                ? (String(body.status) as MissionTaskStatus)
                : undefined,
            clarification_response:
              body.clarification_response !== undefined
                ? String(body.clarification_response)
                : undefined
          });
          sendJson(res, 200, { task });
          return;
        }

        if (req.method === "DELETE") {
          const result = ctx.missionControl.deleteTask({
            principal,
            mission_id: missionId,
            task_id: taskId
          });
          sendJson(res, 200, result);
          return;
        }
      }

      const missionTasksCollectionMatch = pathname.match(
        /^\/api\/v1\/missions\/([^/]+)\/tasks$/
      );
      if (req.method === "POST" && missionTasksCollectionMatch) {
        const missionId = decodeURIComponent(missionTasksCollectionMatch[1]!);
        const task = ctx.missionControl.createTask({
          principal,
          mission_id: missionId,
          id: body.id ? String(body.id) : undefined,
          title: String(body.title ?? ""),
          instruction: String(body.instruction ?? ""),
          assigned_agent_role: String(
            body.assigned_agent_role ?? "researcher"
          ) as MissionAgentRole,
          execution_mode: body.execution_mode
            ? (String(body.execution_mode) as MissionTaskExecutionMode)
            : undefined,
          requested_tools: Array.isArray(body.requested_tools)
            ? (body.requested_tools as string[])
            : undefined,
          priority: body.priority
            ? (String(body.priority) as MissionPriority)
            : undefined,
          dependencies: Array.isArray(body.dependencies)
            ? (body.dependencies as string[])
            : undefined,
          input_artifact_ids: Array.isArray(body.input_artifact_ids)
            ? (body.input_artifact_ids as string[])
            : undefined,
          max_attempts:
            body.max_attempts !== undefined
              ? Number(body.max_attempts)
              : undefined,
          budget_limit:
            body.budget_limit !== undefined
              ? Number(body.budget_limit)
              : undefined
        });
        sendJson(res, 201, { task });
        return;
      }

      const singleMissionMatch = pathname.match(
        /^\/api\/v1\/missions\/([^/]+)$/
      );
      if (singleMissionMatch) {
        const missionId = decodeURIComponent(singleMissionMatch[1]!);
        if (req.method === "GET") {
          const details = ctx.missionControl.getMissionDetails({
            principal,
            mission_id: missionId
          });
          const playbookInstantiation = ctx.playbooks.getInstantiationForMission({
            principal,
            mission_id: missionId
          });
          sendJson(res, 200, {
            ...details,
            playbook_instantiation: playbookInstantiation
          });
          return;
        }

        if (req.method === "PATCH") {
          const mission = ctx.missionControl.updateMission({
            principal,
            mission_id: missionId,
            expected_version:
              body.expected_version !== undefined
                ? Number(body.expected_version)
                : undefined,
            title: body.title !== undefined ? String(body.title) : undefined,
            goal: body.goal !== undefined ? String(body.goal) : undefined,
            context:
              body.context !== undefined ? String(body.context) : undefined,
            priority:
              body.priority !== undefined
                ? (String(body.priority) as MissionPriority)
                : undefined,
            status:
              body.status !== undefined
                ? (String(body.status) as MissionStatus)
                : undefined,
            budget_limit:
              body.budget_limit !== undefined
                ? Number(body.budget_limit)
                : undefined
          });
          sendJson(res, 200, { mission });
          return;
        }
      }


      // =======================================================================
      // Kosmora Playbooks REST API Routes (/api/v1/playbooks...)
      // =======================================================================

      if (req.method === "GET" && pathname === "/api/v1/playbooks/categories") {
        const projectId = urlObj.searchParams.get("project_id") ?? undefined;
        const categories = ctx.playbooks.listCategories({
          principal,
          project_id: projectId
        });
        sendJson(res, 200, { categories });
        return;
      }

      if (req.method === "GET" && pathname === "/api/v1/playbooks") {
        const projectId = urlObj.searchParams.get("project_id") ?? undefined;
        const category = urlObj.searchParams.get("category") ?? undefined;
        const tag = urlObj.searchParams.get("tag") ?? undefined;
        const visibility =
          (urlObj.searchParams.get("visibility") as PlaybookVisibility) ??
          undefined;
        const status =
          (urlObj.searchParams.get("status") as PlaybookStatus) ?? undefined;
        const search = urlObj.searchParams.get("search") ?? undefined;

        const playbooks = ctx.playbooks.listPlaybooks({
          principal,
          project_id: projectId,
          category,
          tag,
          visibility,
          status,
          search
        });
        const categories = ctx.playbooks.listCategories({
          principal,
          project_id: projectId
        });
        sendJson(res, 200, { playbooks, categories });
        return;
      }

      if (req.method === "POST" && pathname === "/api/v1/playbooks") {
        const result = ctx.playbooks.createPlaybook({
          principal,
          project_id:
            body.project_id !== undefined
              ? body.project_id === null
                ? null
                : String(body.project_id)
              : "proj_default",
          slug: String(body.slug ?? ""),
          title: String(body.title ?? ""),
          description: String(body.description ?? ""),
          category: body.category ? String(body.category) : undefined,
          tags: Array.isArray(body.tags) ? (body.tags as string[]) : undefined,
          visibility: body.visibility
            ? (String(body.visibility) as Exclude<PlaybookVisibility, "built_in">)
            : "private",
          definition: body.definition as PlaybookDefinition,
          publish_immediately: Boolean(body.publish_immediately),
          changelog: body.changelog ? String(body.changelog) : undefined
        });
        sendJson(res, 201, result);
        return;
      }

      const playbookVersionSingleMatch = pathname.match(
        /^\/api\/v1\/playbooks\/([^/]+)\/versions\/([^/]+)$/
      );
      if (req.method === "GET" && playbookVersionSingleMatch) {
        const playbookId = decodeURIComponent(playbookVersionSingleMatch[1]!);
        const versionId = decodeURIComponent(playbookVersionSingleMatch[2]!);
        const projectId = urlObj.searchParams.get("project_id") ?? undefined;
        const version = ctx.playbooks.getVersion({
          principal,
          playbook_id: playbookId,
          version_id: versionId,
          project_id: projectId
        });
        sendJson(res, 200, { version });
        return;
      }

      const playbookVersionsCollectionMatch = pathname.match(
        /^\/api\/v1\/playbooks\/([^/]+)\/versions$/
      );
      if (playbookVersionsCollectionMatch) {
        const playbookId = decodeURIComponent(
          playbookVersionsCollectionMatch[1]!
        );
        const projectId = urlObj.searchParams.get("project_id") ?? undefined;

        if (req.method === "GET") {
          const versions = ctx.playbooks.listVersions({
            principal,
            playbook_id: playbookId,
            project_id: projectId
          });
          sendJson(res, 200, { versions });
          return;
        }

        if (req.method === "POST") {
          const result = ctx.playbooks.publishVersion({
            principal,
            playbook_id: playbookId,
            changelog: body.changelog ? String(body.changelog) : undefined,
            from_version:
              body.from_version !== undefined
                ? (body.from_version as number | string)
                : undefined,
            expected_draft_version_lock:
              body.expected_draft_version_lock !== undefined
                ? Number(body.expected_draft_version_lock)
                : undefined
          });
          sendJson(res, 201, result);
          return;
        }
      }

      const playbookDiffMatch = pathname.match(
        /^\/api\/v1\/playbooks\/([^/]+)\/diff$/
      );
      if (req.method === "GET" && playbookDiffMatch) {
        const playbookId = decodeURIComponent(playbookDiffMatch[1]!);
        const fromParam = urlObj.searchParams.get("from") ?? "1";
        const toParam = urlObj.searchParams.get("to") ?? "1";
        const projectId = urlObj.searchParams.get("project_id") ?? undefined;
        const diff = ctx.playbooks.diffVersions({
          principal,
          playbook_id: playbookId,
          from_version: fromParam,
          to_version: toParam,
          project_id: projectId
        });
        sendJson(res, 200, { diff });
        return;
      }

      const playbookActionMatch = pathname.match(
        /^\/api\/v1\/playbooks\/([^/]+)\/(instantiate|preview|archive)$/
      );
      if (req.method === "POST" && playbookActionMatch) {
        const playbookId = decodeURIComponent(playbookActionMatch[1]!);
        const action = playbookActionMatch[2]!;

        if (action === "archive") {
          const playbook = ctx.playbooks.archivePlaybook({
            principal,
            playbook_id: playbookId,
            expected_draft_version_lock:
              body.expected_draft_version_lock !== undefined
                ? Number(body.expected_draft_version_lock)
                : undefined
          });
          sendJson(res, 200, { playbook });
          return;
        }

        const isPreviewOnly =
          action === "preview" ||
          urlObj.searchParams.get("preview") === "true" ||
          Boolean(body.preview_only);

        if (isPreviewOnly) {
          const preview = ctx.playbooks.previewInstantiation({
            principal,
            playbook_id: playbookId,
            version_id:
              body.version_id !== undefined
                ? (body.version_id as string | number)
                : undefined,
            project_id: String(body.project_id ?? "proj_default"),
            variables: (body.variables as Record<string, unknown>) ?? {},
            mission_title_override: body.mission_title_override
              ? String(body.mission_title_override)
              : undefined,
            budget_limit_override:
              body.budget_limit_override !== undefined
                ? Number(body.budget_limit_override)
                : undefined
          });
          sendJson(res, 200, { preview });
          return;
        }

        const instantiated = ctx.playbooks.instantiatePlaybook({
          principal,
          playbook_id: playbookId,
          version_id:
            body.version_id !== undefined
              ? (body.version_id as string | number)
              : undefined,
          project_id: String(body.project_id ?? "proj_default"),
          workspace_id: body.workspace_id
            ? String(body.workspace_id)
            : undefined,
          variables: (body.variables as Record<string, unknown>) ?? {},
          mission_title_override: body.mission_title_override
            ? String(body.mission_title_override)
            : undefined,
          budget_limit_override:
            body.budget_limit_override !== undefined
              ? Number(body.budget_limit_override)
              : undefined,
          simulate_mid_transaction_failure: Boolean(
            body.simulate_mid_transaction_failure
          )
        });
        sendJson(res, 201, instantiated);
        return;
      }

      const singlePlaybookMatch = pathname.match(
        /^\/api\/v1\/playbooks\/([^/]+)$/
      );
      if (singlePlaybookMatch) {
        const playbookId = decodeURIComponent(singlePlaybookMatch[1]!);
        const projectId = urlObj.searchParams.get("project_id") ?? undefined;

        if (req.method === "GET") {
          const details = ctx.playbooks.getPlaybookDetails({
            principal,
            playbook_id: playbookId,
            project_id: projectId
          });
          sendJson(res, 200, details);
          return;
        }

        if (req.method === "PATCH") {
          const playbook = ctx.playbooks.updatePlaybookDraft({
            principal,
            playbook_id: playbookId,
            expected_draft_version_lock:
              body.expected_draft_version_lock !== undefined
                ? Number(body.expected_draft_version_lock)
                : undefined,
            title: body.title !== undefined ? String(body.title) : undefined,
            description:
              body.description !== undefined
                ? String(body.description)
                : undefined,
            category:
              body.category !== undefined ? String(body.category) : undefined,
            tags: Array.isArray(body.tags)
              ? (body.tags as string[])
              : undefined,
            visibility:
              body.visibility !== undefined
                ? (String(body.visibility) as Exclude<
                    PlaybookVisibility,
                    "built_in"
                  >)
                : undefined,
            definition: body.definition as PlaybookDefinition | undefined,
            target_version:
              body.target_version !== undefined
                ? (body.target_version as number | string)
                : undefined
          });
          sendJson(res, 200, { playbook });
          return;
        }
      }

      // ============================================================================
      // KOSMORA SCHEDULES & TRIGGERS HTTP API (/api/v1/schedules)
      // ============================================================================

      if (req.method === "POST" && pathname === "/api/v1/schedules/validate-cron") {
        const validation = validateCronExpression(
          String(body.cron_expression ?? ""),
          body.reference_iso ? String(body.reference_iso) : undefined
        );
        sendJson(res, 200, validation);
        return;
      }

      if (req.method === "POST" && pathname === "/api/v1/schedules/events") {
        const executions = ctx.schedules.processEventTrigger({
          principal,
          input: {
            tenant_id: principal.tenant_id,
            project_id: String(body.project_id ?? "proj_default"),
            actor_id: principal.user_id,
            event_topic: String(body.event_topic ?? ""),
            payload: (body.payload as Record<string, unknown>) ?? {},
            idempotency_key: body.idempotency_key
              ? String(body.idempotency_key)
              : undefined,
            now_iso: body.now_iso ? String(body.now_iso) : undefined
          }
        });
        sendJson(res, 200, { executions });
        return;
      }

      if (req.method === "POST" && pathname === "/api/v1/schedules/tick") {
        const executions = ctx.schedules.evaluateDueSchedulesTick({
          principal,
          project_id: body.project_id ? String(body.project_id) : undefined,
          now_iso: body.now_iso ? String(body.now_iso) : undefined
        });
        sendJson(res, 200, { executions });
        return;
      }

      if (pathname === "/api/v1/schedules") {
        if (req.method === "GET") {
          const schedules = ctx.schedules.listSchedules({
            principal,
            project_id: urlObj.searchParams.get("project_id") ?? undefined,
            playbook_id: urlObj.searchParams.get("playbook_id") ?? undefined,
            trigger_type: (urlObj.searchParams.get("trigger_type") ??
              undefined) as ScheduleTriggerType | undefined,
            status: (urlObj.searchParams.get("status") ?? undefined) as
              | ScheduleStatus
              | undefined
          });
          sendJson(res, 200, { schedules });
          return;
        }

        if (req.method === "POST") {
          const created = ctx.schedules.createSchedule({
            principal,
            input: {
              tenant_id: principal.tenant_id,
              project_id: String(body.project_id ?? "proj_default"),
              owner_id: principal.user_id,
              playbook_id: String(body.playbook_id ?? ""),
              playbook_version_number:
                body.playbook_version_number !== undefined &&
                body.playbook_version_number !== null
                  ? Number(body.playbook_version_number)
                  : null,
              title: String(body.title ?? ""),
              description: body.description ? String(body.description) : "",
              trigger_type: String(
                body.trigger_type ?? "cron"
              ) as ScheduleTriggerType,
              cron_expression:
                body.cron_expression !== undefined &&
                body.cron_expression !== null
                  ? String(body.cron_expression)
                  : null,
              interval_minutes:
                body.interval_minutes !== undefined &&
                body.interval_minutes !== null
                  ? Number(body.interval_minutes)
                  : null,
              one_time_run_at:
                body.one_time_run_at !== undefined &&
                body.one_time_run_at !== null
                  ? String(body.one_time_run_at)
                  : null,
              timezone: body.timezone ? String(body.timezone) : "UTC",
              event_topic:
                body.event_topic !== undefined && body.event_topic !== null
                  ? String(body.event_topic)
                  : null,
              event_filter_json:
                (body.event_filter_json as Record<
                  string,
                  string | number | boolean
                >) ?? {},
              default_variables_json:
                (body.default_variables_json as Record<
                  string,
                  string | number | boolean
                >) ?? {},
              variable_mappings_json: Array.isArray(body.variable_mappings_json)
                ? (body.variable_mappings_json as ScheduleVariableMapping[])
                : [],
              auto_start_mission:
                body.auto_start_mission !== undefined
                  ? Boolean(body.auto_start_mission)
                  : true,
              mission_priority: body.mission_priority
                ? (String(body.mission_priority) as MissionPriority)
                : "medium",
              mission_title_override: body.mission_title_override
                ? String(body.mission_title_override)
                : null,
              max_runs_per_day:
                body.max_runs_per_day !== undefined
                  ? Number(body.max_runs_per_day)
                  : undefined,
              max_concurrent_missions:
                body.max_concurrent_missions !== undefined
                  ? Number(body.max_concurrent_missions)
                  : undefined,
              daily_budget_limit:
                body.daily_budget_limit !== undefined
                  ? Number(body.daily_budget_limit)
                  : undefined,
              consecutive_failures_limit:
                body.consecutive_failures_limit !== undefined
                  ? Number(body.consecutive_failures_limit)
                  : undefined,
              deduplication_window_seconds:
                body.deduplication_window_seconds !== undefined
                  ? Number(body.deduplication_window_seconds)
                  : undefined,
              now_iso: body.now_iso ? String(body.now_iso) : undefined
            }
          });
          sendJson(res, 201, created);
          return;
        }
      }

      const scheduleActionMatch = pathname.match(
        /^\/api\/v1\/schedules\/([^/]+)\/(pause|resume|archive|rotate-secret|trigger|runs|audit)$/
      );
      if (scheduleActionMatch) {
        const scheduleId = decodeURIComponent(scheduleActionMatch[1]!);
        const action = scheduleActionMatch[2]!;

        if (req.method === "GET" && action === "runs") {
          const runs = ctx.schedules.listScheduleRuns({
            principal,
            schedule_id: scheduleId
          });
          sendJson(res, 200, { runs });
          return;
        }

        if (req.method === "GET" && action === "audit") {
          const events = ctx.schedules.listScheduleAuditEvents({
            principal,
            schedule_id: scheduleId
          });
          sendJson(res, 200, { events });
          return;
        }

        if (req.method === "POST" && action === "pause") {
          const schedule = ctx.schedules.pauseSchedule({
            principal,
            schedule_id: scheduleId,
            reason: body.reason ? String(body.reason) : undefined,
            now_iso: body.now_iso ? String(body.now_iso) : undefined
          });
          sendJson(res, 200, { schedule });
          return;
        }

        if (req.method === "POST" && action === "resume") {
          const schedule = ctx.schedules.resumeSchedule({
            principal,
            schedule_id: scheduleId,
            reset_daily_counters: Boolean(body.reset_daily_counters),
            now_iso: body.now_iso ? String(body.now_iso) : undefined
          });
          sendJson(res, 200, { schedule });
          return;
        }

        if (req.method === "POST" && action === "archive") {
          const schedule = ctx.schedules.archiveSchedule({
            principal,
            schedule_id: scheduleId,
            now_iso: body.now_iso ? String(body.now_iso) : undefined
          });
          sendJson(res, 200, { schedule });
          return;
        }

        if (req.method === "POST" && action === "rotate-secret") {
          const rotated = ctx.schedules.rotateWebhookSecret({
            principal,
            schedule_id: scheduleId,
            now_iso: body.now_iso ? String(body.now_iso) : undefined
          });
          sendJson(res, 200, rotated);
          return;
        }

        if (req.method === "POST" && action === "trigger") {
          const execution = ctx.schedules.triggerScheduleNow({
            principal,
            input: {
              schedule_id: scheduleId,
              actor_id: principal.user_id,
              trigger_source: "manual",
              idempotency_key: body.idempotency_key
                ? String(body.idempotency_key)
                : undefined,
              override_variables: body.override_variables as
                | Record<string, string | number | boolean>
                | undefined,
              payload: body.payload as Record<string, unknown> | undefined,
              now_iso: body.now_iso ? String(body.now_iso) : undefined
            }
          });
          sendJson(
            res,
            execution.run.status === "triggered" ? 201 : 200,
            execution
          );
          return;
        }
      }

      const singleScheduleMatch = pathname.match(
        /^\/api\/v1\/schedules\/([^/]+)$/
      );
      if (singleScheduleMatch) {
        const scheduleId = decodeURIComponent(singleScheduleMatch[1]!);
        if (req.method === "GET") {
          const schedule = ctx.schedules.getSchedule({
            principal,
            schedule_id: scheduleId,
            project_id: urlObj.searchParams.get("project_id") ?? undefined
          });
          const runs = ctx.schedules.listScheduleRuns({
            principal,
            schedule_id: scheduleId
          });
          const audit_events = ctx.schedules.listScheduleAuditEvents({
            principal,
            schedule_id: scheduleId
          });
          sendJson(res, 200, { schedule, runs, audit_events });
          return;
        }

        if (req.method === "PATCH") {
          const schedule = ctx.schedules.updateSchedule({
            principal,
            input: {
              schedule_id: scheduleId,
              actor_id: principal.user_id,
              expected_version: Number(body.expected_version ?? 1),
              title: body.title !== undefined ? String(body.title) : undefined,
              description:
                body.description !== undefined
                  ? String(body.description)
                  : undefined,
              playbook_version_number:
                body.playbook_version_number !== undefined
                  ? body.playbook_version_number === null
                    ? null
                    : Number(body.playbook_version_number)
                  : undefined,
              trigger_type:
                body.trigger_type !== undefined
                  ? (String(body.trigger_type) as ScheduleTriggerType)
                  : undefined,
              cron_expression:
                body.cron_expression !== undefined
                  ? body.cron_expression === null
                    ? null
                    : String(body.cron_expression)
                  : undefined,
              interval_minutes:
                body.interval_minutes !== undefined
                  ? body.interval_minutes === null
                    ? null
                    : Number(body.interval_minutes)
                  : undefined,
              one_time_run_at:
                body.one_time_run_at !== undefined
                  ? body.one_time_run_at === null
                    ? null
                    : String(body.one_time_run_at)
                  : undefined,
              timezone:
                body.timezone !== undefined ? String(body.timezone) : undefined,
              event_topic:
                body.event_topic !== undefined
                  ? body.event_topic === null
                    ? null
                    : String(body.event_topic)
                  : undefined,
              event_filter_json: body.event_filter_json as
                | Record<string, string | number | boolean>
                | undefined,
              default_variables_json: body.default_variables_json as
                | Record<string, string | number | boolean>
                | undefined,
              variable_mappings_json: body.variable_mappings_json as
                | ScheduleVariableMapping[]
                | undefined,
              auto_start_mission:
                body.auto_start_mission !== undefined
                  ? Boolean(body.auto_start_mission)
                  : undefined,
              mission_priority:
                body.mission_priority !== undefined
                  ? (String(body.mission_priority) as MissionPriority)
                  : undefined,
              mission_title_override:
                body.mission_title_override !== undefined
                  ? body.mission_title_override === null
                    ? null
                    : String(body.mission_title_override)
                  : undefined,
              max_runs_per_day:
                body.max_runs_per_day !== undefined
                  ? Number(body.max_runs_per_day)
                  : undefined,
              max_concurrent_missions:
                body.max_concurrent_missions !== undefined
                  ? Number(body.max_concurrent_missions)
                  : undefined,
              daily_budget_limit:
                body.daily_budget_limit !== undefined
                  ? Number(body.daily_budget_limit)
                  : undefined,
              consecutive_failures_limit:
                body.consecutive_failures_limit !== undefined
                  ? Number(body.consecutive_failures_limit)
                  : undefined,
              deduplication_window_seconds:
                body.deduplication_window_seconds !== undefined
                  ? Number(body.deduplication_window_seconds)
                  : undefined,
              now_iso: body.now_iso ? String(body.now_iso) : undefined
            }
          });
          sendJson(res, 200, { schedule });
          return;
        }
      }


      // ======================================================================
      // KOSMORA EVALUATIONS & QUALITY GATES ROUTES (/api/v1/evaluations/*)
      // ======================================================================
      if (pathname === "/api/v1/evaluations/suites") {
        if (req.method === "GET") {
          const suites = ctx.evaluations.listSuites({
            principal,
            project_id: urlObj.searchParams.get("project_id") ?? undefined,
            target_kind: (urlObj.searchParams.get("target_kind") as EvaluationTargetKind | null) ?? undefined,
            status: (urlObj.searchParams.get("status") as EvaluationSuiteStatus | null) ?? undefined,
            visibility: (urlObj.searchParams.get("visibility") as EvaluationSuiteVisibility | null) ?? undefined
          });
          sendJson(res, 200, { suites });
          return;
        }
        if (req.method === "POST") {
          const suite = ctx.evaluations.createSuite({
            principal,
            input: {
              project_id: String(body.project_id ?? "proj_default"),
              slug: String(body.slug ?? ""),
              title: String(body.title ?? ""),
              description: body.description ? String(body.description) : "",
              target_kind: body.target_kind as EvaluationTargetKind | undefined,
              visibility: body.visibility as Exclude<EvaluationSuiteVisibility, "built_in"> | undefined,
              passing_score_threshold:
                body.passing_score_threshold !== undefined
                  ? Number(body.passing_score_threshold)
                  : undefined,
              block_on_critical_criteria:
                body.block_on_critical_criteria !== undefined
                  ? Boolean(body.block_on_critical_criteria)
                  : undefined,
              criteria: (body.criteria as EvaluationCriterion[]) ?? [],
              golden_test_cases: (body.golden_test_cases as EvaluationGoldenTestCase[]) ?? []
            }
          });
          sendJson(res, 201, { suite });
          return;
        }
      }

      if (pathname === "/api/v1/evaluations/evaluate-mission" && req.method === "POST") {
        const run = ctx.evaluations.evaluateMission({
          principal,
          input: {
            suite_id: String(body.suite_id ?? ""),
            mission_id: String(body.mission_id ?? ""),
            baseline_run_id: body.baseline_run_id ? String(body.baseline_run_id) : undefined,
            override_artifact_content:
              body.override_artifact_content !== undefined
                ? String(body.override_artifact_content)
                : undefined
          }
        });
        sendJson(res, 201, { run });
        return;
      }

      if (pathname === "/api/v1/evaluations/benchmark-playbook" && req.method === "POST") {
        const run = ctx.evaluations.runPlaybookBenchmarkSuite({
          principal,
          input: {
            suite_id: String(body.suite_id ?? ""),
            playbook_id: String(body.playbook_id ?? ""),
            playbook_version_number:
              body.playbook_version_number !== undefined && body.playbook_version_number !== null
                ? Number(body.playbook_version_number)
                : undefined,
            project_id: String(body.project_id ?? "proj_default"),
            execute_missions:
              body.execute_missions !== undefined ? Boolean(body.execute_missions) : true,
            baseline_run_id: body.baseline_run_id ? String(body.baseline_run_id) : undefined,
            artifact_content_overrides_by_case_id:
              body.artifact_content_overrides_by_case_id as Record<string, string> | undefined
          }
        });
        sendJson(res, 201, { run });
        return;
      }

      if (pathname === "/api/v1/evaluations/runs" && req.method === "GET") {
        const runs = ctx.evaluations.listEvaluationRuns({
          principal,
          project_id: urlObj.searchParams.get("project_id") ?? undefined,
          suite_id: urlObj.searchParams.get("suite_id") ?? undefined,
          mission_id: urlObj.searchParams.get("mission_id") ?? undefined,
          playbook_id: urlObj.searchParams.get("playbook_id") ?? undefined,
          playbook_version_number: urlObj.searchParams.get("playbook_version_number")
            ? Number(urlObj.searchParams.get("playbook_version_number"))
            : undefined,
          verdict: (urlObj.searchParams.get("verdict") as EvaluationRunVerdict | null) ?? undefined
        });
        sendJson(res, 200, { runs });
        return;
      }

      const evalRunSingleMatch = pathname.match(/^\/api\/v1\/evaluations\/runs\/([^/]+)$/);
      if (evalRunSingleMatch && req.method === "GET") {
        const runId = decodeURIComponent(evalRunSingleMatch[1]!);
        const run = ctx.evaluations.getEvaluationRun({
          principal,
          run_id: runId
        });
        sendJson(res, 200, { run });
        return;
      }

      if (pathname === "/api/v1/evaluations/gates") {
        if (req.method === "GET") {
          const policies = ctx.evaluations.listQualityGatePolicies({
            principal,
            project_id: urlObj.searchParams.get("project_id") ?? undefined,
            playbook_id: urlObj.searchParams.get("playbook_id") ?? undefined
          });
          sendJson(res, 200, { policies });
          return;
        }
        if (req.method === "POST") {
          const policy = ctx.evaluations.upsertQualityGatePolicy({
            principal,
            input: {
              project_id: String(body.project_id ?? "proj_default"),
              playbook_id: String(body.playbook_id ?? ""),
              required_suite_ids: (body.required_suite_ids as string[]) ?? [],
              min_overall_score:
                body.min_overall_score !== undefined ? Number(body.min_overall_score) : undefined,
              allow_critical_failures:
                body.allow_critical_failures !== undefined
                  ? Boolean(body.allow_critical_failures)
                  : undefined,
              max_regression_drop:
                body.max_regression_drop !== undefined
                  ? Number(body.max_regression_drop)
                  : undefined,
              enforce_on_publish:
                body.enforce_on_publish !== undefined
                  ? Boolean(body.enforce_on_publish)
                  : undefined,
              enforce_on_schedule_activation:
                body.enforce_on_schedule_activation !== undefined
                  ? Boolean(body.enforce_on_schedule_activation)
                  : undefined,
              status: body.status as "active" | "disabled" | undefined
            }
          });
          sendJson(res, 201, { policy });
          return;
        }
      }

      if (pathname === "/api/v1/evaluations/gates/check" && req.method === "POST") {
        const result = ctx.evaluations.checkQualityGate({
          principal,
          project_id: String(body.project_id ?? "proj_default"),
          playbook_id: String(body.playbook_id ?? ""),
          playbook_version_number:
            body.playbook_version_number !== undefined && body.playbook_version_number !== null
              ? Number(body.playbook_version_number)
              : undefined,
          throw_on_blocked: Boolean(body.throw_on_blocked)
        });
        sendJson(res, result.allowed ? 200 : 422, { gate_result: result });
        return;
      }

      const evalSuiteActionMatch = pathname.match(
        /^\/api\/v1\/evaluations\/suites\/([^/]+)\/(archive|audit)$/
      );
      if (evalSuiteActionMatch) {
        const suiteId = decodeURIComponent(evalSuiteActionMatch[1]!);
        const action = evalSuiteActionMatch[2]!;
        if (action === "archive" && req.method === "POST") {
          const suite = ctx.evaluations.archiveSuite({
            principal,
            suite_id: suiteId
          });
          sendJson(res, 200, { suite });
          return;
        }
        if (action === "audit" && req.method === "GET") {
          const events = ctx.evaluations.listAuditEvents({
            principal,
            suite_id: suiteId
          });
          sendJson(res, 200, { events });
          return;
        }
      }

      const evalSuiteSingleMatch = pathname.match(/^\/api\/v1\/evaluations\/suites\/([^/]+)$/);
      if (evalSuiteSingleMatch) {
        const suiteId = decodeURIComponent(evalSuiteSingleMatch[1]!);
        if (req.method === "GET") {
          const suite = ctx.evaluations.getSuite({
            principal,
            suite_id: suiteId,
            project_id: urlObj.searchParams.get("project_id") ?? undefined
          });
          const runs = ctx.evaluations.listEvaluationRuns({
            principal,
            suite_id: suiteId
          });
          const audit_events = ctx.evaluations.listAuditEvents({
            principal,
            suite_id: suiteId
          });
          sendJson(res, 200, { suite, runs, audit_events });
          return;
        }
        if (req.method === "PATCH") {
          const suite = ctx.evaluations.updateSuite({
            principal,
            suite_id: suiteId,
            input: {
              expected_version:
                body.expected_version !== undefined
                  ? Number(body.expected_version)
                  : undefined,
              title: body.title !== undefined ? String(body.title) : undefined,
              description:
                body.description !== undefined ? String(body.description) : undefined,
              passing_score_threshold:
                body.passing_score_threshold !== undefined
                  ? Number(body.passing_score_threshold)
                  : undefined,
              block_on_critical_criteria:
                body.block_on_critical_criteria !== undefined
                  ? Boolean(body.block_on_critical_criteria)
                  : undefined,
              criteria: body.criteria as EvaluationCriterion[] | undefined,
              golden_test_cases: body.golden_test_cases as
                | EvaluationGoldenTestCase[]
                | undefined,
              status: body.status as EvaluationSuiteStatus | undefined
            }
          });
          sendJson(res, 200, { suite });
          return;
        }
      }


      // =======================================================================
      // Kosmora Knowledge Vault & Context Connectors API Routes (/api/v1/knowledge-vault...)
      // =======================================================================

      if (pathname === "/api/v1/knowledge-vault/collections") {
        if (req.method === "GET") {
          const collections = ctx.knowledgeVault.listCollections(principal, {
            project_id: urlObj.searchParams.get("project_id") ?? undefined,
            category: urlObj.searchParams.get("category") ?? undefined,
            status: urlObj.searchParams.get("status") ?? undefined,
            visibility: urlObj.searchParams.get("visibility") ?? undefined
          });
          sendJson(res, 200, { collections });
          return;
        }
        if (req.method === "POST") {
          const collection = ctx.knowledgeVault.createCollection(principal, {
            project_id: String(body.project_id ?? "proj_default"),
            slug: String(body.slug ?? ""),
            title: String(body.title ?? ""),
            description: body.description !== undefined ? String(body.description) : undefined,
            category: body.category !== undefined ? String(body.category) : undefined,
            visibility: body.visibility as Exclude<KnowledgeCollectionVisibility, "built_in"> | undefined,
            chunking_strategy: body.chunking_strategy as KnowledgeChunkingStrategy | undefined,
            chunk_size_chars: body.chunk_size_chars !== undefined ? Number(body.chunk_size_chars) : undefined,
            chunk_overlap_chars: body.chunk_overlap_chars !== undefined ? Number(body.chunk_overlap_chars) : undefined,
            redact_secrets_on_ingest:
              body.redact_secrets_on_ingest !== undefined
                ? Boolean(body.redact_secrets_on_ingest)
                : undefined
          });
          sendJson(res, 201, { collection });
          return;
        }
      }

      if (pathname === "/api/v1/knowledge-vault/documents" && req.method === "POST") {
        const result = ctx.knowledgeVault.ingestDocument(principal, {
          collection_id: String(body.collection_id ?? ""),
          project_id: String(body.project_id ?? "proj_default"),
          title: String(body.title ?? ""),
          source_type: body.source_type as KnowledgeDocumentSourceType | undefined,
          source_uri: body.source_uri !== undefined ? String(body.source_uri) : undefined,
          content: String(body.content ?? ""),
          tags: Array.isArray(body.tags) ? (body.tags as string[]) : undefined,
          quarantine_on_injection:
            body.quarantine_on_injection !== undefined
              ? Boolean(body.quarantine_on_injection)
              : undefined
        });
        sendJson(res, 201, result);
        return;
      }

      const kvDocSingleMatch = pathname.match(/^\/api\/v1\/knowledge-vault\/documents\/([^/]+)$/);
      if (kvDocSingleMatch && req.method === "GET") {
        const documentId = decodeURIComponent(kvDocSingleMatch[1]!);
        const result = ctx.knowledgeVault.getDocumentWithChunks(principal, documentId);
        sendJson(res, 200, result);
        return;
      }

      if (pathname === "/api/v1/knowledge-vault/query" && req.method === "POST") {
        const result = ctx.knowledgeVault.queryKnowledge(principal, {
          project_id: String(body.project_id ?? "proj_default"),
          collection_ids: Array.isArray(body.collection_ids)
            ? (body.collection_ids as string[])
            : undefined,
          query: String(body.query ?? ""),
          tags: Array.isArray(body.tags) ? (body.tags as string[]) : undefined,
          top_k: body.top_k !== undefined ? Number(body.top_k) : undefined,
          min_relevance_score:
            body.min_relevance_score !== undefined ? Number(body.min_relevance_score) : undefined
        });
        sendJson(res, 200, { result });
        return;
      }

      if (pathname === "/api/v1/knowledge-vault/bindings") {
        if (req.method === "GET") {
          const missionId = String(urlObj.searchParams.get("mission_id") ?? "");
          const bindings = ctx.knowledgeVault.listMissionBindings(principal, missionId);
          sendJson(res, 200, { bindings });
          return;
        }
        if (req.method === "POST") {
          const binding = ctx.knowledgeVault.bindCollectionToMission(principal, {
            mission_id: String(body.mission_id ?? ""),
            collection_id: String(body.collection_id ?? ""),
            project_id: String(body.project_id ?? "proj_default"),
            top_k: body.top_k !== undefined ? Number(body.top_k) : undefined,
            min_relevance_score:
              body.min_relevance_score !== undefined ? Number(body.min_relevance_score) : undefined,
            mandatory_citation:
              body.mandatory_citation !== undefined ? Boolean(body.mandatory_citation) : undefined
          });
          sendJson(res, 201, { binding });
          return;
        }
      }

      if (pathname === "/api/v1/knowledge-vault/ground-mission" && req.method === "POST") {
        const grounded = ctx.knowledgeVault.groundMissionWithKnowledge(principal, {
          mission_id: String(body.mission_id ?? ""),
          project_id: String(body.project_id ?? "proj_default"),
          custom_query: body.custom_query !== undefined ? String(body.custom_query) : undefined
        });
        sendJson(res, 200, grounded);
        return;
      }

      if (pathname === "/api/v1/knowledge-vault/verify-citations" && req.method === "POST") {
        const report = ctx.knowledgeVault.verifyMissionArtifactCitations(principal, {
          mission_id: String(body.mission_id ?? ""),
          artifact_id: body.artifact_id !== undefined ? String(body.artifact_id) : undefined,
          project_id: String(body.project_id ?? "proj_default")
        });
        sendJson(res, report.passed ? 200 : 422, { report });
        return;
      }

      const kvCollectionActionMatch = pathname.match(
        /^\/api\/v1\/knowledge-vault\/collections\/([^/]+)\/(archive|audit|documents)$/
      );
      if (kvCollectionActionMatch) {
        const collectionId = decodeURIComponent(kvCollectionActionMatch[1]!);
        const action = kvCollectionActionMatch[2]!;
        if (action === "archive" && req.method === "POST") {
          const collection = ctx.knowledgeVault.archiveCollection(principal, collectionId);
          sendJson(res, 200, { collection });
          return;
        }
        if (action === "audit" && req.method === "GET") {
          const events = ctx.knowledgeVault.listAuditEvents(principal, collectionId);
          sendJson(res, 200, { events });
          return;
        }
        if (action === "documents" && req.method === "GET") {
          const status = (urlObj.searchParams.get("status") as KnowledgeDocumentStatus | null) ?? undefined;
          const documents = ctx.knowledgeVault.listDocuments(principal, collectionId, status);
          sendJson(res, 200, { documents });
          return;
        }
      }

      const kvCollectionSingleMatch = pathname.match(
        /^\/api\/v1\/knowledge-vault\/collections\/([^/]+)$/
      );
      if (kvCollectionSingleMatch) {
        const collectionId = decodeURIComponent(kvCollectionSingleMatch[1]!);
        if (req.method === "GET") {
          const collection = ctx.knowledgeVault.getCollection(principal, collectionId);
          const documents = ctx.knowledgeVault.listDocuments(principal, collectionId);
          const audit_events = ctx.knowledgeVault.listAuditEvents(principal, collectionId);
          sendJson(res, 200, { collection, documents, audit_events });
          return;
        }
        if (req.method === "PATCH") {
          const collection = ctx.knowledgeVault.updateCollection(principal, collectionId, {
            expected_version:
              body.expected_version !== undefined ? Number(body.expected_version) : undefined,
            title: body.title !== undefined ? String(body.title) : undefined,
            description: body.description !== undefined ? String(body.description) : undefined,
            category: body.category !== undefined ? String(body.category) : undefined,
            chunking_strategy: body.chunking_strategy as KnowledgeChunkingStrategy | undefined,
            chunk_size_chars:
              body.chunk_size_chars !== undefined ? Number(body.chunk_size_chars) : undefined,
            chunk_overlap_chars:
              body.chunk_overlap_chars !== undefined ? Number(body.chunk_overlap_chars) : undefined,
            redact_secrets_on_ingest:
              body.redact_secrets_on_ingest !== undefined
                ? Boolean(body.redact_secrets_on_ingest)
                : undefined
          });
          sendJson(res, 200, { collection });
          return;
        }
      }

      sendJson(res, 404, { error: "NOT_FOUND", path: pathname });
    } catch (err) {
      if (err instanceof KosmoraKnowledgeVaultError) {
        sendJson(res, err.statusCode, {
          error: err.code,
          message: err.message
        });
        return;
      }
      if (err instanceof CanvasVersionConflictError) {
        sendJson(res, 409, {
          error: "CANVAS_VERSION_CONFLICT",
          artifact_id: err.tab_id,
          expected_version: err.expected_version,
          actual_version: err.actual_version,
          message: err.message
        });
        return;
      }
      if (err instanceof EvaluationConcurrencyConflictError) {
        sendJson(res, 409, {
          error: "EVALUATION_VERSION_CONFLICT",
          entity_id: err.entity_id,
          expected_version: err.expected_version,
          actual_version: err.actual_version,
          message: err.message
        });
        return;
      }
      if (err instanceof QualityGateBlockedError) {
        sendJson(res, 422, {
          error: "QUALITY_GATE_BLOCKED",
          gate_result: err.gateResult,
          message: err.message
        });
        return;
      }
      if (
        err instanceof EvaluationSuiteNotFoundError ||
        err instanceof EvaluationRunNotFoundError
      ) {
        sendJson(res, 404, {
          error: "NOT_FOUND",
          message: err.message
        });
        return;
      }
      if (err instanceof EvaluationAccessDeniedError) {
        sendJson(res, 403, {
          error: "FORBIDDEN",
          message: err.message
        });
        return;
      }
      if (err instanceof EvaluationValidationError) {
        sendJson(res, 400, {
          error: err.name,
          message: err.message
        });
        return;
      }
      if (err instanceof ScheduleWebhookSignatureError) {
        sendJson(res, 401, {
          error: "INVALID_WEBHOOK_SIGNATURE",
          message: err.message
        });
        return;
      }
      if (err instanceof ScheduleConcurrencyConflictError) {
        sendJson(res, 409, {
          error: "SCHEDULE_VERSION_CONFLICT",
          message: err.message
        });
        return;
      }
      if (err instanceof ScheduleNotFoundError) {
        sendJson(res, 404, {
          error: "NOT_FOUND",
          message: err.message
        });
        return;
      }
      if (err instanceof ScheduleAccessDeniedError) {
        sendJson(res, 403, {
          error: "FORBIDDEN",
          message: err.message
        });
        return;
      }
      if (err instanceof ScheduleValidationError) {
        sendJson(res, 400, {
          error: err.name,
          message: err.message
        });
        return;
      }
      if (err instanceof PlaybookVersionConflictError) {
        sendJson(res, 409, {
          error: "PLAYBOOK_VERSION_CONFLICT",
          playbook_id: err.playbook_id,
          expected_version: err.expected_version,
          actual_version: err.actual_version,
          message: err.message
        });
        return;
      }
      if (err instanceof PlaybookImmutableVersionError) {
        sendJson(res, 409, {
          error: "PLAYBOOK_IMMUTABLE_VERSION",
          message: err.message
        });
        return;
      }
      if (err instanceof PlaybookChecksumMismatchError) {
        sendJson(res, 422, {
          error: "PLAYBOOK_CHECKSUM_MISMATCH",
          playbook_id: err.playbook_id,
          version_number: err.version_number,
          expected_checksum: err.expected_checksum,
          actual_checksum: err.actual_checksum,
          message: err.message
        });
        return;
      }
      if (err instanceof PlaybookNotFoundError) {
        sendJson(res, 404, {
          error: "NOT_FOUND",
          message: err.message
        });
        return;
      }
      if (err instanceof PlaybookAccessDeniedError) {
        sendJson(res, 403, {
          error: "FORBIDDEN",
          message: err.message
        });
        return;
      }
      if (
        err instanceof PlaybookVariableValidationError ||
        err instanceof PlaybookConditionSyntaxError ||
        err instanceof PlaybookDependencyCycleError ||
        err instanceof PlaybookBudgetExceededError ||
        err instanceof PlaybookValidationError
      ) {
        sendJson(res, 400, {
          error: err.name,
          message: err.message
        });
        return;
      }
      if (err instanceof MissionVersionConflictError) {
        sendJson(res, 409, {
          error: "MISSION_VERSION_CONFLICT",
          entity_type: err.entity_type,
          entity_id: err.entity_id,
          expected_version: err.expected_version,
          actual_version: err.actual_version,
          message: err.message
        });
        return;
      }
      if (err instanceof MissionNotFoundError) {
        sendJson(res, 404, {
          error: "NOT_FOUND",
          message: err.message
        });
        return;
      }
      if (err instanceof MissionAccessDeniedError) {
        sendJson(res, 403, {
          error: "FORBIDDEN",
          message: err.message
        });
        return;
      }
      if (
        err instanceof MissionDependencyCycleError ||
        err instanceof MissionRoleToolViolationError ||
        err instanceof MissionBudgetExceededError ||
        err instanceof MissionValidationError
      ) {
        sendJson(res, 400, {
          error: err.name,
          message: err.message
        });
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      const isForbidden = /denied|unauthorized|forbidden|permission/i.test(message);
      sendJson(res, isForbidden ? 403 : 400, {
        error: isForbidden ? "FORBIDDEN" : "BAD_REQUEST",
        message
      });
    }
  });
}

export { CanvasVersionConflictError };
