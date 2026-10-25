/**
 * F012 (stage1-autonomy): Откат ветки рассуждений (State Rollback)
 * Возможность вернуться на 2–3 шага назад в графе задач и пойти по альтернативной ветке
 * Operation Code: branch_rollback
 */

import { createHash } from "node:crypto";
import { Stage1AutonomyKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F012_FEATURE_ID = "F012" as const;
export const F012_STAGE = "stage1-autonomy" as const;
export const F012_OPERATION_CODE = "branch_rollback" as const;
export const F012_CONTRACT_VERSION = "2.0.0" as const;

export type F012ReasoningStateRollbackExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F012ReasoningStateRollbackConfig {
  readonly featureId: typeof F012_FEATURE_ID;
  readonly stage: typeof F012_STAGE;
  readonly operationCode: typeof F012_OPERATION_CODE;
  readonly contractVersion: typeof F012_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F012ReasoningStateRollbackInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly graph_id: string;
  readonly target_checkpoint_id: string | number;
  readonly steps_reverted: string | number | boolean | readonly string[];
  readonly alternate_branch_id: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F012ReasoningStateRollbackAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F012_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F012ReasoningStateRollbackOutput {
  readonly featureId: typeof F012_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F012ReasoningStateRollbackExecutionStatus;
  readonly operationCode: typeof F012_OPERATION_CODE;
  readonly resolved_graph_id: string;
  readonly resolved_target_checkpoint_id: string | number;
  readonly resolved_steps_reverted: string | number | boolean | readonly string[];
  readonly resolved_alternate_branch_id: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F012ReasoningStateRollbackAuditEntry;
}

export interface F012ReasoningStateRollbackTelemetrySnapshot {
  readonly featureId: typeof F012_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F012_CONFIG: F012ReasoningStateRollbackConfig = {
  featureId: F012_FEATURE_ID,
  stage: F012_STAGE,
  operationCode: F012_OPERATION_CODE,
  contractVersion: F012_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F012ReasoningStateRollbackValidationError extends Error {
  public readonly featureId = F012_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F012 Validation Error on '${field}']: ${message}`);
    this.name = "F012ReasoningStateRollbackValidationError";
    this.field = field;
  }
}

export function computeF012Digest(rawPayload: string): string {
  return `f012_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F012ReasoningStateRollbackEngine {
  private readonly config: F012ReasoningStateRollbackConfig;
  private readonly kernel: Stage1AutonomyKernel;
  private readonly executionHistory: F012ReasoningStateRollbackOutput[] = [];
  private readonly auditLog: F012ReasoningStateRollbackAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F012ReasoningStateRollbackOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F012ReasoningStateRollbackConfig>, kernel?: Stage1AutonomyKernel) {
    this.config = {
      ...DEFAULT_F012_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage1AutonomyKernel();
  }

  public getConfig(): F012ReasoningStateRollbackConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F012ReasoningStateRollbackInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F012ReasoningStateRollbackValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F012ReasoningStateRollbackValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F012ReasoningStateRollbackValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F012ReasoningStateRollbackValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F012ReasoningStateRollbackValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F012ReasoningStateRollbackValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.graph_id).trim().length === 0) {
      throw new F012ReasoningStateRollbackValidationError("graph_id", "Primary domain attribute 'graph_id' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      graph_id: input.graph_id,
      target_checkpoint_id: input.target_checkpoint_id,
      steps_reverted: input.steps_reverted,
      alternate_branch_id: input.alternate_branch_id
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F012ReasoningStateRollbackValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F012ReasoningStateRollbackInput): F012ReasoningStateRollbackOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F012_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        graph_id: input.graph_id,
        target_checkpoint_id: input.target_checkpoint_id,
        steps_reverted: input.steps_reverted,
        alternate_branch_id: input.alternate_branch_id
      });
      const payloadHash = computeF012Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F012ReasoningStateRollbackValidationError(
            "requestId",
            `Idempotency conflict: requestId '${input.requestId}' was already executed with a different payload.`
          );
        }
        this.successfulRuns += 1;
        return {
          ...existingIdempotent.output,
          idempotentReplay: true
        };
      }

      const kernelResult = this.kernel.executeDomainOperation({
        featureId: F012_FEATURE_ID,
        operationCode: F012_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          graph_id: input.graph_id,
          target_checkpoint_id: input.target_checkpoint_id,
          steps_reverted: input.steps_reverted,
          alternate_branch_id: input.alternate_branch_id
        }
      });

      const executionId = `exec_f012_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f012_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F012ReasoningStateRollbackAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F012_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `branch_rollback:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F012ReasoningStateRollbackOutput = {
        featureId: F012_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F012_OPERATION_CODE,
        resolved_graph_id: kernelResult.resolvedFields.graph_id as string,
        resolved_target_checkpoint_id: kernelResult.resolvedFields.target_checkpoint_id as string | number,
        resolved_steps_reverted: kernelResult.resolvedFields.steps_reverted as string | number | boolean | readonly string[],
        resolved_alternate_branch_id: kernelResult.resolvedFields.alternate_branch_id as string | number | boolean | Record<string, unknown>,
        domainOutcome: kernelResult.domainOutcome,
        idempotentReplay: false,
        provenanceDigest,
        latencyMs,
        timestampIso,
        auditRecord
      };

      this.idempotencyStore.set(input.requestId, { payloadHash, output });
      this.executionHistory.push(output);
      return output;
    } catch (err) {
      this.failedRuns += 1;
      throw err;
    }
  }

  public getTelemetrySnapshot(): F012ReasoningStateRollbackTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F012_FEATURE_ID,
      totalRuns: this.totalRuns,
      successfulRuns: this.successfulRuns,
      failedRuns: this.failedRuns,
      lastExecutionId: last,
      averageLatencyMs:
        this.successfulRuns > 0
          ? Number((this.cumulativeLatencyMs / this.successfulRuns).toFixed(3))
          : 0
    };
  }

  public getAuditTrail(): readonly F012ReasoningStateRollbackAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F012ReasoningStateRollbackOutput[] {
    return [...this.executionHistory];
  }
}

export function verifyF012Module(): {
  featureId: typeof F012_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F012ReasoningStateRollbackEngine();
  const sampleInput: F012ReasoningStateRollbackInput = {
    requestId: "req_verify_f012",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    graph_id: "f012_graph_id_seed",
    target_checkpoint_id: 42,
    steps_reverted: true,
    alternate_branch_id: "verified_seed",
    metadata: { stage: "stage1-autonomy", featureNumber: 12 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F012" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_graph_id !== sampleInput.graph_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F012_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
