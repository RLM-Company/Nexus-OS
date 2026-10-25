/**
 * F159 (stage5-enterprise): Мониторинг квот хранилища и индексации
 * Контроль объёма загруженных файлов, таблиц и векторных индексов по каждому проекту
 * Operation Code: storage_quota_meter
 */

import { createHash } from "node:crypto";
import { Stage5EnterpriseKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F159_FEATURE_ID = "F159" as const;
export const F159_STAGE = "stage5-enterprise" as const;
export const F159_OPERATION_CODE = "storage_quota_meter" as const;
export const F159_CONTRACT_VERSION = "2.0.0" as const;

export type F159StorageIndexingQuotaMonitorExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F159StorageIndexingQuotaMonitorConfig {
  readonly featureId: typeof F159_FEATURE_ID;
  readonly stage: typeof F159_STAGE;
  readonly operationCode: typeof F159_OPERATION_CODE;
  readonly contractVersion: typeof F159_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F159StorageIndexingQuotaMonitorInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly project_id: string;
  readonly used_megabytes: string | number;
  readonly quota_limit_megabytes: string | number | boolean | readonly string[];
  readonly alert_threshold_reached: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F159StorageIndexingQuotaMonitorAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F159_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F159StorageIndexingQuotaMonitorOutput {
  readonly featureId: typeof F159_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F159StorageIndexingQuotaMonitorExecutionStatus;
  readonly operationCode: typeof F159_OPERATION_CODE;
  readonly resolved_project_id: string;
  readonly resolved_used_megabytes: string | number;
  readonly resolved_quota_limit_megabytes: string | number | boolean | readonly string[];
  readonly resolved_alert_threshold_reached: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F159StorageIndexingQuotaMonitorAuditEntry;
}

export interface F159StorageIndexingQuotaMonitorTelemetrySnapshot {
  readonly featureId: typeof F159_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F159_CONFIG: F159StorageIndexingQuotaMonitorConfig = {
  featureId: F159_FEATURE_ID,
  stage: F159_STAGE,
  operationCode: F159_OPERATION_CODE,
  contractVersion: F159_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F159StorageIndexingQuotaMonitorValidationError extends Error {
  public readonly featureId = F159_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F159 Validation Error on '${field}']: ${message}`);
    this.name = "F159StorageIndexingQuotaMonitorValidationError";
    this.field = field;
  }
}

export function computeF159Digest(rawPayload: string): string {
  return `f159_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F159StorageIndexingQuotaMonitorEngine {
  private readonly config: F159StorageIndexingQuotaMonitorConfig;
  private readonly kernel: Stage5EnterpriseKernel;
  private readonly executionHistory: F159StorageIndexingQuotaMonitorOutput[] = [];
  private readonly auditLog: F159StorageIndexingQuotaMonitorAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F159StorageIndexingQuotaMonitorOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F159StorageIndexingQuotaMonitorConfig>, kernel?: Stage5EnterpriseKernel) {
    this.config = {
      ...DEFAULT_F159_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage5EnterpriseKernel();
  }

  public getConfig(): F159StorageIndexingQuotaMonitorConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F159StorageIndexingQuotaMonitorInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F159StorageIndexingQuotaMonitorValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F159StorageIndexingQuotaMonitorValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F159StorageIndexingQuotaMonitorValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F159StorageIndexingQuotaMonitorValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F159StorageIndexingQuotaMonitorValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F159StorageIndexingQuotaMonitorValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.project_id).trim().length === 0) {
      throw new F159StorageIndexingQuotaMonitorValidationError("project_id", "Primary domain attribute 'project_id' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      project_id: input.project_id,
      used_megabytes: input.used_megabytes,
      quota_limit_megabytes: input.quota_limit_megabytes,
      alert_threshold_reached: input.alert_threshold_reached
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F159StorageIndexingQuotaMonitorValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F159StorageIndexingQuotaMonitorInput): F159StorageIndexingQuotaMonitorOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F159_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        project_id: input.project_id,
        used_megabytes: input.used_megabytes,
        quota_limit_megabytes: input.quota_limit_megabytes,
        alert_threshold_reached: input.alert_threshold_reached
      });
      const payloadHash = computeF159Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F159StorageIndexingQuotaMonitorValidationError(
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
        featureId: F159_FEATURE_ID,
        operationCode: F159_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          project_id: input.project_id,
          used_megabytes: input.used_megabytes,
          quota_limit_megabytes: input.quota_limit_megabytes,
          alert_threshold_reached: input.alert_threshold_reached
        }
      });

      const executionId = `exec_f159_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f159_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F159StorageIndexingQuotaMonitorAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F159_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `storage_quota_meter:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F159StorageIndexingQuotaMonitorOutput = {
        featureId: F159_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F159_OPERATION_CODE,
        resolved_project_id: kernelResult.resolvedFields.project_id as string,
        resolved_used_megabytes: kernelResult.resolvedFields.used_megabytes as string | number,
        resolved_quota_limit_megabytes: kernelResult.resolvedFields.quota_limit_megabytes as string | number | boolean | readonly string[],
        resolved_alert_threshold_reached: kernelResult.resolvedFields.alert_threshold_reached as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F159StorageIndexingQuotaMonitorTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F159_FEATURE_ID,
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

  public getAuditTrail(): readonly F159StorageIndexingQuotaMonitorAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F159StorageIndexingQuotaMonitorOutput[] {
    return [...this.executionHistory];
  }
}

export function verifyF159Module(): {
  featureId: typeof F159_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F159StorageIndexingQuotaMonitorEngine();
  const sampleInput: F159StorageIndexingQuotaMonitorInput = {
    requestId: "req_verify_f159",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    project_id: "f159_project_id_seed",
    used_megabytes: 42,
    quota_limit_megabytes: true,
    alert_threshold_reached: "verified_seed",
    metadata: { stage: "stage5-enterprise", featureNumber: 159 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F159" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_project_id !== sampleInput.project_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F159_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
