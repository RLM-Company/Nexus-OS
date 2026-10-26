/**
 * F344 (stage11-causal-bayesian): Калибратор точности вероятностных прогнозов по метрике Брайера (Brier Score)
 * Оценка среднеквадратичной погрешности байесовских оценок достоверности агентов
 * Operation Code: bayes_brier_evaluator
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
import { Stage11CausalBayesianKernel } from "./stage-kernel.js";

export const F344_FEATURE_ID = "F344" as const;
export const F344_STAGE = "stage11-causal-bayesian" as const;
export const F344_OPERATION_CODE = "bayes_brier_evaluator" as const;
export const F344_CONTRACT_VERSION = "2.0.0" as const;

export type F344BayesianCalibrationBrierScoreEvaluatorConfig = BaseFeatureConfig<
  typeof F344_FEATURE_ID,
  typeof F344_STAGE,
  typeof F344_OPERATION_CODE
>;

export interface F344BayesianCalibrationBrierScoreEvaluatorInput extends BaseFeatureInput {
  readonly predictions_count: string | number | boolean | readonly string[];
  readonly brier_score: string | number | boolean | readonly string[];
  readonly calibration_error: string | number | boolean | readonly string[];
  readonly well_calibrated: string | number | boolean | readonly string[];
}

export interface F344BayesianCalibrationBrierScoreEvaluatorOutput {
  readonly featureId: typeof F344_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F344_OPERATION_CODE;
  readonly resolved_predictions_count: unknown;
  readonly resolved_brier_score: unknown;
  readonly resolved_calibration_error: unknown;
  readonly resolved_well_calibrated: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F344_FEATURE_ID>;
}

export type F344BayesianCalibrationBrierScoreEvaluatorTelemetrySnapshot = BaseFeatureTelemetry<typeof F344_FEATURE_ID>;

export const DEFAULT_F344_CONFIG: F344BayesianCalibrationBrierScoreEvaluatorConfig = {
  featureId: F344_FEATURE_ID,
  stage: F344_STAGE,
  operationCode: F344_OPERATION_CODE,
  contractVersion: F344_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F344BayesianCalibrationBrierScoreEvaluatorValidationError extends Error {
  public readonly featureId = F344_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F344 Validation Error on '${field}']: ${message}`);
    this.name = "F344BayesianCalibrationBrierScoreEvaluatorValidationError";
    this.field = field;
  }
}

export function computeF344Digest(rawPayload: string): string {
  return `f344_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F344BayesianCalibrationBrierScoreEvaluatorService extends KosmoraFeatureAdapterBase<
  typeof F344_FEATURE_ID,
  typeof F344_STAGE,
  typeof F344_OPERATION_CODE,
  F344BayesianCalibrationBrierScoreEvaluatorConfig,
  F344BayesianCalibrationBrierScoreEvaluatorInput,
  F344BayesianCalibrationBrierScoreEvaluatorOutput
> {
  constructor(customConfig?: Partial<F344BayesianCalibrationBrierScoreEvaluatorConfig>, kernel?: Stage11CausalBayesianKernel) {
    super(
      DEFAULT_F344_CONFIG,
      customConfig,
      kernel ?? Stage11CausalBayesianKernel.getShared(),
      ["predictions_count", "brier_score", "calibration_error", "well_calibrated"] as const,
      F344BayesianCalibrationBrierScoreEvaluatorValidationError
    );
  }
}

export function verifyF344Module(): {
  readonly featureId: typeof F344_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F344BayesianCalibrationBrierScoreEvaluatorService();
  const sampleInput: F344BayesianCalibrationBrierScoreEvaluatorInput = {
    requestId: "req_verify_f344",
    projectId: "proj_kosmora_f344",
    workspaceId: "ws_kosmora_f344",
    tenantId: "tenant_rlm_f344",
    actorId: "actor_verifier_f344",
    autonomyLevel: "A3",
    predictions_count: "seed_f344_predictions_count",
    brier_score: 42,
    calibration_error: true,
    well_calibrated: "seed_f344_well_calibrated",
    metadata: { stage: "stage11-causal-bayesian", featureId: "F344" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F344" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_predictions_count !== sampleInput.predictions_count &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F344] Verification failed`);
  }

  return {
    featureId: F344_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
