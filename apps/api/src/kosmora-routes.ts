/**
 * Kosmora Unified Control Plane API Router (Fastify-Compatible)
 * Exposes all 5 architectural stages (F001-F160) with real RBAC/RLS verification,
 * token-based HITL approval, optimistic concurrency Canvas revisions, real binary exports,
 * project-isolated knowledge graph search, and SQLite persistence.
 */

import {
  CanvasVersionConflictError,
  KosmoraAutonomyEngine,
  KosmoraCanvasEngine,
  KosmoraEnterpriseSecurityEngine,
  KosmoraIntelligenceGraph,
  KosmoraRuntimeStore,
  KosmoraSkillsBus,
  type CanvasArtifactKind,
  type CanvasArtifactRevision,
  type CanvasBlock,
  type HitlApprovalRequest,
  type KosmoraDagPlan,
  type TenantPrincipal
} from "@cosmora/core";

export interface KosmoraControlPlaneContext {
  autonomy: KosmoraAutonomyEngine;
  canvas: KosmoraCanvasEngine;
  skills: KosmoraSkillsBus;
  graph: KosmoraIntelligenceGraph;
  security: KosmoraEnterpriseSecurityEngine;
  store: KosmoraRuntimeStore;
}

export function createKosmoraControlPlane(dbPath = ":memory:"): KosmoraControlPlaneContext {
  return {
    autonomy: new KosmoraAutonomyEngine(),
    canvas: new KosmoraCanvasEngine(),
    skills: new KosmoraSkillsBus(),
    graph: new KosmoraIntelligenceGraph(),
    security: new KosmoraEnterpriseSecurityEngine(),
    store: new KosmoraRuntimeStore(dbPath)
  };
}

export class KosmoraApiController {
  constructor(private readonly ctx: KosmoraControlPlaneContext) {}

  /**
   * POST /api/v1/kosmora/dag/compile-and-step
   * Compiles a DAG plan, enforces RBAC/RLS, executes ready nodes without auto-approving HITL,
   * and persists the DAG state to SQLite.
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
        "planner" | "researcher" | "coder" | "analyst" | "critic" | "verifier" | "synthesizer";
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
      status: schedule.awaiting_hitl_nodes.length > 0 ? "awaiting_hitl" : "running",
      updated_at: new Date().toISOString()
    });

    return {
      plan,
      ready_batch: schedule.ready_batch.map((n) => n.node_id),
      budget_status: budgetStatus
    };
  }

  /**
   * POST /api/v1/kosmora/dag/hitl/request
   * Issues a pending HITL approval request bound to a specific plan, node, and action scope.
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
    return this.ctx.autonomy.requestHitlApproval(params.plan, params.node_id, params.action_scope);
  }

  /**
   * POST /api/v1/kosmora/dag/hitl/approve
   * Verifies `dag:approve_hitl` permission and approves a pending HITL request using its approval token.
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
      ...(params.reason !== undefined ? { reason: params.reason } : {})
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
   * Commits an immutable Canvas revision with optimistic concurrency check (`expected_version`)
   * and generates real binary exports (`.xlsx`, `.pdf`, or `.md`).
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
      ...(params.expected_version !== undefined
        ? { expected_version: params.expected_version }
        : {})
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

    const markdownExport = this.ctx.canvas.exportToMarkdown(params.artifact_id, revision.version);

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
        mime_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
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
      ...(binaryExport ? { binary_export: binaryExport } : {})
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

    return this.ctx.graph.searchProjectMemory(params.project_id, params.query, params.top_k ?? 5, {
      workspace_id: params.workspace_id
    });
  }
}

export { CanvasVersionConflictError };
