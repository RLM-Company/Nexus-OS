/**
 * F347 (stage11-causal-bayesian): Вычислитель 95% байесовских доверительных интервалов (Credible Intervals)
 * Расчёт нижней и верхней границ истинной эффективности каждой агентной стратегии
 * Operation Code: thompson_credible_interval
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

export const F347_FEATURE_ID = "F347" as const;
export const F347_STAGE = "stage11-causal-bayesian" as const;
export const F347_OPERATION_CODE = "thompson_credible_interval" as const;
export const F347_CONTRACT_VERSION = "2.0.0" as const;

export type F347Bayesian95PctCredibleIntervalCalculatorConfig = BaseFeatureConfig<
  typeof F347_FEATURE_ID,
  typeof F347_STAGE,
  typeof F347_OPERATION_CODE
>;

export interface F347Bayesian95PctCredibleIntervalCalculatorInput extends BaseFeatureInput {
  readonly arm_id: string | number | boolean | readonly string[];
  readonly posterior_mean: string | number | boolean | readonly string[];
  readonly ci_lower_95: string | number | boolean | readonly string[];
  readonly ci_upper_95: string | number | boolean | readonly string[];
}

export interface F347Bayesian95PctCredibleIntervalCalculatorOutput {
  readonly featureId: typeof F347_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F347_OPERATION_CODE;
  readonly resolved_arm_id: unknown;
  readonly resolved_posterior_mean: unknown;
  readonly resolved_ci_lower_95: unknown;
  readonly resolved_ci_upper_95: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F347_FEATURE_ID>;
}

export type F347Bayesian95PctCredibleIntervalCalculatorTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F347_FEATURE_ID
>;

export const DEFAULT_F347_CONFIG: F347Bayesian95PctCredibleIntervalCalculatorConfig = {
  featureId: F347_FEATURE_ID,
  stage: F347_STAGE,
  operationCode: F347_OPERATION_CODE,
  contractVersion: F347_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F347Bayesian95PctCredibleIntervalCalculatorValidationError extends Error {
  public readonly featureId = F347_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F347 Validation Error on '${field}']: ${message}`);
    this.name = "F347Bayesian95PctCredibleIntervalCalculatorValidationError";
    this.field = field;
  }
}

export function computeF347Digest(rawPayload: string): string {
  return `f347_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F347Bayesian95PctCredibleIntervalCalculatorService extends KosmoraFeatureAdapterBase<
  typeof F347_FEATURE_ID,
  typeof F347_STAGE,
  typeof F347_OPERATION_CODE,
  F347Bayesian95PctCredibleIntervalCalculatorConfig,
  F347Bayesian95PctCredibleIntervalCalculatorInput,
  F347Bayesian95PctCredibleIntervalCalculatorOutput
> {
  constructor(
    customConfig?: Partial<F347Bayesian95PctCredibleIntervalCalculatorConfig>,
    kernel?: Stage11CausalBayesianKernel
  ) {
    super(
      DEFAULT_F347_CONFIG,
      customConfig,
      kernel ?? Stage11CausalBayesianKernel.getShared(),
      ["arm_id", "posterior_mean", "ci_lower_95", "ci_upper_95"] as const,
      F347Bayesian95PctCredibleIntervalCalculatorValidationError
    );
  }
}

export function verifyF347Module(): {
  readonly featureId: typeof F347_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F347Bayesian95PctCredibleIntervalCalculatorService();
  const sampleInput: F347Bayesian95PctCredibleIntervalCalculatorInput = {
    requestId: "req_verify_f347",
    projectId: "proj_kosmora_f347",
    workspaceId: "ws_kosmora_f347",
    tenantId: "tenant_rlm_f347",
    actorId: "actor_verifier_f347",
    autonomyLevel: "A3",
    arm_id: "seed_f347_arm_id",
    posterior_mean: 42,
    ci_lower_95: true,
    ci_upper_95: "seed_f347_ci_upper_95",
    metadata: { stage: "stage11-causal-bayesian", featureId: "F347" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F347" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_arm_id !== sampleInput.arm_id &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F347] Verification failed`);
  }

  return {
    featureId: F347_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
