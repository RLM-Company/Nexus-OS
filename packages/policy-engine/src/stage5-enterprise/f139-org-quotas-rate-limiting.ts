/**
 * F139 (stage5-enterprise): Квоты и Rate Limiting
 * Ограничение числа одновременных агентных графов и запросов в минуту на организацию
 * Operation Code: token_bucket_ratelimiter
 */

import { createHash } from "node:crypto";
import { Stage5EnterpriseKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F139_FEATURE_ID = "F139" as const;
export const F139_STAGE = "stage5-enterprise" as const;
export const F139_OPERATION_CODE = "token_bucket_ratelimiter" as const;
export const F139_CONTRACT_VERSION = "2.0.0" as const;

export type F139OrgQuotasRateLimitingExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F139OrgQuotasRateLimitingConfig {
  readonly featureId: typeof F139_FEATURE_ID;
  readonly stage: typeof F139_STAGE;
  readonly operationCode: typeof F139_OPERATION_CODE;
  readonly contractVersion: typeof F139_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F139OrgQuotasRateLimitingInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly tenant_id: string;
  readonly requests_per_minute: string | number;
  readonly concurrent_graphs: string | number | boolean | readonly string[];
  readonly throttled: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F139OrgQuotasRateLimitingAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F139_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F139OrgQuotasRateLimitingOutput {
  readonly featureId: typeof F139_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F139OrgQuotasRateLimitingExecutionStatus;
  readonly operationCode: typeof F139_OPERATION_CODE;
  readonly resolved_tenant_id: string;
  readonly resolved_requests_per_minute: string | number;
  readonly resolved_concurrent_graphs: string | number | boolean | readonly string[];
  readonly resolved_throttled: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F139OrgQuotasRateLimitingAuditEntry;
}

export interface F139OrgQuotasRateLimitingTelemetrySnapshot {
  readonly featureId: typeof F139_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F139_CONFIG: F139OrgQuotasRateLimitingConfig = {
  featureId: F139_FEATURE_ID,
  stage: F139_STAGE,
  operationCode: F139_OPERATION_CODE,
  contractVersion: F139_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F139OrgQuotasRateLimitingValidationError extends Error {
  public readonly featureId = F139_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F139 Validation Error on '${field}']: ${message}`);
    this.name = "F139OrgQuotasRateLimitingValidationError";
    this.field = field;
  }
}

export function computeF139Digest(rawPayload: string): string {
  return `f139_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F139OrgQuotasRateLimitingEngine {
  private readonly config: F139OrgQuotasRateLimitingConfig;
  private readonly kernel: Stage5EnterpriseKernel;
  private readonly executionHistory: F139OrgQuotasRateLimitingOutput[] = [];
  private readonly auditLog: F139OrgQuotasRateLimitingAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F139OrgQuotasRateLimitingOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F139OrgQuotasRateLimitingConfig>, kernel?: Stage5EnterpriseKernel) {
    this.config = {
      ...DEFAULT_F139_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage5EnterpriseKernel();
  }

  public getConfig(): F139OrgQuotasRateLimitingConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F139OrgQuotasRateLimitingInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F139OrgQuotasRateLimitingValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F139OrgQuotasRateLimitingValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F139OrgQuotasRateLimitingValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F139OrgQuotasRateLimitingValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F139OrgQuotasRateLimitingValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F139OrgQuotasRateLimitingValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.tenant_id).trim().length === 0) {
      throw new F139OrgQuotasRateLimitingValidationError("tenant_id", "Primary domain attribute 'tenant_id' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      tenant_id: input.tenant_id,
      requests_per_minute: input.requests_per_minute,
      concurrent_graphs: input.concurrent_graphs,
      throttled: input.throttled
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F139OrgQuotasRateLimitingValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F139OrgQuotasRateLimitingInput): F139OrgQuotasRateLimitingOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F139_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        tenant_id: input.tenant_id,
        requests_per_minute: input.requests_per_minute,
        concurrent_graphs: input.concurrent_graphs,
        throttled: input.throttled
      });
      const payloadHash = computeF139Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F139OrgQuotasRateLimitingValidationError(
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
        featureId: F139_FEATURE_ID,
        operationCode: F139_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          tenant_id: input.tenant_id,
          requests_per_minute: input.requests_per_minute,
          concurrent_graphs: input.concurrent_graphs,
          throttled: input.throttled
        }
      });

      const executionId = `exec_f139_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f139_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F139OrgQuotasRateLimitingAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F139_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `token_bucket_ratelimiter:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F139OrgQuotasRateLimitingOutput = {
        featureId: F139_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F139_OPERATION_CODE,
        resolved_tenant_id: kernelResult.resolvedFields.tenant_id as string,
        resolved_requests_per_minute: kernelResult.resolvedFields.requests_per_minute as string | number,
        resolved_concurrent_graphs: kernelResult.resolvedFields.concurrent_graphs as string | number | boolean | readonly string[],
        resolved_throttled: kernelResult.resolvedFields.throttled as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F139OrgQuotasRateLimitingTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F139_FEATURE_ID,
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

  public getAuditTrail(): readonly F139OrgQuotasRateLimitingAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F139OrgQuotasRateLimitingOutput[] {
    return [...this.executionHistory];
  }
}

export function verifyF139Module(): {
  featureId: typeof F139_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F139OrgQuotasRateLimitingEngine();
  const sampleInput: F139OrgQuotasRateLimitingInput = {
    requestId: "req_verify_f139",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    tenant_id: "f139_tenant_id_seed",
    requests_per_minute: 42,
    concurrent_graphs: true,
    throttled: "verified_seed",
    metadata: { stage: "stage5-enterprise", featureNumber: 139 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F139" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_tenant_id !== sampleInput.tenant_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F139_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
