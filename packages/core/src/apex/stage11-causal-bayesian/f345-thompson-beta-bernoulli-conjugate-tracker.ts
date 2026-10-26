/**
 * F345 (stage11-causal-bayesian): Трекер сопряжённых априорных распределений Beta(alpha, beta) для стратегий агентов
 * Точный аналитический учёт успешных (alpha) и неуспешных (beta) исходов без численного дрейфа
 * Operation Code: thompson_beta_tracker
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

export const F345_FEATURE_ID = "F345" as const;
export const F345_STAGE = "stage11-causal-bayesian" as const;
export const F345_OPERATION_CODE = "thompson_beta_tracker" as const;
export const F345_CONTRACT_VERSION = "2.0.0" as const;

export type F345ThompsonBetaBernoulliConjugateTrackerConfig = BaseFeatureConfig<
  typeof F345_FEATURE_ID,
  typeof F345_STAGE,
  typeof F345_OPERATION_CODE
>;

export interface F345ThompsonBetaBernoulliConjugateTrackerInput extends BaseFeatureInput {
  readonly arm_id: string | number | boolean | readonly string[];
  readonly alpha_param: string | number | boolean | readonly string[];
  readonly beta_param: string | number | boolean | readonly string[];
  readonly posterior_mean: string | number | boolean | readonly string[];
}

export interface F345ThompsonBetaBernoulliConjugateTrackerOutput {
  readonly featureId: typeof F345_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F345_OPERATION_CODE;
  readonly resolved_arm_id: unknown;
  readonly resolved_alpha_param: unknown;
  readonly resolved_beta_param: unknown;
  readonly resolved_posterior_mean: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F345_FEATURE_ID>;
}

export type F345ThompsonBetaBernoulliConjugateTrackerTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F345_FEATURE_ID
>;

export const DEFAULT_F345_CONFIG: F345ThompsonBetaBernoulliConjugateTrackerConfig = {
  featureId: F345_FEATURE_ID,
  stage: F345_STAGE,
  operationCode: F345_OPERATION_CODE,
  contractVersion: F345_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F345ThompsonBetaBernoulliConjugateTrackerValidationError extends Error {
  public readonly featureId = F345_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F345 Validation Error on '${field}']: ${message}`);
    this.name = "F345ThompsonBetaBernoulliConjugateTrackerValidationError";
    this.field = field;
  }
}

export function computeF345Digest(rawPayload: string): string {
  return `f345_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F345ThompsonBetaBernoulliConjugateTrackerService extends KosmoraFeatureAdapterBase<
  typeof F345_FEATURE_ID,
  typeof F345_STAGE,
  typeof F345_OPERATION_CODE,
  F345ThompsonBetaBernoulliConjugateTrackerConfig,
  F345ThompsonBetaBernoulliConjugateTrackerInput,
  F345ThompsonBetaBernoulliConjugateTrackerOutput
> {
  constructor(
    customConfig?: Partial<F345ThompsonBetaBernoulliConjugateTrackerConfig>,
    kernel?: Stage11CausalBayesianKernel
  ) {
    super(
      DEFAULT_F345_CONFIG,
      customConfig,
      kernel ?? Stage11CausalBayesianKernel.getShared(),
      ["arm_id", "alpha_param", "beta_param", "posterior_mean"] as const,
      F345ThompsonBetaBernoulliConjugateTrackerValidationError
    );
  }
}

export function verifyF345Module(): {
  readonly featureId: typeof F345_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F345ThompsonBetaBernoulliConjugateTrackerService();
  const sampleInput: F345ThompsonBetaBernoulliConjugateTrackerInput = {
    requestId: "req_verify_f345",
    projectId: "proj_kosmora_f345",
    workspaceId: "ws_kosmora_f345",
    tenantId: "tenant_rlm_f345",
    actorId: "actor_verifier_f345",
    autonomyLevel: "A3",
    arm_id: "seed_f345_arm_id",
    alpha_param: 42,
    beta_param: true,
    posterior_mean: "seed_f345_posterior_mean",
    metadata: { stage: "stage11-causal-bayesian", featureId: "F345" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F345" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_arm_id !== sampleInput.arm_id &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F345] Verification failed`);
  }

  return {
    featureId: F345_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
