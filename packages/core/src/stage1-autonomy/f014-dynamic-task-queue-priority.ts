/**
 * F014 (stage1-autonomy): Приоритизация очереди задач
 * Динамическое перестроение весов в очереди при поступлении срочного сообщения от пользователя
 * Operation Code: priority_scheduler
 */

import { createHash } from "node:crypto";
import { Stage1AutonomyKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F014_FEATURE_ID = "F014" as const;
export const F014_STAGE = "stage1-autonomy" as const;
export const F014_OPERATION_CODE = "priority_scheduler" as const;
export const F014_CONTRACT_VERSION = "2.0.0" as const;

export type F014DynamicTaskQueuePriorityExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F014DynamicTaskQueuePriorityConfig {
  readonly featureId: typeof F014_FEATURE_ID;
  readonly stage: typeof F014_STAGE;
  readonly operationCode: typeof F014_OPERATION_CODE;
  readonly contractVersion: typeof F014_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F014DynamicTaskQueuePriorityInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly queue_id: string;
  readonly urgent_task_id: string | number;
  readonly previous_weight: string | number | boolean | readonly string[];
  readonly new_priority_weight: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F014DynamicTaskQueuePriorityAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F014_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F014DynamicTaskQueuePriorityOutput {
  readonly featureId: typeof F014_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F014DynamicTaskQueuePriorityExecutionStatus;
  readonly operationCode: typeof F014_OPERATION_CODE;
  readonly resolved_queue_id: string;
  readonly resolved_urgent_task_id: string | number;
  readonly resolved_previous_weight: string | number | boolean | readonly string[];
  readonly resolved_new_priority_weight: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F014DynamicTaskQueuePriorityAuditEntry;
}

export interface F014DynamicTaskQueuePriorityTelemetrySnapshot {
  readonly featureId: typeof F014_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F014_CONFIG: F014DynamicTaskQueuePriorityConfig = {
  featureId: F014_FEATURE_ID,
  stage: F014_STAGE,
  operationCode: F014_OPERATION_CODE,
  contractVersion: F014_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F014DynamicTaskQueuePriorityValidationError extends Error {
  public readonly featureId = F014_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F014 Validation Error on '${field}']: ${message}`);
    this.name = "F014DynamicTaskQueuePriorityValidationError";
    this.field = field;
  }
}

export function computeF014Digest(rawPayload: string): string {
  return `f014_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F014DynamicTaskQueuePriorityEngine {
  private readonly config: F014DynamicTaskQueuePriorityConfig;
  private readonly kernel: Stage1AutonomyKernel;
  private readonly executionHistory: F014DynamicTaskQueuePriorityOutput[] = [];
  private readonly auditLog: F014DynamicTaskQueuePriorityAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F014DynamicTaskQueuePriorityOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F014DynamicTaskQueuePriorityConfig>, kernel?: Stage1AutonomyKernel) {
    this.config = {
      ...DEFAULT_F014_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage1AutonomyKernel();
  }

  public getConfig(): F014DynamicTaskQueuePriorityConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F014DynamicTaskQueuePriorityInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F014DynamicTaskQueuePriorityValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F014DynamicTaskQueuePriorityValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F014DynamicTaskQueuePriorityValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F014DynamicTaskQueuePriorityValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F014DynamicTaskQueuePriorityValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F014DynamicTaskQueuePriorityValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.queue_id).trim().length === 0) {
      throw new F014DynamicTaskQueuePriorityValidationError("queue_id", "Primary domain attribute 'queue_id' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      queue_id: input.queue_id,
      urgent_task_id: input.urgent_task_id,
      previous_weight: input.previous_weight,
      new_priority_weight: input.new_priority_weight
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F014DynamicTaskQueuePriorityValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F014DynamicTaskQueuePriorityInput): F014DynamicTaskQueuePriorityOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F014_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        queue_id: input.queue_id,
        urgent_task_id: input.urgent_task_id,
        previous_weight: input.previous_weight,
        new_priority_weight: input.new_priority_weight
      });
      const payloadHash = computeF014Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F014DynamicTaskQueuePriorityValidationError(
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
        featureId: F014_FEATURE_ID,
        operationCode: F014_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          queue_id: input.queue_id,
          urgent_task_id: input.urgent_task_id,
          previous_weight: input.previous_weight,
          new_priority_weight: input.new_priority_weight
        }
      });

      const executionId = `exec_f014_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f014_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F014DynamicTaskQueuePriorityAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F014_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `priority_scheduler:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F014DynamicTaskQueuePriorityOutput = {
        featureId: F014_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F014_OPERATION_CODE,
        resolved_queue_id: kernelResult.resolvedFields.queue_id as string,
        resolved_urgent_task_id: kernelResult.resolvedFields.urgent_task_id as string | number,
        resolved_previous_weight: kernelResult.resolvedFields.previous_weight as string | number | boolean | readonly string[],
        resolved_new_priority_weight: kernelResult.resolvedFields.new_priority_weight as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F014DynamicTaskQueuePriorityTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F014_FEATURE_ID,
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

  public getAuditTrail(): readonly F014DynamicTaskQueuePriorityAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F014DynamicTaskQueuePriorityOutput[] {
    return [...this.executionHistory];
  }
}

export function verifyF014Module(): {
  featureId: typeof F014_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F014DynamicTaskQueuePriorityEngine();
  const sampleInput: F014DynamicTaskQueuePriorityInput = {
    requestId: "req_verify_f014",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    queue_id: "f014_queue_id_seed",
    urgent_task_id: 42,
    previous_weight: true,
    new_priority_weight: "verified_seed",
    metadata: { stage: "stage1-autonomy", featureNumber: 14 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F014" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_queue_id !== sampleInput.queue_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F014_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
