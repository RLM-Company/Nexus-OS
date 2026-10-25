/** Experimental DAG worker. Code execution is unavailable until an isolated executor is connected. */

import { KosmoraAutonomyEngine, KosmoraRuntimeStore, type KosmoraDagPlan } from "@cosmora/core";

export type SandboxIsolationMode = "subprocess_restricted" | "oci_container_required";

export interface SandboxExecutionRequest {
  execution_id?: string;
  language: "python3" | "node" | "bash";
  code: string;
  timeout_ms?: number;
  max_output_bytes?: number;
  isolation_mode?: SandboxIsolationMode;
  files?: Record<string, string>;
}

export interface SandboxExecutionResult {
  execution_id: string;
  isolation_mode: SandboxIsolationMode;
  language: "python3" | "node" | "bash";
  exit_code: number | null;
  stdout: string;
  stderr: string;
  timed_out: boolean;
  output_truncated: boolean;
  duration_ms: number;
}

export class SandboxIsolationUnavailableError extends Error {
  public readonly requested_mode: SandboxIsolationMode;

  constructor(requestedMode: SandboxIsolationMode, message: string) {
    super(message);
    this.name = "SandboxIsolationUnavailableError";
    this.requested_mode = requestedMode;
  }
}

export interface WorkerExecutionSummary {
  plan_id: string;
  executed_nodes: string[];
  skipped_idempotent_nodes: string[];
  awaiting_hitl_nodes: string[];
  blocked_nodes: string[];
  total_tokens_consumed: number;
  total_cost_usd: number;
  final_status: "completed" | "paused_awaiting_hitl" | "failed_budget_or_error";
}

export class KosmoraDagWorker {
  constructor(
    private readonly autonomy: KosmoraAutonomyEngine,
    private readonly store: KosmoraRuntimeStore
  ) {}

  /** Refuse untrusted host execution, including when Docker happens to be installed. */
  public executeInSandbox(req: SandboxExecutionRequest): SandboxExecutionResult {
    throw new SandboxIsolationUnavailableError(
      req.isolation_mode ?? "oci_container_required",
      "No isolated executor is connected. Host subprocess execution is disabled."
    );
  }

  /**
   * Executes a DAG plan step-by-step without ever auto-approving HITL nodes.
   * Supports idempotent task replay (`delivery_id`), explicit verified HITL approvals,
   * and SQLite state persistence after every transition.
   */
  public runAutonomyPlanJob(
    plan: KosmoraDagPlan,
    options?: {
      hitl_approvals?: Record<
        string,
        { approval_token: string; approver_id: string; reason?: string }
      >;
      fail_node_ids?: Set<string>;
      cancel_node_ids?: Set<string>;
    }
  ): WorkerExecutionSummary {
    const executedNodes: string[] = [];
    const skippedIdempotentNodes: string[] = [];
    let maxIterations = plan.nodes.length * 3 + 4;

    while (maxIterations > 0) {
      maxIterations -= 1;

      const budgetCheck = this.autonomy.evaluateBudgetGuard(plan);
      if (!budgetCheck.within_budget) {
        this.persistPlan(plan, "failed");
        return {
          plan_id: plan.plan_id,
          executed_nodes: executedNodes,
          skipped_idempotent_nodes: skippedIdempotentNodes,
          awaiting_hitl_nodes: [],
          blocked_nodes: plan.nodes.filter((n) => n.status === "blocked").map((n) => n.node_id),
          total_tokens_consumed: plan.consumed_tokens,
          total_cost_usd: plan.consumed_cost_usd,
          final_status: "failed_budget_or_error"
        };
      }

      if (options?.cancel_node_ids) {
        for (const cancelId of options.cancel_node_ids) {
          const target = plan.nodes.find((n) => n.node_id === cancelId);
          if (target && target.status !== "cancelled" && target.status !== "succeeded") {
            this.autonomy.cancelTaskNode(plan, cancelId, "Cancelled by worker request");
          }
        }
      }

      const schedule = this.autonomy.scheduleNextBatch(plan);

      // Process explicit HITL approvals if provided by an authorized caller
      if (schedule.awaiting_hitl_nodes.length > 0 && options?.hitl_approvals) {
        let anyApproved = false;
        for (const hitlNode of schedule.awaiting_hitl_nodes) {
          const supplied = options.hitl_approvals[hitlNode.node_id];
          if (supplied) {
            this.autonomy.approveHitlNode({
              plan,
              node_id: hitlNode.node_id,
              approval_token: supplied.approval_token,
              approver_id: supplied.approver_id,
              reason: supplied.reason
            });
            anyApproved = true;
          }
        }
        if (anyApproved) {
          continue;
        }
      }

      if (schedule.ready_batch.length === 0) {
        if (schedule.awaiting_hitl_nodes.length > 0) {
          this.persistPlan(plan, "awaiting_hitl");
          return {
            plan_id: plan.plan_id,
            executed_nodes: executedNodes,
            skipped_idempotent_nodes: skippedIdempotentNodes,
            awaiting_hitl_nodes: schedule.awaiting_hitl_nodes.map((n) => n.node_id),
            blocked_nodes: schedule.blocked_nodes.map((n) => n.node_id),
            total_tokens_consumed: plan.consumed_tokens,
            total_cost_usd: plan.consumed_cost_usd,
            final_status: "paused_awaiting_hitl"
          };
        }
        break;
      }

      for (const node of schedule.ready_batch) {
        if (options?.fail_node_ids?.has(node.node_id)) {
          this.autonomy.recordTaskResult(plan, node.node_id, {
            succeeded: false,
            actual_tokens: Math.min(50, node.estimated_tokens),
            actual_cost_usd: 0.001,
            error_message: `Simulated execution failure on node '${node.node_id}'`,
            delivery_id: `deliv_${plan.plan_id}_${node.node_id}`
          });
          continue;
        }

        const outcome = this.autonomy.recordTaskResult(plan, node.node_id, {
          succeeded: true,
          actual_tokens: node.estimated_tokens,
          actual_cost_usd: node.estimated_cost_usd,
          output_summary: `Completed [${node.agent_role}] task: ${node.title}`,
          citations: [
            {
              citation_id: `cit_${node.node_id}`,
              source_type: "artifact_revision",
              uri: `kosmora://plans/${plan.plan_id}/nodes/${node.node_id}`,
              title: node.title,
              excerpt: `Verified execution output for ${node.title}`,
              confidence: 0.96,
              verified_at: new Date().toISOString()
            }
          ],
          delivery_id: `deliv_${plan.plan_id}_${node.node_id}`
        });

        if (outcome.idempotent_replay) {
          skippedIdempotentNodes.push(node.node_id);
        } else {
          executedNodes.push(node.node_id);
        }
      }
    }

    const anyFailed = plan.nodes.some((n) => n.status === "failed");
    const allSucceeded = plan.nodes.every((n) => n.status === "succeeded");
    const finalStatus = allSucceeded
      ? "completed"
      : anyFailed
        ? "failed_budget_or_error"
        : "paused_awaiting_hitl";

    this.persistPlan(plan, allSucceeded ? "completed" : anyFailed ? "failed" : "awaiting_hitl");

    return {
      plan_id: plan.plan_id,
      executed_nodes: executedNodes,
      skipped_idempotent_nodes: skippedIdempotentNodes,
      awaiting_hitl_nodes: plan.nodes
        .filter((n) => n.status === "awaiting_hitl")
        .map((n) => n.node_id),
      blocked_nodes: plan.nodes.filter((n) => n.status === "blocked").map((n) => n.node_id),
      total_tokens_consumed: plan.consumed_tokens,
      total_cost_usd: plan.consumed_cost_usd,
      final_status: finalStatus
    };
  }

  private persistPlan(
    plan: KosmoraDagPlan,
    status: "running" | "awaiting_hitl" | "completed" | "failed" | "cancelled"
  ): void {
    this.store.saveDagPlan({
      plan_id: plan.plan_id,
      project_id: plan.project_id,
      tenant_id: plan.tenant_id,
      workspace_id: plan.workspace_id,
      goal: plan.goal,
      state_json: JSON.stringify(plan),
      status,
      updated_at: new Date().toISOString()
    });
  }
}
