/**
 * F013 (stage1-autonomy): Параллельное исполнение суб-агентов (Fan-out / Fan-in)
 * Одновременный запуск независимых веток графа с последующей агрегацией результатов
 * Operation Code: fanout_aggregator
 */

import { createHash } from "node:crypto";
import { Stage1AutonomyKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F013_FEATURE_ID = "F013" as const;
export const F013_STAGE = "stage1-autonomy" as const;
export const F013_OPERATION_CODE = "fanout_aggregator" as const;
export const F013_CONTRACT_VERSION = "2.0.0" as const;

export type F013ParallelSubagentFanoutExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F013ParallelSubagentFanoutConfig {
  readonly featureId: typeof F013_FEATURE_ID;
  readonly stage: typeof F013_STAGE;
  readonly operationCode: typeof F013_OPERATION_CODE;
  readonly contractVersion: typeof F013_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F013ParallelSubagentFanoutInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly parallel_group_id: string;
  readonly worker_count: string | number;
  readonly completed_branches: string | number | boolean | readonly string[];
  readonly merged_output: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F013ParallelSubagentFanoutAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F013_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F013ParallelSubagentFanoutOutput {
  readonly featureId: typeof F013_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F013ParallelSubagentFanoutExecutionStatus;
  readonly operationCode: typeof F013_OPERATION_CODE;
  readonly resolved_parallel_group_id: string;
  readonly resolved_worker_count: string | number;
  readonly resolved_completed_branches: string | number | boolean | readonly string[];
  readonly resolved_merged_output: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F013ParallelSubagentFanoutAuditEntry;
}

export interface F013ParallelSubagentFanoutTelemetrySnapshot {
  readonly featureId: typeof F013_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F013_CONFIG: F013ParallelSubagentFanoutConfig = {
  featureId: F013_FEATURE_ID,
  stage: F013_STAGE,
  operationCode: F013_OPERATION_CODE,
  contractVersion: F013_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F013ParallelSubagentFanoutValidationError extends Error {
  public readonly featureId = F013_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F013 Validation Error on '${field}']: ${message}`);
    this.name = "F013ParallelSubagentFanoutValidationError";
    this.field = field;
  }
}

export function computeF013Digest(rawPayload: string): string {
  return `f013_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F013ParallelSubagentFanoutEngine {
  private readonly config: F013ParallelSubagentFanoutConfig;
  private readonly kernel: Stage1AutonomyKernel;
  private readonly executionHistory: F013ParallelSubagentFanoutOutput[] = [];
  private readonly auditLog: F013ParallelSubagentFanoutAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F013ParallelSubagentFanoutOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F013ParallelSubagentFanoutConfig>, kernel?: Stage1AutonomyKernel) {
    this.config = {
      ...DEFAULT_F013_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage1AutonomyKernel();
  }

  public getConfig(): F013ParallelSubagentFanoutConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F013ParallelSubagentFanoutInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F013ParallelSubagentFanoutValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F013ParallelSubagentFanoutValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F013ParallelSubagentFanoutValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F013ParallelSubagentFanoutValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F013ParallelSubagentFanoutValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F013ParallelSubagentFanoutValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.parallel_group_id).trim().length === 0) {
      throw new F013ParallelSubagentFanoutValidationError("parallel_group_id", "Primary domain attribute 'parallel_group_id' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      parallel_group_id: input.parallel_group_id,
      worker_count: input.worker_count,
      completed_branches: input.completed_branches,
      merged_output: input.merged_output
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F013ParallelSubagentFanoutValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F013ParallelSubagentFanoutInput): F013ParallelSubagentFanoutOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F013_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        parallel_group_id: input.parallel_group_id,
        worker_count: input.worker_count,
        completed_branches: input.completed_branches,
        merged_output: input.merged_output
      });
      const payloadHash = computeF013Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F013ParallelSubagentFanoutValidationError(
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
        featureId: F013_FEATURE_ID,
        operationCode: F013_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          parallel_group_id: input.parallel_group_id,
          worker_count: input.worker_count,
          completed_branches: input.completed_branches,
          merged_output: input.merged_output
        }
      });

      const executionId = `exec_f013_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f013_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F013ParallelSubagentFanoutAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F013_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `fanout_aggregator:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F013ParallelSubagentFanoutOutput = {
        featureId: F013_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F013_OPERATION_CODE,
        resolved_parallel_group_id: kernelResult.resolvedFields.parallel_group_id as string,
        resolved_worker_count: kernelResult.resolvedFields.worker_count as string | number,
        resolved_completed_branches: kernelResult.resolvedFields.completed_branches as string | number | boolean | readonly string[],
        resolved_merged_output: kernelResult.resolvedFields.merged_output as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F013ParallelSubagentFanoutTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F013_FEATURE_ID,
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

  public getAuditTrail(): readonly F013ParallelSubagentFanoutAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F013ParallelSubagentFanoutOutput[] {
    return [...this.executionHistory];
  }
}

export function verifyF013Module(): {
  featureId: typeof F013_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F013ParallelSubagentFanoutEngine();
  const sampleInput: F013ParallelSubagentFanoutInput = {
    requestId: "req_verify_f013",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    parallel_group_id: "f013_parallel_group_id_seed",
    worker_count: 42,
    completed_branches: true,
    merged_output: "verified_seed",
    metadata: { stage: "stage1-autonomy", featureNumber: 13 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F013" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_parallel_group_id !== sampleInput.parallel_group_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F013_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
