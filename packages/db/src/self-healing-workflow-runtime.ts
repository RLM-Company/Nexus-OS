import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  evaluateWorkflowCriticCheck,
  type CriticEvaluationResult
} from "./workflow-dag-templates-and-critic.ts";
import type { PortableWorkflowDefinitionPackage } from "./workflow-portability-and-zip-exporter.ts";

export const MAX_REMEDIAL_ATTEMPTS_PER_STEP = 3;

export type StepExecutionStatus =
  | "pending"
  | "executing"
  | "completed"
  | "self_healing"
  | "failed"
  | "cancelled";

export interface StepCheckpointState {
  stepId: string;
  attempt: number;
  status: StepExecutionStatus;
  outputContent?: string;
  remedialDirective?: string;
  criticFeedback?: CriticEvaluationResult;
  updatedAt: string;
}

export interface WorkflowRunStateSnapshot {
  runId: string;
  workflowId: string;
  ownerId: string;
  projectId: string;
  overallStatus: "running" | "completed" | "failed" | "cancelled";
  stepStates: Record<string, StepCheckpointState>;
  producedArtifacts: Record<string, string>;
  totalAttemptsUsed: number;
  healedStepCount: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Self-Healing Work DAG Runtime with in-flight remediation and transactional checkpoints.
 *
 * Guarantees:
 * 1. Strictly enforces the <= 3 attempts per step ceiling from PR #428.
 * 2. When a step fails or Critic requires revisions, generates in-flight remedial directives
 *    and switches the step to 'self_healing'.
 * 3. Persists step outputs and artifacts to SQLite `kosmora_workflow_checkpoints` so interrupted
 *    runs resume without re-running completed steps.
 */
export class SelfHealingWorkflowRuntime {
  constructor(private readonly sqlite: DatabaseSync) {
    this.ensureSchema();
  }

  ensureSchema(): void {
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS kosmora_workflow_checkpoints (
        run_id TEXT NOT NULL,
        step_id TEXT NOT NULL,
        attempt INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL,
        output_content TEXT,
        state_json TEXT NOT NULL DEFAULT '{}',
        updated_at TEXT NOT NULL,
        PRIMARY KEY (run_id, step_id)
      );
      CREATE INDEX IF NOT EXISTS kosmora_workflow_checkpoints_run_idx
        ON kosmora_workflow_checkpoints(run_id, updated_at DESC);
    `);
  }

  initializeRunState(options: {
    runId: string;
    workflowId: string;
    ownerId: string;
    projectId: string;
    nodeIds: string[];
  }): WorkflowRunStateSnapshot {
    const now = new Date().toISOString();
    const stepStates: Record<string, StepCheckpointState> = {};

    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const stmt = this.sqlite.prepare(
        `INSERT INTO kosmora_workflow_checkpoints (run_id, step_id, attempt, status, output_content, state_json, updated_at)
         VALUES (?, ?, 1, 'pending', NULL, '{}', ?)
         ON CONFLICT(run_id, step_id) DO UPDATE SET
           status = 'pending',
           updated_at = excluded.updated_at`
      );

      for (const nid of options.nodeIds) {
        stepStates[nid] = {
          stepId: nid,
          attempt: 1,
          status: "pending",
          updatedAt: now
        };
        stmt.run(options.runId, nid, now);
      }

      this.sqlite.exec("COMMIT");
    } catch (err) {
      try {
        this.sqlite.exec("ROLLBACK");
      } catch {
        // ignore
      }
      throw err;
    }

    return {
      runId: options.runId,
      workflowId: options.workflowId,
      ownerId: options.ownerId,
      projectId: options.projectId,
      overallStatus: "running",
      stepStates,
      producedArtifacts: {},
      totalAttemptsUsed: options.nodeIds.length,
      healedStepCount: 0,
      createdAt: now,
      updatedAt: now
    };
  }

  saveStepCheckpoint(
    runId: string,
    state: StepCheckpointState
  ): void {
    const now = new Date().toISOString();
    this.sqlite
      .prepare(
        `INSERT INTO kosmora_workflow_checkpoints (
          run_id, step_id, attempt, status, output_content, state_json, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(run_id, step_id) DO UPDATE SET
          attempt = excluded.attempt,
          status = excluded.status,
          output_content = excluded.output_content,
          state_json = excluded.state_json,
          updated_at = excluded.updated_at`
      )
      .run(
        runId,
        state.stepId,
        state.attempt,
        state.status,
        state.outputContent ?? null,
        JSON.stringify({
          remedialDirective: state.remedialDirective,
          criticFeedback: state.criticFeedback
        }),
        now
      );
  }

  loadRunCheckpoints(runId: string): Record<string, StepCheckpointState> {
    const rows = this.sqlite
      .prepare(
        "SELECT step_id, attempt, status, output_content, state_json, updated_at FROM kosmora_workflow_checkpoints WHERE run_id = ?"
      )
      .all(runId) as Array<{
      step_id: string;
      attempt: number;
      status: StepExecutionStatus;
      output_content: string | null;
      state_json: string;
      updated_at: string;
    }>;

    const result: Record<string, StepCheckpointState> = {};
    for (const r of rows) {
      let extra: { remedialDirective?: string; criticFeedback?: CriticEvaluationResult } = {};
      try {
        extra = JSON.parse(r.state_json);
      } catch {
        extra = {};
      }
      result[r.step_id] = {
        stepId: r.step_id,
        attempt: r.attempt,
        status: r.status,
        outputContent: r.output_content ?? undefined,
        remedialDirective: extra.remedialDirective,
        criticFeedback: extra.criticFeedback,
        updatedAt: r.updated_at
      };
    }
    return result;
  }

  /**
   * Executes a workflow DAG step with automated self-healing.
   * If step execution throws or fails validation, analyzes the issue and re-attempts
   * with a remedial directive up to MAX_REMEDIAL_ATTEMPTS_PER_STEP (3).
   */
  async executeStepWithSelfHealing(options: {
    runId: string;
    stepId: string;
    executeStepFn: (attempt: number, remedialDirective?: string) => Promise<{ output: string; artifactName?: string }>;
    validateOutput?: (output: string) => { valid: boolean; defectMessage?: string };
  }): Promise<{ status: "completed" | "failed"; output: string; attemptsUsed: number; wasHealed: boolean }> {
    const existing = this.loadRunCheckpoints(options.runId)[options.stepId];
    if (existing && existing.status === "completed" && existing.outputContent) {
      return {
        status: "completed",
        output: existing.outputContent,
        attemptsUsed: existing.attempt,
        wasHealed: existing.attempt > 1
      };
    }

    let attempt = existing ? existing.attempt : 1;
    let remedialDirective: string | undefined = existing?.remedialDirective;
    let wasHealed = false;

    while (attempt <= MAX_REMEDIAL_ATTEMPTS_PER_STEP) {
      this.saveStepCheckpoint(options.runId, {
        stepId: options.stepId,
        attempt,
        status: attempt > 1 ? "self_healing" : "executing",
        remedialDirective,
        updatedAt: new Date().toISOString()
      });

      try {
        const res = await options.executeStepFn(attempt, remedialDirective);
        const output = String(res.output ?? "").trim();

        if (options.validateOutput) {
          const val = options.validateOutput(output);
          if (!val.valid) {
            throw new Error(`OUTPUT_DEFECT:${val.defectMessage || "Validation failed"}`);
          }
        }

        this.saveStepCheckpoint(options.runId, {
          stepId: options.stepId,
          attempt,
          status: "completed",
          outputContent: output,
          remedialDirective,
          updatedAt: new Date().toISOString()
        });

        return {
          status: "completed",
          output,
          attemptsUsed: attempt,
          wasHealed
        };
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        attempt++;
        if (attempt <= MAX_REMEDIAL_ATTEMPTS_PER_STEP) {
          wasHealed = true;
          remedialDirective = `Исправление дефекта попытки #${attempt - 1}: ${errMsg}. Сохрани проверяемые факты и устрани ошибку.`;
        } else {
          this.saveStepCheckpoint(options.runId, {
            stepId: options.stepId,
            attempt: MAX_REMEDIAL_ATTEMPTS_PER_STEP,
            status: "failed",
            remedialDirective: `Исчерпан лимит попыток (${MAX_REMEDIAL_ATTEMPTS_PER_STEP}): ${errMsg}`,
            updatedAt: new Date().toISOString()
          });
          return {
            status: "failed",
            output: "",
            attemptsUsed: MAX_REMEDIAL_ATTEMPTS_PER_STEP,
            wasHealed: false
          };
        }
      }
    }

    return {
      status: "failed",
      output: "",
      attemptsUsed: MAX_REMEDIAL_ATTEMPTS_PER_STEP,
      wasHealed: false
    };
  }
}
