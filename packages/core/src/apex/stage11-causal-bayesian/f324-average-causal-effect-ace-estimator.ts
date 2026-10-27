/**
 * F324 (stage11-causal-bayesian): Вычислитель среднего причинно-следственного эффекта (Average Causal Effect Estimator)
 * Точный расчёт разницы E[Y | do(X=1)] - E[Y | do(X=0)] по структурным уравнениям
 * Operation Code: ace_causal_estimator
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

export const F324_FEATURE_ID = "F324" as const;
export const F324_STAGE = "stage11-causal-bayesian" as const;
export const F324_OPERATION_CODE = "ace_causal_estimator" as const;
export const F324_CONTRACT_VERSION = "2.0.0" as const;

export type F324AverageCausalEffectAceEstimatorConfig = BaseFeatureConfig<
  typeof F324_FEATURE_ID,
  typeof F324_STAGE,
  typeof F324_OPERATION_CODE
>;

export interface F324AverageCausalEffectAceEstimatorInput extends BaseFeatureInput {
  readonly treatment_var: string | number | boolean | readonly string[];
  readonly outcome_var: string | number | boolean | readonly string[];
  readonly ace_delta: string | number | boolean | readonly string[];
  readonly confounding_bias: string | number | boolean | readonly string[];
}

export interface F324AverageCausalEffectAceEstimatorOutput {
  readonly featureId: typeof F324_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F324_OPERATION_CODE;
  readonly resolved_treatment_var: unknown;
  readonly resolved_outcome_var: unknown;
  readonly resolved_ace_delta: unknown;
  readonly resolved_confounding_bias: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F324_FEATURE_ID>;
}

export type F324AverageCausalEffectAceEstimatorTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F324_FEATURE_ID
>;

export const DEFAULT_F324_CONFIG: F324AverageCausalEffectAceEstimatorConfig = {
  featureId: F324_FEATURE_ID,
  stage: F324_STAGE,
  operationCode: F324_OPERATION_CODE,
  contractVersion: F324_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F324AverageCausalEffectAceEstimatorValidationError extends Error {
  public readonly featureId = F324_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F324 Validation Error on '${field}']: ${message}`);
    this.name = "F324AverageCausalEffectAceEstimatorValidationError";
    this.field = field;
  }
}

export function computeF324Digest(rawPayload: string): string {
  return `f324_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F324AverageCausalEffectAceEstimatorService extends KosmoraFeatureAdapterBase<
  typeof F324_FEATURE_ID,
  typeof F324_STAGE,
  typeof F324_OPERATION_CODE,
  F324AverageCausalEffectAceEstimatorConfig,
  F324AverageCausalEffectAceEstimatorInput,
  F324AverageCausalEffectAceEstimatorOutput
> {
  constructor(
    customConfig?: Partial<F324AverageCausalEffectAceEstimatorConfig>,
    kernel?: Stage11CausalBayesianKernel
  ) {
    super(
      DEFAULT_F324_CONFIG,
      customConfig,
      kernel ?? Stage11CausalBayesianKernel.getShared(),
      ["treatment_var", "outcome_var", "ace_delta", "confounding_bias"] as const,
      F324AverageCausalEffectAceEstimatorValidationError
    );
  }
}

export function verifyF324Module(): {
  readonly featureId: typeof F324_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F324AverageCausalEffectAceEstimatorService();
  const sampleInput: F324AverageCausalEffectAceEstimatorInput = {
    requestId: "req_verify_f324",
    projectId: "proj_kosmora_f324",
    workspaceId: "ws_kosmora_f324",
    tenantId: "tenant_rlm_f324",
    actorId: "actor_verifier_f324",
    autonomyLevel: "A3",
    treatment_var: "seed_f324_treatment_var",
    outcome_var: 42,
    ace_delta: true,
    confounding_bias: "seed_f324_confounding_bias",
    metadata: { stage: "stage11-causal-bayesian", featureId: "F324" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F324" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_treatment_var !== sampleInput.treatment_var &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F324] Verification failed`);
  }

  return {
    featureId: F324_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
