/**
 * F346 (stage11-causal-bayesian): Детерминированный сэмплер апостериорного распределения Томпсона (Thompson Sampler)
 * Генерация выборок theta_i ~ Beta(alpha_i, beta_i) для оптимального баланса исследования и эксплуатации
 * Operation Code: thompson_posterior_sampler
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

export const F346_FEATURE_ID = "F346" as const;
export const F346_STAGE = "stage11-causal-bayesian" as const;
export const F346_OPERATION_CODE = "thompson_posterior_sampler" as const;
export const F346_CONTRACT_VERSION = "2.0.0" as const;

export type F346ThompsonPosteriorStochasticSamplerConfig = BaseFeatureConfig<
  typeof F346_FEATURE_ID,
  typeof F346_STAGE,
  typeof F346_OPERATION_CODE
>;

export interface F346ThompsonPosteriorStochasticSamplerInput extends BaseFeatureInput {
  readonly candidate_arms: string | number | boolean | readonly string[];
  readonly sampled_thetas: string | number | boolean | readonly string[];
  readonly selected_arm_id: string | number | boolean | readonly string[];
  readonly seed_digest: string | number | boolean | readonly string[];
}

export interface F346ThompsonPosteriorStochasticSamplerOutput {
  readonly featureId: typeof F346_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F346_OPERATION_CODE;
  readonly resolved_candidate_arms: unknown;
  readonly resolved_sampled_thetas: unknown;
  readonly resolved_selected_arm_id: unknown;
  readonly resolved_seed_digest: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F346_FEATURE_ID>;
}

export type F346ThompsonPosteriorStochasticSamplerTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F346_FEATURE_ID
>;

export const DEFAULT_F346_CONFIG: F346ThompsonPosteriorStochasticSamplerConfig = {
  featureId: F346_FEATURE_ID,
  stage: F346_STAGE,
  operationCode: F346_OPERATION_CODE,
  contractVersion: F346_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F346ThompsonPosteriorStochasticSamplerValidationError extends Error {
  public readonly featureId = F346_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F346 Validation Error on '${field}']: ${message}`);
    this.name = "F346ThompsonPosteriorStochasticSamplerValidationError";
    this.field = field;
  }
}

export function computeF346Digest(rawPayload: string): string {
  return `f346_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F346ThompsonPosteriorStochasticSamplerService extends KosmoraFeatureAdapterBase<
  typeof F346_FEATURE_ID,
  typeof F346_STAGE,
  typeof F346_OPERATION_CODE,
  F346ThompsonPosteriorStochasticSamplerConfig,
  F346ThompsonPosteriorStochasticSamplerInput,
  F346ThompsonPosteriorStochasticSamplerOutput
> {
  constructor(
    customConfig?: Partial<F346ThompsonPosteriorStochasticSamplerConfig>,
    kernel?: Stage11CausalBayesianKernel
  ) {
    super(
      DEFAULT_F346_CONFIG,
      customConfig,
      kernel ?? Stage11CausalBayesianKernel.getShared(),
      ["candidate_arms", "sampled_thetas", "selected_arm_id", "seed_digest"] as const,
      F346ThompsonPosteriorStochasticSamplerValidationError
    );
  }
}

export function verifyF346Module(): {
  readonly featureId: typeof F346_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F346ThompsonPosteriorStochasticSamplerService();
  const sampleInput: F346ThompsonPosteriorStochasticSamplerInput = {
    requestId: "req_verify_f346",
    projectId: "proj_kosmora_f346",
    workspaceId: "ws_kosmora_f346",
    tenantId: "tenant_rlm_f346",
    actorId: "actor_verifier_f346",
    autonomyLevel: "A3",
    candidate_arms: "seed_f346_candidate_arms",
    sampled_thetas: 42,
    selected_arm_id: true,
    seed_digest: "seed_f346_seed_digest",
    metadata: { stage: "stage11-causal-bayesian", featureId: "F346" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F346" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_candidate_arms !== sampleInput.candidate_arms &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F346] Verification failed`);
  }

  return {
    featureId: F346_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
