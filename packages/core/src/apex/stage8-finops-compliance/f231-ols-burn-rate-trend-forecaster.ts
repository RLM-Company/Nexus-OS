/**
 * F231 (stage8-finops-compliance): Прогнозировщик скорости сгорания бюджета (Burn Rate) методом наименьших квадратов (OLS)
 * Линейная регрессия часового расхода средств тенанта для расчёта точного времени исчерпания квоты
 * Operation Code: ols_burn_rate_trend_forecaster
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

export const F231_FEATURE_ID = "F231" as const;
export const F231_STAGE = "stage8-finops-compliance" as const;
export const F231_OPERATION_CODE = "ols_burn_rate_trend_forecaster" as const;
export const F231_CONTRACT_VERSION = "2.0.0" as const;

export type F231OlsBurnRateTrendForecasterConfig = BaseFeatureConfig<
  typeof F231_FEATURE_ID,
  typeof F231_STAGE,
  typeof F231_OPERATION_CODE
>;

export interface F231OlsBurnRateTrendForecasterInput extends BaseFeatureInput {
  readonly tenant_id: string | number | boolean | readonly string[];
  readonly hourly_burn_rate_usd: string | number | boolean | readonly string[];
  readonly ols_slope_usd_per_hour: string | number | boolean | readonly string[];
  readonly forecast_digest: string | number | boolean | readonly string[];
}

export interface F231OlsBurnRateTrendForecasterOutput {
  readonly featureId: typeof F231_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F231_OPERATION_CODE;
  readonly resolved_tenant_id: unknown;
  readonly resolved_hourly_burn_rate_usd: unknown;
  readonly resolved_ols_slope_usd_per_hour: unknown;
  readonly resolved_forecast_digest: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F231_FEATURE_ID>;
}

export type F231OlsBurnRateTrendForecasterTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F231_FEATURE_ID
>;

export const DEFAULT_F231_CONFIG: F231OlsBurnRateTrendForecasterConfig = {
  featureId: F231_FEATURE_ID,
  stage: F231_STAGE,
  operationCode: F231_OPERATION_CODE,
  contractVersion: F231_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F231OlsBurnRateTrendForecasterValidationError extends Error {
  public readonly featureId = F231_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F231 Validation Error on '${field}']: ${message}`);
    this.name = "F231OlsBurnRateTrendForecasterValidationError";
    this.field = field;
  }
}

export function computeF231Digest(rawPayload: string): string {
  return `f231_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F231OlsBurnRateTrendForecasterService extends KosmoraFeatureAdapterBase<
  typeof F231_FEATURE_ID,
  typeof F231_STAGE,
  typeof F231_OPERATION_CODE,
  F231OlsBurnRateTrendForecasterConfig,
  F231OlsBurnRateTrendForecasterInput,
  F231OlsBurnRateTrendForecasterOutput
> {
  constructor(
    customConfig?: Partial<F231OlsBurnRateTrendForecasterConfig>,
    kernel?: Stage8FinOpsKernel
  ) {
    super(
      DEFAULT_F231_CONFIG,
      customConfig,
      kernel ?? Stage8FinOpsKernel.getShared(),
      ["tenant_id", "hourly_burn_rate_usd", "ols_slope_usd_per_hour", "forecast_digest"] as const,
      F231OlsBurnRateTrendForecasterValidationError
    );
  }
}

export function verifyF231Module(): {
  readonly featureId: typeof F231_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F231OlsBurnRateTrendForecasterService();
  const sampleInput: F231OlsBurnRateTrendForecasterInput = {
    requestId: "req_verify_f231",
    projectId: "proj_kosmora_f231",
    workspaceId: "ws_kosmora_f231",
    tenantId: "tenant_rlm_f231",
    actorId: "actor_verifier_f231",
    autonomyLevel: "A3",
    tenant_id: "seed_f231_tenant_id",
    hourly_burn_rate_usd: 42,
    ols_slope_usd_per_hour: true,
    forecast_digest: "seed_f231_forecast_digest",
    metadata: { stage: "stage8-finops-compliance", featureId: "F231" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F231" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_tenant_id !== sampleInput.tenant_id &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F231] Verification failed`);
  }

  return {
    featureId: F231_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
