/**
 * F141 (stage5-enterprise): Сквозная трассировка мультиагентных прогонов (OpenTelemetry Tracing)
 * Визуализация полного пути запроса через все микросервисы и воркеры
 * Operation Code: otel_span_exporter
 */

import { createHash } from "node:crypto";
import { Stage5EnterpriseKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F141_FEATURE_ID = "F141" as const;
export const F141_STAGE = "stage5-enterprise" as const;
export const F141_OPERATION_CODE = "otel_span_exporter" as const;
export const F141_CONTRACT_VERSION = "2.0.0" as const;

export type F141OpentelemetryMultiagentTracingExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F141OpentelemetryMultiagentTracingConfig {
  readonly featureId: typeof F141_FEATURE_ID;
  readonly stage: typeof F141_STAGE;
  readonly operationCode: typeof F141_OPERATION_CODE;
  readonly contractVersion: typeof F141_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F141OpentelemetryMultiagentTracingInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly trace_id: string;
  readonly span_id: string | number;
  readonly parent_span_id: string | number | boolean | readonly string[];
  readonly service_hop_timings: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F141OpentelemetryMultiagentTracingAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F141_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F141OpentelemetryMultiagentTracingOutput {
  readonly featureId: typeof F141_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F141OpentelemetryMultiagentTracingExecutionStatus;
  readonly operationCode: typeof F141_OPERATION_CODE;
  readonly resolved_trace_id: string;
  readonly resolved_span_id: string | number;
  readonly resolved_parent_span_id: string | number | boolean | readonly string[];
  readonly resolved_service_hop_timings: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F141OpentelemetryMultiagentTracingAuditEntry;
}

export interface F141OpentelemetryMultiagentTracingTelemetrySnapshot {
  readonly featureId: typeof F141_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F141_CONFIG: F141OpentelemetryMultiagentTracingConfig = {
  featureId: F141_FEATURE_ID,
  stage: F141_STAGE,
  operationCode: F141_OPERATION_CODE,
  contractVersion: F141_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F141OpentelemetryMultiagentTracingValidationError extends Error {
  public readonly featureId = F141_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F141 Validation Error on '${field}']: ${message}`);
    this.name = "F141OpentelemetryMultiagentTracingValidationError";
    this.field = field;
  }
}

export function computeF141Digest(rawPayload: string): string {
  return `f141_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F141OpentelemetryMultiagentTracingEngine {
  private readonly config: F141OpentelemetryMultiagentTracingConfig;
  private readonly kernel: Stage5EnterpriseKernel;
  private readonly executionHistory: F141OpentelemetryMultiagentTracingOutput[] = [];
  private readonly auditLog: F141OpentelemetryMultiagentTracingAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F141OpentelemetryMultiagentTracingOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F141OpentelemetryMultiagentTracingConfig>, kernel?: Stage5EnterpriseKernel) {
    this.config = {
      ...DEFAULT_F141_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage5EnterpriseKernel();
  }

  public getConfig(): F141OpentelemetryMultiagentTracingConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F141OpentelemetryMultiagentTracingInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F141OpentelemetryMultiagentTracingValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F141OpentelemetryMultiagentTracingValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F141OpentelemetryMultiagentTracingValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F141OpentelemetryMultiagentTracingValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F141OpentelemetryMultiagentTracingValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F141OpentelemetryMultiagentTracingValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.trace_id).trim().length === 0) {
      throw new F141OpentelemetryMultiagentTracingValidationError("trace_id", "Primary domain attribute 'trace_id' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      trace_id: input.trace_id,
      span_id: input.span_id,
      parent_span_id: input.parent_span_id,
      service_hop_timings: input.service_hop_timings
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F141OpentelemetryMultiagentTracingValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F141OpentelemetryMultiagentTracingInput): F141OpentelemetryMultiagentTracingOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F141_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        trace_id: input.trace_id,
        span_id: input.span_id,
        parent_span_id: input.parent_span_id,
        service_hop_timings: input.service_hop_timings
      });
      const payloadHash = computeF141Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F141OpentelemetryMultiagentTracingValidationError(
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
        featureId: F141_FEATURE_ID,
        operationCode: F141_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          trace_id: input.trace_id,
          span_id: input.span_id,
          parent_span_id: input.parent_span_id,
          service_hop_timings: input.service_hop_timings
        }
      });

      const executionId = `exec_f141_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f141_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F141OpentelemetryMultiagentTracingAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F141_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `otel_span_exporter:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F141OpentelemetryMultiagentTracingOutput = {
        featureId: F141_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F141_OPERATION_CODE,
        resolved_trace_id: kernelResult.resolvedFields.trace_id as string,
        resolved_span_id: kernelResult.resolvedFields.span_id as string | number,
        resolved_parent_span_id: kernelResult.resolvedFields.parent_span_id as string | number | boolean | readonly string[],
        resolved_service_hop_timings: kernelResult.resolvedFields.service_hop_timings as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F141OpentelemetryMultiagentTracingTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F141_FEATURE_ID,
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

  public getAuditTrail(): readonly F141OpentelemetryMultiagentTracingAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F141OpentelemetryMultiagentTracingOutput[] {
    return [...this.executionHistory];
  }
}

export function verifyF141Module(): {
  featureId: typeof F141_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F141OpentelemetryMultiagentTracingEngine();
  const sampleInput: F141OpentelemetryMultiagentTracingInput = {
    requestId: "req_verify_f141",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    trace_id: "f141_trace_id_seed",
    span_id: 42,
    parent_span_id: true,
    service_hop_timings: "verified_seed",
    metadata: { stage: "stage5-enterprise", featureNumber: 141 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F141" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_trace_id !== sampleInput.trace_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F141_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
