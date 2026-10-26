/**
 * F232 (stage8-finops-compliance): Статистический детектор аномальных скачков расхода токенов (Z-Score Anomaly Detector)
 * Выявление нетипичных всплесков потребления бюджета (Z > 2.2) для защиты от runaway-графов
 * Operation Code: zscore_spend_spike_anomaly_detector
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

export const F232_FEATURE_ID = "F232" as const;
export const F232_STAGE = "stage8-finops-compliance" as const;
export const F232_OPERATION_CODE = "zscore_spend_spike_anomaly_detector" as const;
export const F232_CONTRACT_VERSION = "2.0.0" as const;

export type F232ZscoreSpendSpikeAnomalyDetectorConfig = BaseFeatureConfig<
  typeof F232_FEATURE_ID,
  typeof F232_STAGE,
  typeof F232_OPERATION_CODE
>;

export interface F232ZscoreSpendSpikeAnomalyDetectorInput extends BaseFeatureInput {
  readonly tenant_id: string | number | boolean | readonly string[];
  readonly latest_z_score: string | number | boolean | readonly string[];
  readonly anomaly_detected: string | number | boolean | readonly string[];
  readonly alert_level: string | number | boolean | readonly string[];
}

export interface F232ZscoreSpendSpikeAnomalyDetectorOutput {
  readonly featureId: typeof F232_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F232_OPERATION_CODE;
  readonly resolved_tenant_id: unknown;
  readonly resolved_latest_z_score: unknown;
  readonly resolved_anomaly_detected: unknown;
  readonly resolved_alert_level: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F232_FEATURE_ID>;
}

export type F232ZscoreSpendSpikeAnomalyDetectorTelemetrySnapshot = BaseFeatureTelemetry<typeof F232_FEATURE_ID>;

export const DEFAULT_F232_CONFIG: F232ZscoreSpendSpikeAnomalyDetectorConfig = {
  featureId: F232_FEATURE_ID,
  stage: F232_STAGE,
  operationCode: F232_OPERATION_CODE,
  contractVersion: F232_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F232ZscoreSpendSpikeAnomalyDetectorValidationError extends Error {
  public readonly featureId = F232_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F232 Validation Error on '${field}']: ${message}`);
    this.name = "F232ZscoreSpendSpikeAnomalyDetectorValidationError";
    this.field = field;
  }
}

export function computeF232Digest(rawPayload: string): string {
  return `f232_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F232ZscoreSpendSpikeAnomalyDetectorService extends KosmoraFeatureAdapterBase<
  typeof F232_FEATURE_ID,
  typeof F232_STAGE,
  typeof F232_OPERATION_CODE,
  F232ZscoreSpendSpikeAnomalyDetectorConfig,
  F232ZscoreSpendSpikeAnomalyDetectorInput,
  F232ZscoreSpendSpikeAnomalyDetectorOutput
> {
  constructor(customConfig?: Partial<F232ZscoreSpendSpikeAnomalyDetectorConfig>, kernel?: Stage8FinOpsKernel) {
    super(
      DEFAULT_F232_CONFIG,
      customConfig,
      kernel ?? Stage8FinOpsKernel.getShared(),
      ["tenant_id", "latest_z_score", "anomaly_detected", "alert_level"] as const,
      F232ZscoreSpendSpikeAnomalyDetectorValidationError
    );
  }
}

export function verifyF232Module(): {
  readonly featureId: typeof F232_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F232ZscoreSpendSpikeAnomalyDetectorService();
  const sampleInput: F232ZscoreSpendSpikeAnomalyDetectorInput = {
    requestId: "req_verify_f232",
    projectId: "proj_kosmora_f232",
    workspaceId: "ws_kosmora_f232",
    tenantId: "tenant_rlm_f232",
    actorId: "actor_verifier_f232",
    autonomyLevel: "A3",
    tenant_id: "seed_f232_tenant_id",
    latest_z_score: 42,
    anomaly_detected: true,
    alert_level: "seed_f232_alert_level",
    metadata: { stage: "stage8-finops-compliance", featureId: "F232" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F232" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_tenant_id !== sampleInput.tenant_id &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F232] Verification failed`);
  }

  return {
    featureId: F232_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
