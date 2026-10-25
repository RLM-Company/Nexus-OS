/**
 * F157 (stage5-enterprise): Graceful Degradation (Отказоустойчивый фоллбэк)
 * Автоматическое переключение на резервного провайдера модели при падении основного API
 * Operation Code: provider_failover_switch
 */

import { createHash } from "node:crypto";
import { Stage5EnterpriseKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F157_FEATURE_ID = "F157" as const;
export const F157_STAGE = "stage5-enterprise" as const;
export const F157_OPERATION_CODE = "provider_failover_switch" as const;
export const F157_CONTRACT_VERSION = "2.0.0" as const;

export type F157GracefulDegradationFailoverExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F157GracefulDegradationFailoverConfig {
  readonly featureId: typeof F157_FEATURE_ID;
  readonly stage: typeof F157_STAGE;
  readonly operationCode: typeof F157_OPERATION_CODE;
  readonly contractVersion: typeof F157_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F157GracefulDegradationFailoverInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly primary_provider: string;
  readonly backup_provider: string | number;
  readonly failover_activated: string | number | boolean | readonly string[];
  readonly continuity_preserved: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F157GracefulDegradationFailoverAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F157_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F157GracefulDegradationFailoverOutput {
  readonly featureId: typeof F157_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F157GracefulDegradationFailoverExecutionStatus;
  readonly operationCode: typeof F157_OPERATION_CODE;
  readonly resolved_primary_provider: string;
  readonly resolved_backup_provider: string | number;
  readonly resolved_failover_activated: string | number | boolean | readonly string[];
  readonly resolved_continuity_preserved: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F157GracefulDegradationFailoverAuditEntry;
}

export interface F157GracefulDegradationFailoverTelemetrySnapshot {
  readonly featureId: typeof F157_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F157_CONFIG: F157GracefulDegradationFailoverConfig = {
  featureId: F157_FEATURE_ID,
  stage: F157_STAGE,
  operationCode: F157_OPERATION_CODE,
  contractVersion: F157_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F157GracefulDegradationFailoverValidationError extends Error {
  public readonly featureId = F157_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F157 Validation Error on '${field}']: ${message}`);
    this.name = "F157GracefulDegradationFailoverValidationError";
    this.field = field;
  }
}

export function computeF157Digest(rawPayload: string): string {
  return `f157_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F157GracefulDegradationFailoverEngine {
  private readonly config: F157GracefulDegradationFailoverConfig;
  private readonly kernel: Stage5EnterpriseKernel;
  private readonly executionHistory: F157GracefulDegradationFailoverOutput[] = [];
  private readonly auditLog: F157GracefulDegradationFailoverAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F157GracefulDegradationFailoverOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F157GracefulDegradationFailoverConfig>, kernel?: Stage5EnterpriseKernel) {
    this.config = {
      ...DEFAULT_F157_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage5EnterpriseKernel();
  }

  public getConfig(): F157GracefulDegradationFailoverConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F157GracefulDegradationFailoverInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F157GracefulDegradationFailoverValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F157GracefulDegradationFailoverValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F157GracefulDegradationFailoverValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F157GracefulDegradationFailoverValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F157GracefulDegradationFailoverValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F157GracefulDegradationFailoverValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.primary_provider).trim().length === 0) {
      throw new F157GracefulDegradationFailoverValidationError("primary_provider", "Primary domain attribute 'primary_provider' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      primary_provider: input.primary_provider,
      backup_provider: input.backup_provider,
      failover_activated: input.failover_activated,
      continuity_preserved: input.continuity_preserved
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F157GracefulDegradationFailoverValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F157GracefulDegradationFailoverInput): F157GracefulDegradationFailoverOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F157_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        primary_provider: input.primary_provider,
        backup_provider: input.backup_provider,
        failover_activated: input.failover_activated,
        continuity_preserved: input.continuity_preserved
      });
      const payloadHash = computeF157Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F157GracefulDegradationFailoverValidationError(
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
        featureId: F157_FEATURE_ID,
        operationCode: F157_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          primary_provider: input.primary_provider,
          backup_provider: input.backup_provider,
          failover_activated: input.failover_activated,
          continuity_preserved: input.continuity_preserved
        }
      });

      const executionId = `exec_f157_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f157_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F157GracefulDegradationFailoverAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F157_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `provider_failover_switch:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F157GracefulDegradationFailoverOutput = {
        featureId: F157_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F157_OPERATION_CODE,
        resolved_primary_provider: kernelResult.resolvedFields.primary_provider as string,
        resolved_backup_provider: kernelResult.resolvedFields.backup_provider as string | number,
        resolved_failover_activated: kernelResult.resolvedFields.failover_activated as string | number | boolean | readonly string[],
        resolved_continuity_preserved: kernelResult.resolvedFields.continuity_preserved as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F157GracefulDegradationFailoverTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F157_FEATURE_ID,
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

  public getAuditTrail(): readonly F157GracefulDegradationFailoverAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F157GracefulDegradationFailoverOutput[] {
    return [...this.executionHistory];
  }
}

export function verifyF157Module(): {
  featureId: typeof F157_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F157GracefulDegradationFailoverEngine();
  const sampleInput: F157GracefulDegradationFailoverInput = {
    requestId: "req_verify_f157",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    primary_provider: "f157_primary_provider_seed",
    backup_provider: 42,
    failover_activated: true,
    continuity_preserved: "verified_seed",
    metadata: { stage: "stage5-enterprise", featureNumber: 157 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F157" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_primary_provider !== sampleInput.primary_provider &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F157_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
