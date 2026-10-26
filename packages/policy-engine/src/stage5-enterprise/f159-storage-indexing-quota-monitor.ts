/**
 * F159 (stage5-enterprise): Мониторинг квот хранилища и индексации
 * Контроль объёма загруженных файлов, таблиц и векторных индексов по каждому проекту
 * Operation Code: storage_quota_meter
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

export type F159StorageIndexingQuotaMonitorConfig = BaseFeatureConfig<
  typeof F159_FEATURE_ID,
  typeof F159_STAGE,
  typeof F159_OPERATION_CODE
>;

export interface F159StorageIndexingQuotaMonitorInput extends BaseFeatureInput {
  readonly project_id: string;
  readonly used_megabytes: string | number;
  readonly quota_limit_megabytes: string | number | boolean | readonly string[];
  readonly alert_threshold_reached: string | number | boolean | Record<string, unknown>;
}

export type F159StorageIndexingQuotaMonitorAuditEntry = BaseFeatureAuditEntry<typeof F159_FEATURE_ID>;

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

export type F159StorageIndexingQuotaMonitorTelemetrySnapshot = BaseFeatureTelemetry<typeof F159_FEATURE_ID>;

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

export class F159StorageIndexingQuotaMonitorEngine extends KosmoraFeatureAdapterBase<
  typeof F159_FEATURE_ID,
  typeof F159_STAGE,
  typeof F159_OPERATION_CODE,
  F159StorageIndexingQuotaMonitorConfig,
  F159StorageIndexingQuotaMonitorInput,
  F159StorageIndexingQuotaMonitorOutput
> {
  constructor(customConfig?: Partial<F159StorageIndexingQuotaMonitorConfig>, kernel?: Stage5EnterpriseKernel) {
    super(
      DEFAULT_F159_CONFIG,
      customConfig,
      kernel ?? new Stage5EnterpriseKernel(),
      ["project_id", "used_megabytes", "quota_limit_megabytes", "alert_threshold_reached"] as const,
      F159StorageIndexingQuotaMonitorValidationError
    );
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
