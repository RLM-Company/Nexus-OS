/**
 * F153 (stage5-enterprise): Политики хранения и автоочистки данных (Data Retention)
 * Автоматическое архивирование или удаление временных логов по расписанию
 * Operation Code: retention_policy_sweeper
 */

import { createHash } from "node:crypto";
import {
  Stage5EnterpriseKernel,
  KosmoraFeatureAdapterBase,
  type BaseFeatureAuditEntry,
  type BaseFeatureConfig,
  type BaseFeatureInput,
  type BaseFeatureTelemetry,
  type StageKernelExecutionResult
} from "./stage-kernel.js";

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

export type F153DataRetentionAutoCleanupConfig = BaseFeatureConfig<
  typeof F153_FEATURE_ID,
  typeof F153_STAGE,
  typeof F153_OPERATION_CODE
>;

export interface F153DataRetentionAutoCleanupInput extends BaseFeatureInput {
  readonly policy_id: string;
  readonly max_age_days: string | number;
  readonly purged_records_count: string | number | boolean | readonly string[];
  readonly archived_records_count: string | number | boolean | Record<string, unknown>;
}

export type F153DataRetentionAutoCleanupAuditEntry = BaseFeatureAuditEntry<typeof F153_FEATURE_ID>;

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

export type F153DataRetentionAutoCleanupTelemetrySnapshot = BaseFeatureTelemetry<typeof F153_FEATURE_ID>;

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

export class F153DataRetentionAutoCleanupEngine extends KosmoraFeatureAdapterBase<
  typeof F153_FEATURE_ID,
  typeof F153_STAGE,
  typeof F153_OPERATION_CODE,
  F153DataRetentionAutoCleanupConfig,
  F153DataRetentionAutoCleanupInput,
  F153DataRetentionAutoCleanupOutput
> {
  constructor(customConfig?: Partial<F153DataRetentionAutoCleanupConfig>, kernel?: Stage5EnterpriseKernel) {
    super(
      DEFAULT_F153_CONFIG,
      customConfig,
      kernel ?? new Stage5EnterpriseKernel(),
      ["policy_id", "max_age_days", "purged_records_count", "archived_records_count"] as const,
      F153DataRetentionAutoCleanupValidationError
    );
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
