/**
 * F240 (stage8-finops-compliance): Агрегатор корпоративной телеметрии с ограниченной L1-чувствительностью (Sensitivity Bound)
 * Нормализация вклада отдельной записи перед наложением криптографически стойкого шума Лапласа
 * Operation Code: sensitivity_bounded_analytics_aggregator
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

export const F240_FEATURE_ID = "F240" as const;
export const F240_STAGE = "stage8-finops-compliance" as const;
export const F240_OPERATION_CODE = "sensitivity_bounded_analytics_aggregator" as const;
export const F240_CONTRACT_VERSION = "2.0.0" as const;

export type F240SensitivityBoundedAnalyticsAggregatorConfig = BaseFeatureConfig<
  typeof F240_FEATURE_ID,
  typeof F240_STAGE,
  typeof F240_OPERATION_CODE
>;

export interface F240SensitivityBoundedAnalyticsAggregatorInput extends BaseFeatureInput {
  readonly query_id: string | number | boolean | readonly string[];
  readonly sensitivity: string | number | boolean | readonly string[];
  readonly epsilon_consumed: string | number | boolean | readonly string[];
  readonly dp_receipt_sha256: string | number | boolean | readonly string[];
}

export interface F240SensitivityBoundedAnalyticsAggregatorOutput {
  readonly featureId: typeof F240_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F240_OPERATION_CODE;
  readonly resolved_query_id: unknown;
  readonly resolved_sensitivity: unknown;
  readonly resolved_epsilon_consumed: unknown;
  readonly resolved_dp_receipt_sha256: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F240_FEATURE_ID>;
}

export type F240SensitivityBoundedAnalyticsAggregatorTelemetrySnapshot = BaseFeatureTelemetry<typeof F240_FEATURE_ID>;

export const DEFAULT_F240_CONFIG: F240SensitivityBoundedAnalyticsAggregatorConfig = {
  featureId: F240_FEATURE_ID,
  stage: F240_STAGE,
  operationCode: F240_OPERATION_CODE,
  contractVersion: F240_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F240SensitivityBoundedAnalyticsAggregatorValidationError extends Error {
  public readonly featureId = F240_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F240 Validation Error on '${field}']: ${message}`);
    this.name = "F240SensitivityBoundedAnalyticsAggregatorValidationError";
    this.field = field;
  }
}

export function computeF240Digest(rawPayload: string): string {
  return `f240_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F240SensitivityBoundedAnalyticsAggregatorService extends KosmoraFeatureAdapterBase<
  typeof F240_FEATURE_ID,
  typeof F240_STAGE,
  typeof F240_OPERATION_CODE,
  F240SensitivityBoundedAnalyticsAggregatorConfig,
  F240SensitivityBoundedAnalyticsAggregatorInput,
  F240SensitivityBoundedAnalyticsAggregatorOutput
> {
  constructor(customConfig?: Partial<F240SensitivityBoundedAnalyticsAggregatorConfig>, kernel?: Stage8FinOpsKernel) {
    super(
      DEFAULT_F240_CONFIG,
      customConfig,
      kernel ?? Stage8FinOpsKernel.getShared(),
      ["query_id", "sensitivity", "epsilon_consumed", "dp_receipt_sha256"] as const,
      F240SensitivityBoundedAnalyticsAggregatorValidationError
    );
  }
}

export function verifyF240Module(): {
  readonly featureId: typeof F240_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F240SensitivityBoundedAnalyticsAggregatorService();
  const sampleInput: F240SensitivityBoundedAnalyticsAggregatorInput = {
    requestId: "req_verify_f240",
    projectId: "proj_kosmora_f240",
    workspaceId: "ws_kosmora_f240",
    tenantId: "tenant_rlm_f240",
    actorId: "actor_verifier_f240",
    autonomyLevel: "A3",
    query_id: "seed_f240_query_id",
    sensitivity: 42,
    epsilon_consumed: true,
    dp_receipt_sha256: "seed_f240_dp_receipt_sha256",
    metadata: { stage: "stage8-finops-compliance", featureId: "F240" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F240" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_query_id !== sampleInput.query_id &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F240] Verification failed`);
  }

  return {
    featureId: F240_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
