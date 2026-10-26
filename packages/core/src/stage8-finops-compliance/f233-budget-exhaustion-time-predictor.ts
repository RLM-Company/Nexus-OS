/**
 * F233 (stage8-finops-compliance): Предиктор остаточного времени работы тенанта до исчерпания лимита (Time-to-Exhaustion)
 * Расчёт количества часов до обнуления баланса при сохранении текущего наклона линии тренда
 * Operation Code: budget_exhaustion_time_predictor
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

export const F233_FEATURE_ID = "F233" as const;
export const F233_STAGE = "stage8-finops-compliance" as const;
export const F233_OPERATION_CODE = "budget_exhaustion_time_predictor" as const;
export const F233_CONTRACT_VERSION = "2.0.0" as const;

export type F233BudgetExhaustionTimePredictorConfig = BaseFeatureConfig<
  typeof F233_FEATURE_ID,
  typeof F233_STAGE,
  typeof F233_OPERATION_CODE
>;

export interface F233BudgetExhaustionTimePredictorInput extends BaseFeatureInput {
  readonly tenant_id: string | number | boolean | readonly string[];
  readonly remaining_budget_usd: string | number | boolean | readonly string[];
  readonly estimated_hours_until_exhaustion: string | number | boolean | readonly string[];
  readonly alert_level: string | number | boolean | readonly string[];
}

export interface F233BudgetExhaustionTimePredictorOutput {
  readonly featureId: typeof F233_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F233_OPERATION_CODE;
  readonly resolved_tenant_id: unknown;
  readonly resolved_remaining_budget_usd: unknown;
  readonly resolved_estimated_hours_until_exhaustion: unknown;
  readonly resolved_alert_level: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F233_FEATURE_ID>;
}

export type F233BudgetExhaustionTimePredictorTelemetrySnapshot = BaseFeatureTelemetry<typeof F233_FEATURE_ID>;

export const DEFAULT_F233_CONFIG: F233BudgetExhaustionTimePredictorConfig = {
  featureId: F233_FEATURE_ID,
  stage: F233_STAGE,
  operationCode: F233_OPERATION_CODE,
  contractVersion: F233_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F233BudgetExhaustionTimePredictorValidationError extends Error {
  public readonly featureId = F233_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F233 Validation Error on '${field}']: ${message}`);
    this.name = "F233BudgetExhaustionTimePredictorValidationError";
    this.field = field;
  }
}

export function computeF233Digest(rawPayload: string): string {
  return `f233_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F233BudgetExhaustionTimePredictorService extends KosmoraFeatureAdapterBase<
  typeof F233_FEATURE_ID,
  typeof F233_STAGE,
  typeof F233_OPERATION_CODE,
  F233BudgetExhaustionTimePredictorConfig,
  F233BudgetExhaustionTimePredictorInput,
  F233BudgetExhaustionTimePredictorOutput
> {
  constructor(customConfig?: Partial<F233BudgetExhaustionTimePredictorConfig>, kernel?: Stage8FinOpsKernel) {
    super(
      DEFAULT_F233_CONFIG,
      customConfig,
      kernel ?? Stage8FinOpsKernel.getShared(),
      ["tenant_id", "remaining_budget_usd", "estimated_hours_until_exhaustion", "alert_level"] as const,
      F233BudgetExhaustionTimePredictorValidationError
    );
  }
}

export function verifyF233Module(): {
  readonly featureId: typeof F233_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F233BudgetExhaustionTimePredictorService();
  const sampleInput: F233BudgetExhaustionTimePredictorInput = {
    requestId: "req_verify_f233",
    projectId: "proj_kosmora_f233",
    workspaceId: "ws_kosmora_f233",
    tenantId: "tenant_rlm_f233",
    actorId: "actor_verifier_f233",
    autonomyLevel: "A3",
    tenant_id: "seed_f233_tenant_id",
    remaining_budget_usd: 42,
    estimated_hours_until_exhaustion: true,
    alert_level: "seed_f233_alert_level",
    metadata: { stage: "stage8-finops-compliance", featureId: "F233" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F233" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_tenant_id !== sampleInput.tenant_id &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F233] Verification failed`);
  }

  return {
    featureId: F233_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
