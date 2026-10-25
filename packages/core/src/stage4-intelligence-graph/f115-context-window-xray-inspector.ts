/**
 * F115 (stage4-intelligence-graph): Инспектор контекстного окна (Context Window X-Ray)
 * Наглядная шкала того, сколько токенов занимают системный промпт, граф, файлы и история чата
 * Operation Code: context_xray_telemetry
 */

import { createHash } from "node:crypto";
import { Stage4GraphKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F115_FEATURE_ID = "F115" as const;
export const F115_STAGE = "stage4-intelligence-graph" as const;
export const F115_OPERATION_CODE = "context_xray_telemetry" as const;
export const F115_CONTRACT_VERSION = "2.0.0" as const;

export type F115ContextWindowXrayInspectorExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F115ContextWindowXrayInspectorConfig {
  readonly featureId: typeof F115_FEATURE_ID;
  readonly stage: typeof F115_STAGE;
  readonly operationCode: typeof F115_OPERATION_CODE;
  readonly contractVersion: typeof F115_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F115ContextWindowXrayInspectorInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly max_tokens: string;
  readonly used_tokens: string | number;
  readonly utilization_pct: string | number | boolean | readonly string[];
  readonly segment_breakdown: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F115ContextWindowXrayInspectorAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F115_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F115ContextWindowXrayInspectorOutput {
  readonly featureId: typeof F115_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F115ContextWindowXrayInspectorExecutionStatus;
  readonly operationCode: typeof F115_OPERATION_CODE;
  readonly resolved_max_tokens: string;
  readonly resolved_used_tokens: string | number;
  readonly resolved_utilization_pct: string | number | boolean | readonly string[];
  readonly resolved_segment_breakdown: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F115ContextWindowXrayInspectorAuditEntry;
}

export interface F115ContextWindowXrayInspectorTelemetrySnapshot {
  readonly featureId: typeof F115_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F115_CONFIG: F115ContextWindowXrayInspectorConfig = {
  featureId: F115_FEATURE_ID,
  stage: F115_STAGE,
  operationCode: F115_OPERATION_CODE,
  contractVersion: F115_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F115ContextWindowXrayInspectorValidationError extends Error {
  public readonly featureId = F115_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F115 Validation Error on '${field}']: ${message}`);
    this.name = "F115ContextWindowXrayInspectorValidationError";
    this.field = field;
  }
}

export function computeF115Digest(rawPayload: string): string {
  return `f115_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F115ContextWindowXrayInspectorEngine {
  private readonly config: F115ContextWindowXrayInspectorConfig;
  private readonly kernel: Stage4GraphKernel;
  private readonly executionHistory: F115ContextWindowXrayInspectorOutput[] = [];
  private readonly auditLog: F115ContextWindowXrayInspectorAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F115ContextWindowXrayInspectorOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F115ContextWindowXrayInspectorConfig>, kernel?: Stage4GraphKernel) {
    this.config = {
      ...DEFAULT_F115_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage4GraphKernel();
  }

  public getConfig(): F115ContextWindowXrayInspectorConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F115ContextWindowXrayInspectorInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F115ContextWindowXrayInspectorValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F115ContextWindowXrayInspectorValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F115ContextWindowXrayInspectorValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F115ContextWindowXrayInspectorValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F115ContextWindowXrayInspectorValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F115ContextWindowXrayInspectorValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.max_tokens).trim().length === 0) {
      throw new F115ContextWindowXrayInspectorValidationError("max_tokens", "Primary domain attribute 'max_tokens' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      max_tokens: input.max_tokens,
      used_tokens: input.used_tokens,
      utilization_pct: input.utilization_pct,
      segment_breakdown: input.segment_breakdown
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F115ContextWindowXrayInspectorValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F115ContextWindowXrayInspectorInput): F115ContextWindowXrayInspectorOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F115_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        max_tokens: input.max_tokens,
        used_tokens: input.used_tokens,
        utilization_pct: input.utilization_pct,
        segment_breakdown: input.segment_breakdown
      });
      const payloadHash = computeF115Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F115ContextWindowXrayInspectorValidationError(
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
        featureId: F115_FEATURE_ID,
        operationCode: F115_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          max_tokens: input.max_tokens,
          used_tokens: input.used_tokens,
          utilization_pct: input.utilization_pct,
          segment_breakdown: input.segment_breakdown
        }
      });

      const executionId = `exec_f115_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f115_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F115ContextWindowXrayInspectorAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F115_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `context_xray_telemetry:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F115ContextWindowXrayInspectorOutput = {
        featureId: F115_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F115_OPERATION_CODE,
        resolved_max_tokens: kernelResult.resolvedFields.max_tokens as string,
        resolved_used_tokens: kernelResult.resolvedFields.used_tokens as string | number,
        resolved_utilization_pct: kernelResult.resolvedFields.utilization_pct as string | number | boolean | readonly string[],
        resolved_segment_breakdown: kernelResult.resolvedFields.segment_breakdown as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F115ContextWindowXrayInspectorTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F115_FEATURE_ID,
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

  public getAuditTrail(): readonly F115ContextWindowXrayInspectorAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F115ContextWindowXrayInspectorOutput[] {
    return [...this.executionHistory];
  }
}

export function verifyF115Module(): {
  featureId: typeof F115_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F115ContextWindowXrayInspectorEngine();
  const sampleInput: F115ContextWindowXrayInspectorInput = {
    requestId: "req_verify_f115",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    max_tokens: "f115_max_tokens_seed",
    used_tokens: 42,
    utilization_pct: true,
    segment_breakdown: "verified_seed",
    metadata: { stage: "stage4-intelligence-graph", featureNumber: 115 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F115" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_max_tokens !== sampleInput.max_tokens &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F115_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
