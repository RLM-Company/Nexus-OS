/**
 * F234 (stage8-finops-compliance): Многоуровневый классификатор финансовых инцидентов (Normal / Warning / Critical)
 * Автоматическая эскалация уведомлений владельцу холдинга при опасном ускорении расхода средств
 * Operation Code: multi_tier_finops_alert_escalator
 */

import { createHash } from "node:crypto";
import {
  KosmoraFeatureAdapterBase,
  type BaseFeatureAuditEntry,
  type BaseFeatureConfig,
  type BaseFeatureInput,
  type BaseFeatureTelemetry,
  type StageKernelExecutionResult
} from "../stage1-autonomy/stage-kernel.js";
import { Stage8FinOpsKernel } from "./stage-kernel.js";

export const F234_FEATURE_ID = "F234" as const;
export const F234_STAGE = "stage8-finops-compliance" as const;
export const F234_OPERATION_CODE = "multi_tier_finops_alert_escalator" as const;
export const F234_CONTRACT_VERSION = "2.0.0" as const;

export type F234MultiTierFinopsAlertEscalatorConfig = BaseFeatureConfig<
  typeof F234_FEATURE_ID,
  typeof F234_STAGE,
  typeof F234_OPERATION_CODE
>;

export interface F234MultiTierFinopsAlertEscalatorInput extends BaseFeatureInput {
  readonly tenant_id: string | number | boolean | readonly string[];
  readonly alert_level: string | number | boolean | readonly string[];
  readonly anomaly_detected: string | number | boolean | readonly string[];
  readonly forecast_digest: string | number | boolean | readonly string[];
}

export interface F234MultiTierFinopsAlertEscalatorOutput {
  readonly featureId: typeof F234_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F234_OPERATION_CODE;
  readonly resolved_tenant_id: unknown;
  readonly resolved_alert_level: unknown;
  readonly resolved_anomaly_detected: unknown;
  readonly resolved_forecast_digest: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F234_FEATURE_ID>;
}

export type F234MultiTierFinopsAlertEscalatorTelemetrySnapshot = BaseFeatureTelemetry<typeof F234_FEATURE_ID>;

export const DEFAULT_F234_CONFIG: F234MultiTierFinopsAlertEscalatorConfig = {
  featureId: F234_FEATURE_ID,
  stage: F234_STAGE,
  operationCode: F234_OPERATION_CODE,
  contractVersion: F234_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F234MultiTierFinopsAlertEscalatorValidationError extends Error {
  public readonly featureId = F234_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F234 Validation Error on '${field}']: ${message}`);
    this.name = "F234MultiTierFinopsAlertEscalatorValidationError";
    this.field = field;
  }
}

export function computeF234Digest(rawPayload: string): string {
  return `f234_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F234MultiTierFinopsAlertEscalatorService extends KosmoraFeatureAdapterBase<
  typeof F234_FEATURE_ID,
  typeof F234_STAGE,
  typeof F234_OPERATION_CODE,
  F234MultiTierFinopsAlertEscalatorConfig,
  F234MultiTierFinopsAlertEscalatorInput,
  F234MultiTierFinopsAlertEscalatorOutput
> {
  constructor(customConfig?: Partial<F234MultiTierFinopsAlertEscalatorConfig>, kernel?: Stage8FinOpsKernel) {
    super(
      DEFAULT_F234_CONFIG,
      customConfig,
      kernel ?? Stage8FinOpsKernel.getShared(),
      ["tenant_id", "alert_level", "anomaly_detected", "forecast_digest"] as const,
      F234MultiTierFinopsAlertEscalatorValidationError
    );
  }
}

export function verifyF234Module(): {
  readonly featureId: typeof F234_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F234MultiTierFinopsAlertEscalatorService();
  const sampleInput: F234MultiTierFinopsAlertEscalatorInput = {
    requestId: "req_verify_f234",
    projectId: "proj_kosmora_f234",
    workspaceId: "ws_kosmora_f234",
    tenantId: "tenant_rlm_f234",
    actorId: "actor_verifier_f234",
    autonomyLevel: "A3",
    tenant_id: "seed_f234_tenant_id",
    alert_level: 42,
    anomaly_detected: true,
    forecast_digest: "seed_f234_forecast_digest",
    metadata: { stage: "stage8-finops-compliance", featureId: "F234" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F234" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_tenant_id !== sampleInput.tenant_id &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F234] Verification failed`);
  }

  return {
    featureId: F234_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
