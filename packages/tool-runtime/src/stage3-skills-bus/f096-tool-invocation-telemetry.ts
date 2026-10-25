/**
 * F096 (stage3-skills-bus): Телеметрия успешности вызовов инструментов
 * Статистика отказов и времени отклика по каждому внешнему коннектору
 * Operation Code: tool_metrics_collector
 */

import { createHash } from "node:crypto";
import { Stage3SkillsKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F096_FEATURE_ID = "F096" as const;
export const F096_STAGE = "stage3-skills-bus" as const;
export const F096_OPERATION_CODE = "tool_metrics_collector" as const;
export const F096_CONTRACT_VERSION = "2.0.0" as const;

export type F096ToolInvocationTelemetryExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F096ToolInvocationTelemetryConfig {
  readonly featureId: typeof F096_FEATURE_ID;
  readonly stage: typeof F096_STAGE;
  readonly operationCode: typeof F096_OPERATION_CODE;
  readonly contractVersion: typeof F096_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F096ToolInvocationTelemetryInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly connector_id: string;
  readonly success_rate_pct: string | number;
  readonly avg_latency_ms: string | number | boolean | readonly string[];
  readonly total_invocations: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F096ToolInvocationTelemetryAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F096_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F096ToolInvocationTelemetryOutput {
  readonly featureId: typeof F096_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F096ToolInvocationTelemetryExecutionStatus;
  readonly operationCode: typeof F096_OPERATION_CODE;
  readonly resolved_connector_id: string;
  readonly resolved_success_rate_pct: string | number;
  readonly resolved_avg_latency_ms: string | number | boolean | readonly string[];
  readonly resolved_total_invocations: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F096ToolInvocationTelemetryAuditEntry;
}

export interface F096ToolInvocationTelemetryTelemetrySnapshot {
  readonly featureId: typeof F096_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F096_CONFIG: F096ToolInvocationTelemetryConfig = {
  featureId: F096_FEATURE_ID,
  stage: F096_STAGE,
  operationCode: F096_OPERATION_CODE,
  contractVersion: F096_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F096ToolInvocationTelemetryValidationError extends Error {
  public readonly featureId = F096_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F096 Validation Error on '${field}']: ${message}`);
    this.name = "F096ToolInvocationTelemetryValidationError";
    this.field = field;
  }
}

export function computeF096Digest(rawPayload: string): string {
  return `f096_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F096ToolInvocationTelemetryEngine {
  private readonly config: F096ToolInvocationTelemetryConfig;
  private readonly kernel: Stage3SkillsKernel;
  private readonly executionHistory: F096ToolInvocationTelemetryOutput[] = [];
  private readonly auditLog: F096ToolInvocationTelemetryAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F096ToolInvocationTelemetryOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F096ToolInvocationTelemetryConfig>, kernel?: Stage3SkillsKernel) {
    this.config = {
      ...DEFAULT_F096_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage3SkillsKernel();
  }

  public getConfig(): F096ToolInvocationTelemetryConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F096ToolInvocationTelemetryInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F096ToolInvocationTelemetryValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F096ToolInvocationTelemetryValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F096ToolInvocationTelemetryValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F096ToolInvocationTelemetryValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F096ToolInvocationTelemetryValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F096ToolInvocationTelemetryValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.connector_id).trim().length === 0) {
      throw new F096ToolInvocationTelemetryValidationError("connector_id", "Primary domain attribute 'connector_id' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      connector_id: input.connector_id,
      success_rate_pct: input.success_rate_pct,
      avg_latency_ms: input.avg_latency_ms,
      total_invocations: input.total_invocations
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F096ToolInvocationTelemetryValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F096ToolInvocationTelemetryInput): F096ToolInvocationTelemetryOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F096_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        connector_id: input.connector_id,
        success_rate_pct: input.success_rate_pct,
        avg_latency_ms: input.avg_latency_ms,
        total_invocations: input.total_invocations
      });
      const payloadHash = computeF096Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F096ToolInvocationTelemetryValidationError(
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
        featureId: F096_FEATURE_ID,
        operationCode: F096_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          connector_id: input.connector_id,
          success_rate_pct: input.success_rate_pct,
          avg_latency_ms: input.avg_latency_ms,
          total_invocations: input.total_invocations
        }
      });

      const executionId = `exec_f096_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f096_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F096ToolInvocationTelemetryAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F096_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `tool_metrics_collector:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F096ToolInvocationTelemetryOutput = {
        featureId: F096_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F096_OPERATION_CODE,
        resolved_connector_id: kernelResult.resolvedFields.connector_id as string,
        resolved_success_rate_pct: kernelResult.resolvedFields.success_rate_pct as string | number,
        resolved_avg_latency_ms: kernelResult.resolvedFields.avg_latency_ms as string | number | boolean | readonly string[],
        resolved_total_invocations: kernelResult.resolvedFields.total_invocations as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F096ToolInvocationTelemetryTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F096_FEATURE_ID,
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

  public getAuditTrail(): readonly F096ToolInvocationTelemetryAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F096ToolInvocationTelemetryOutput[] {
    return [...this.executionHistory];
  }
}

export function verifyF096Module(): {
  featureId: typeof F096_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F096ToolInvocationTelemetryEngine();
  const sampleInput: F096ToolInvocationTelemetryInput = {
    requestId: "req_verify_f096",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    connector_id: "f096_connector_id_seed",
    success_rate_pct: 42,
    avg_latency_ms: true,
    total_invocations: "verified_seed",
    metadata: { stage: "stage3-skills-bus", featureNumber: 96 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F096" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_connector_id !== sampleInput.connector_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F096_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
