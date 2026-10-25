/**
 * F146 (stage5-enterprise): Горизонтальное автомасштабирование воркеров очереди
 * Динамическое поднятие новых инстансов обработчиков при пиковой нагрузке
 * Operation Code: queue_horizon_scaler
 */

import { createHash } from "node:crypto";
import { Stage5EnterpriseKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F146_FEATURE_ID = "F146" as const;
export const F146_STAGE = "stage5-enterprise" as const;
export const F146_OPERATION_CODE = "queue_horizon_scaler" as const;
export const F146_CONTRACT_VERSION = "2.0.0" as const;

export type F146WorkerQueueAutoscalerExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F146WorkerQueueAutoscalerConfig {
  readonly featureId: typeof F146_FEATURE_ID;
  readonly stage: typeof F146_STAGE;
  readonly operationCode: typeof F146_OPERATION_CODE;
  readonly contractVersion: typeof F146_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F146WorkerQueueAutoscalerInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly queue_depth: string;
  readonly current_replicas: string | number;
  readonly target_replicas: string | number | boolean | readonly string[];
  readonly scale_event_triggered: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F146WorkerQueueAutoscalerAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F146_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F146WorkerQueueAutoscalerOutput {
  readonly featureId: typeof F146_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F146WorkerQueueAutoscalerExecutionStatus;
  readonly operationCode: typeof F146_OPERATION_CODE;
  readonly resolved_queue_depth: string;
  readonly resolved_current_replicas: string | number;
  readonly resolved_target_replicas: string | number | boolean | readonly string[];
  readonly resolved_scale_event_triggered: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F146WorkerQueueAutoscalerAuditEntry;
}

export interface F146WorkerQueueAutoscalerTelemetrySnapshot {
  readonly featureId: typeof F146_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F146_CONFIG: F146WorkerQueueAutoscalerConfig = {
  featureId: F146_FEATURE_ID,
  stage: F146_STAGE,
  operationCode: F146_OPERATION_CODE,
  contractVersion: F146_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F146WorkerQueueAutoscalerValidationError extends Error {
  public readonly featureId = F146_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F146 Validation Error on '${field}']: ${message}`);
    this.name = "F146WorkerQueueAutoscalerValidationError";
    this.field = field;
  }
}

export function computeF146Digest(rawPayload: string): string {
  return `f146_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F146WorkerQueueAutoscalerEngine {
  private readonly config: F146WorkerQueueAutoscalerConfig;
  private readonly kernel: Stage5EnterpriseKernel;
  private readonly executionHistory: F146WorkerQueueAutoscalerOutput[] = [];
  private readonly auditLog: F146WorkerQueueAutoscalerAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F146WorkerQueueAutoscalerOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F146WorkerQueueAutoscalerConfig>, kernel?: Stage5EnterpriseKernel) {
    this.config = {
      ...DEFAULT_F146_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage5EnterpriseKernel();
  }

  public getConfig(): F146WorkerQueueAutoscalerConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F146WorkerQueueAutoscalerInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F146WorkerQueueAutoscalerValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F146WorkerQueueAutoscalerValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F146WorkerQueueAutoscalerValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F146WorkerQueueAutoscalerValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F146WorkerQueueAutoscalerValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F146WorkerQueueAutoscalerValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.queue_depth).trim().length === 0) {
      throw new F146WorkerQueueAutoscalerValidationError("queue_depth", "Primary domain attribute 'queue_depth' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      queue_depth: input.queue_depth,
      current_replicas: input.current_replicas,
      target_replicas: input.target_replicas,
      scale_event_triggered: input.scale_event_triggered
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F146WorkerQueueAutoscalerValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F146WorkerQueueAutoscalerInput): F146WorkerQueueAutoscalerOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F146_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        queue_depth: input.queue_depth,
        current_replicas: input.current_replicas,
        target_replicas: input.target_replicas,
        scale_event_triggered: input.scale_event_triggered
      });
      const payloadHash = computeF146Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F146WorkerQueueAutoscalerValidationError(
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
        featureId: F146_FEATURE_ID,
        operationCode: F146_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          queue_depth: input.queue_depth,
          current_replicas: input.current_replicas,
          target_replicas: input.target_replicas,
          scale_event_triggered: input.scale_event_triggered
        }
      });

      const executionId = `exec_f146_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f146_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F146WorkerQueueAutoscalerAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F146_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `queue_horizon_scaler:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F146WorkerQueueAutoscalerOutput = {
        featureId: F146_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F146_OPERATION_CODE,
        resolved_queue_depth: kernelResult.resolvedFields.queue_depth as string,
        resolved_current_replicas: kernelResult.resolvedFields.current_replicas as string | number,
        resolved_target_replicas: kernelResult.resolvedFields.target_replicas as string | number | boolean | readonly string[],
        resolved_scale_event_triggered: kernelResult.resolvedFields.scale_event_triggered as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F146WorkerQueueAutoscalerTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F146_FEATURE_ID,
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

  public getAuditTrail(): readonly F146WorkerQueueAutoscalerAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F146WorkerQueueAutoscalerOutput[] {
    return [...this.executionHistory];
  }
}

export function verifyF146Module(): {
  featureId: typeof F146_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F146WorkerQueueAutoscalerEngine();
  const sampleInput: F146WorkerQueueAutoscalerInput = {
    requestId: "req_verify_f146",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    queue_depth: "f146_queue_depth_seed",
    current_replicas: 42,
    target_replicas: true,
    scale_event_triggered: "verified_seed",
    metadata: { stage: "stage5-enterprise", featureNumber: 146 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F146" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_queue_depth !== sampleInput.queue_depth &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F146_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
