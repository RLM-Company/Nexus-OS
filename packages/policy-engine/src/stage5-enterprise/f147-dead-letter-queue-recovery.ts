/**
 * F147 (stage5-enterprise): Очередь недоставленных задач (Dead-Letter Queue)
 * Сохранение упавших фоновых джобов для повторного запуска после устранения сбоя
 * Operation Code: dlq_replay_manager
 */

import { createHash } from "node:crypto";
import { Stage5EnterpriseKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F147_FEATURE_ID = "F147" as const;
export const F147_STAGE = "stage5-enterprise" as const;
export const F147_OPERATION_CODE = "dlq_replay_manager" as const;
export const F147_CONTRACT_VERSION = "2.0.0" as const;

export type F147DeadLetterQueueRecoveryExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F147DeadLetterQueueRecoveryConfig {
  readonly featureId: typeof F147_FEATURE_ID;
  readonly stage: typeof F147_STAGE;
  readonly operationCode: typeof F147_OPERATION_CODE;
  readonly contractVersion: typeof F147_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F147DeadLetterQueueRecoveryInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly dlq_job_id: string;
  readonly failure_reason: string | number;
  readonly retry_count: string | number | boolean | readonly string[];
  readonly requeued_successfully: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F147DeadLetterQueueRecoveryAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F147_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F147DeadLetterQueueRecoveryOutput {
  readonly featureId: typeof F147_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F147DeadLetterQueueRecoveryExecutionStatus;
  readonly operationCode: typeof F147_OPERATION_CODE;
  readonly resolved_dlq_job_id: string;
  readonly resolved_failure_reason: string | number;
  readonly resolved_retry_count: string | number | boolean | readonly string[];
  readonly resolved_requeued_successfully: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F147DeadLetterQueueRecoveryAuditEntry;
}

export interface F147DeadLetterQueueRecoveryTelemetrySnapshot {
  readonly featureId: typeof F147_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F147_CONFIG: F147DeadLetterQueueRecoveryConfig = {
  featureId: F147_FEATURE_ID,
  stage: F147_STAGE,
  operationCode: F147_OPERATION_CODE,
  contractVersion: F147_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F147DeadLetterQueueRecoveryValidationError extends Error {
  public readonly featureId = F147_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F147 Validation Error on '${field}']: ${message}`);
    this.name = "F147DeadLetterQueueRecoveryValidationError";
    this.field = field;
  }
}

export function computeF147Digest(rawPayload: string): string {
  return `f147_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F147DeadLetterQueueRecoveryEngine {
  private readonly config: F147DeadLetterQueueRecoveryConfig;
  private readonly kernel: Stage5EnterpriseKernel;
  private readonly executionHistory: F147DeadLetterQueueRecoveryOutput[] = [];
  private readonly auditLog: F147DeadLetterQueueRecoveryAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F147DeadLetterQueueRecoveryOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F147DeadLetterQueueRecoveryConfig>, kernel?: Stage5EnterpriseKernel) {
    this.config = {
      ...DEFAULT_F147_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage5EnterpriseKernel();
  }

  public getConfig(): F147DeadLetterQueueRecoveryConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F147DeadLetterQueueRecoveryInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F147DeadLetterQueueRecoveryValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F147DeadLetterQueueRecoveryValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F147DeadLetterQueueRecoveryValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F147DeadLetterQueueRecoveryValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F147DeadLetterQueueRecoveryValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F147DeadLetterQueueRecoveryValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.dlq_job_id).trim().length === 0) {
      throw new F147DeadLetterQueueRecoveryValidationError("dlq_job_id", "Primary domain attribute 'dlq_job_id' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      dlq_job_id: input.dlq_job_id,
      failure_reason: input.failure_reason,
      retry_count: input.retry_count,
      requeued_successfully: input.requeued_successfully
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F147DeadLetterQueueRecoveryValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F147DeadLetterQueueRecoveryInput): F147DeadLetterQueueRecoveryOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F147_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        dlq_job_id: input.dlq_job_id,
        failure_reason: input.failure_reason,
        retry_count: input.retry_count,
        requeued_successfully: input.requeued_successfully
      });
      const payloadHash = computeF147Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F147DeadLetterQueueRecoveryValidationError(
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
        featureId: F147_FEATURE_ID,
        operationCode: F147_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          dlq_job_id: input.dlq_job_id,
          failure_reason: input.failure_reason,
          retry_count: input.retry_count,
          requeued_successfully: input.requeued_successfully
        }
      });

      const executionId = `exec_f147_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f147_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F147DeadLetterQueueRecoveryAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F147_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `dlq_replay_manager:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F147DeadLetterQueueRecoveryOutput = {
        featureId: F147_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F147_OPERATION_CODE,
        resolved_dlq_job_id: kernelResult.resolvedFields.dlq_job_id as string,
        resolved_failure_reason: kernelResult.resolvedFields.failure_reason as string | number,
        resolved_retry_count: kernelResult.resolvedFields.retry_count as string | number | boolean | readonly string[],
        resolved_requeued_successfully: kernelResult.resolvedFields.requeued_successfully as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F147DeadLetterQueueRecoveryTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F147_FEATURE_ID,
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

  public getAuditTrail(): readonly F147DeadLetterQueueRecoveryAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F147DeadLetterQueueRecoveryOutput[] {
    return [...this.executionHistory];
  }
}

export function verifyF147Module(): {
  featureId: typeof F147_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F147DeadLetterQueueRecoveryEngine();
  const sampleInput: F147DeadLetterQueueRecoveryInput = {
    requestId: "req_verify_f147",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    dlq_job_id: "f147_dlq_job_id_seed",
    failure_reason: 42,
    retry_count: true,
    requeued_successfully: "verified_seed",
    metadata: { stage: "stage5-enterprise", featureNumber: 147 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F147" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_dlq_job_id !== sampleInput.dlq_job_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F147_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
