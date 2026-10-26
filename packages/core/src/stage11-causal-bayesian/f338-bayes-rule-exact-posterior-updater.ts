/**
 * F338 (stage11-causal-bayesian): Движок точного байесовского обновления апостериорных вероятностей P(H | E)
 * Пересчёт распределения вероятностей гипотез при поступлении новых диагностических сигналов
 * Operation Code: bayes_posterior_updater
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

export const F338_FEATURE_ID = "F338" as const;
export const F338_STAGE = "stage11-causal-bayesian" as const;
export const F338_OPERATION_CODE = "bayes_posterior_updater" as const;
export const F338_CONTRACT_VERSION = "2.0.0" as const;

export type F338BayesRuleExactPosteriorUpdaterConfig = BaseFeatureConfig<
  typeof F338_FEATURE_ID,
  typeof F338_STAGE,
  typeof F338_OPERATION_CODE
>;

export interface F338BayesRuleExactPosteriorUpdaterInput extends BaseFeatureInput {
  readonly evidence_map: string | number | boolean | readonly string[];
  readonly posterior_vector: string | number | boolean | readonly string[];
  readonly marginal_likelihood: string | number | boolean | readonly string[];
  readonly update_verified: string | number | boolean | readonly string[];
}

export interface F338BayesRuleExactPosteriorUpdaterOutput {
  readonly featureId: typeof F338_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F338_OPERATION_CODE;
  readonly resolved_evidence_map: unknown;
  readonly resolved_posterior_vector: unknown;
  readonly resolved_marginal_likelihood: unknown;
  readonly resolved_update_verified: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F338_FEATURE_ID>;
}

export type F338BayesRuleExactPosteriorUpdaterTelemetrySnapshot = BaseFeatureTelemetry<typeof F338_FEATURE_ID>;

export const DEFAULT_F338_CONFIG: F338BayesRuleExactPosteriorUpdaterConfig = {
  featureId: F338_FEATURE_ID,
  stage: F338_STAGE,
  operationCode: F338_OPERATION_CODE,
  contractVersion: F338_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F338BayesRuleExactPosteriorUpdaterValidationError extends Error {
  public readonly featureId = F338_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F338 Validation Error on '${field}']: ${message}`);
    this.name = "F338BayesRuleExactPosteriorUpdaterValidationError";
    this.field = field;
  }
}

export function computeF338Digest(rawPayload: string): string {
  return `f338_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F338BayesRuleExactPosteriorUpdaterService extends KosmoraFeatureAdapterBase<
  typeof F338_FEATURE_ID,
  typeof F338_STAGE,
  typeof F338_OPERATION_CODE,
  F338BayesRuleExactPosteriorUpdaterConfig,
  F338BayesRuleExactPosteriorUpdaterInput,
  F338BayesRuleExactPosteriorUpdaterOutput
> {
  constructor(customConfig?: Partial<F338BayesRuleExactPosteriorUpdaterConfig>, kernel?: Stage11CausalBayesianKernel) {
    super(
      DEFAULT_F338_CONFIG,
      customConfig,
      kernel ?? Stage11CausalBayesianKernel.getShared(),
      ["evidence_map", "posterior_vector", "marginal_likelihood", "update_verified"] as const,
      F338BayesRuleExactPosteriorUpdaterValidationError
    );
  }
}

export function verifyF338Module(): {
  readonly featureId: typeof F338_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F338BayesRuleExactPosteriorUpdaterService();
  const sampleInput: F338BayesRuleExactPosteriorUpdaterInput = {
    requestId: "req_verify_f338",
    projectId: "proj_kosmora_f338",
    workspaceId: "ws_kosmora_f338",
    tenantId: "tenant_rlm_f338",
    actorId: "actor_verifier_f338",
    autonomyLevel: "A3",
    evidence_map: "seed_f338_evidence_map",
    posterior_vector: 42,
    marginal_likelihood: true,
    update_verified: "seed_f338_update_verified",
    metadata: { stage: "stage11-causal-bayesian", featureId: "F338" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F338" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_evidence_map !== sampleInput.evidence_map &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F338] Verification failed`);
  }

  return {
    featureId: F338_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
