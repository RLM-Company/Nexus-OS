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
  return {
    autonomy: new KosmoraAutonomyEngine(),
    canvas: new KosmoraCanvasEngine(),
    skills: new KosmoraSkillsBus(),
    graph: new KosmoraIntelligenceGraph(),
    security: new KosmoraEnterpriseSecurityEngine(),
    store: new KosmoraRuntimeStore(dbPath),
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

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
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

      sendJson(res, 404, { error: "NOT_FOUND", path: pathname });
    } catch (err) {
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
