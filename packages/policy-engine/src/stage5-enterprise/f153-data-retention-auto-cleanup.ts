/**
 * F153 (stage5-enterprise): Политики хранения и автоочистки данных (Data Retention)
 * Автоматическое архивирование или удаление временных логов по расписанию
 * Operation Code: retention_policy_sweeper
 */

import { createHash } from "node:crypto";
import { Stage5EnterpriseKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F153_FEATURE_ID = "F153" as const;
export const F153_STAGE = "stage5-enterprise" as const;
export const F153_OPERATION_CODE = "retention_policy_sweeper" as const;
export const F153_CONTRACT_VERSION = "2.0.0" as const;

export type F153DataRetentionAutoCleanupExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F153DataRetentionAutoCleanupConfig {
  readonly featureId: typeof F153_FEATURE_ID;
  readonly stage: typeof F153_STAGE;
  readonly operationCode: typeof F153_OPERATION_CODE;
  readonly contractVersion: typeof F153_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F153DataRetentionAutoCleanupInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly policy_id: string;
  readonly max_age_days: string | number;
  readonly purged_records_count: string | number | boolean | readonly string[];
  readonly archived_records_count: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F153DataRetentionAutoCleanupAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F153_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F153DataRetentionAutoCleanupOutput {
  readonly featureId: typeof F153_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F153DataRetentionAutoCleanupExecutionStatus;
  readonly operationCode: typeof F153_OPERATION_CODE;
  readonly resolved_policy_id: string;
  readonly resolved_max_age_days: string | number;
  readonly resolved_purged_records_count: string | number | boolean | readonly string[];
  readonly resolved_archived_records_count: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F153DataRetentionAutoCleanupAuditEntry;
}

export interface F153DataRetentionAutoCleanupTelemetrySnapshot {
  readonly featureId: typeof F153_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F153_CONFIG: F153DataRetentionAutoCleanupConfig = {
  featureId: F153_FEATURE_ID,
  stage: F153_STAGE,
  operationCode: F153_OPERATION_CODE,
  contractVersion: F153_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F153DataRetentionAutoCleanupValidationError extends Error {
  public readonly featureId = F153_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F153 Validation Error on '${field}']: ${message}`);
    this.name = "F153DataRetentionAutoCleanupValidationError";
    this.field = field;
  }
}

export function computeF153Digest(rawPayload: string): string {
  return `f153_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F153DataRetentionAutoCleanupEngine {
  private readonly config: F153DataRetentionAutoCleanupConfig;
  private readonly kernel: Stage5EnterpriseKernel;
  private readonly executionHistory: F153DataRetentionAutoCleanupOutput[] = [];
  private readonly auditLog: F153DataRetentionAutoCleanupAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F153DataRetentionAutoCleanupOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F153DataRetentionAutoCleanupConfig>, kernel?: Stage5EnterpriseKernel) {
    this.config = {
      ...DEFAULT_F153_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage5EnterpriseKernel();
  }

  public getConfig(): F153DataRetentionAutoCleanupConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F153DataRetentionAutoCleanupInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F153DataRetentionAutoCleanupValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F153DataRetentionAutoCleanupValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F153DataRetentionAutoCleanupValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F153DataRetentionAutoCleanupValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F153DataRetentionAutoCleanupValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F153DataRetentionAutoCleanupValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.policy_id).trim().length === 0) {
      throw new F153DataRetentionAutoCleanupValidationError("policy_id", "Primary domain attribute 'policy_id' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      policy_id: input.policy_id,
      max_age_days: input.max_age_days,
      purged_records_count: input.purged_records_count,
      archived_records_count: input.archived_records_count
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F153DataRetentionAutoCleanupValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F153DataRetentionAutoCleanupInput): F153DataRetentionAutoCleanupOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F153_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        policy_id: input.policy_id,
        max_age_days: input.max_age_days,
        purged_records_count: input.purged_records_count,
        archived_records_count: input.archived_records_count
      });
      const payloadHash = computeF153Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F153DataRetentionAutoCleanupValidationError(
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
        featureId: F153_FEATURE_ID,
        operationCode: F153_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          policy_id: input.policy_id,
          max_age_days: input.max_age_days,
          purged_records_count: input.purged_records_count,
          archived_records_count: input.archived_records_count
        }
      });

      const executionId = `exec_f153_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f153_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F153DataRetentionAutoCleanupAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F153_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `retention_policy_sweeper:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F153DataRetentionAutoCleanupOutput = {
        featureId: F153_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F153_OPERATION_CODE,
        resolved_policy_id: kernelResult.resolvedFields.policy_id as string,
        resolved_max_age_days: kernelResult.resolvedFields.max_age_days as string | number,
        resolved_purged_records_count: kernelResult.resolvedFields.purged_records_count as string | number | boolean | readonly string[],
        resolved_archived_records_count: kernelResult.resolvedFields.archived_records_count as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F153DataRetentionAutoCleanupTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F153_FEATURE_ID,
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

  public getAuditTrail(): readonly F153DataRetentionAutoCleanupAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F153DataRetentionAutoCleanupOutput[] {
    return [...this.executionHistory];
  }
}

export function verifyF153Module(): {
  featureId: typeof F153_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F153DataRetentionAutoCleanupEngine();
  const sampleInput: F153DataRetentionAutoCleanupInput = {
    requestId: "req_verify_f153",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    policy_id: "f153_policy_id_seed",
    max_age_days: 42,
    purged_records_count: true,
    archived_records_count: "verified_seed",
    metadata: { stage: "stage5-enterprise", featureNumber: 153 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F153" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_policy_id !== sampleInput.policy_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F153_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
