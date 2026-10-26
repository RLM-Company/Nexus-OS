/**
 * F337 (stage11-causal-bayesian): Конструктор априорных распределений и таблиц условных вероятностей (CPT Builder)
 * Задание априорных вероятностей гипотез P(H) и функций правдоподобия P(E | H) для диагностики
 * Operation Code: bayes_cpt_builder
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

export const F337_FEATURE_ID = "F337" as const;
export const F337_STAGE = "stage11-causal-bayesian" as const;
export const F337_OPERATION_CODE = "bayes_cpt_builder" as const;
export const F337_CONTRACT_VERSION = "2.0.0" as const;

export type F337BayesianCptPriorNetworkBuilderConfig = BaseFeatureConfig<
  typeof F337_FEATURE_ID,
  typeof F337_STAGE,
  typeof F337_OPERATION_CODE
>;

export interface F337BayesianCptPriorNetworkBuilderInput extends BaseFeatureInput {
  readonly hypothesis_ids: string | number | boolean | readonly string[];
  readonly prior_vector: string | number | boolean | readonly string[];
  readonly cpt_matrix_dim: string | number | boolean | readonly string[];
  readonly normalization_ok: string | number | boolean | readonly string[];
}

export interface F337BayesianCptPriorNetworkBuilderOutput {
  readonly featureId: typeof F337_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F337_OPERATION_CODE;
  readonly resolved_hypothesis_ids: unknown;
  readonly resolved_prior_vector: unknown;
  readonly resolved_cpt_matrix_dim: unknown;
  readonly resolved_normalization_ok: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F337_FEATURE_ID>;
}

export type F337BayesianCptPriorNetworkBuilderTelemetrySnapshot = BaseFeatureTelemetry<typeof F337_FEATURE_ID>;

export const DEFAULT_F337_CONFIG: F337BayesianCptPriorNetworkBuilderConfig = {
  featureId: F337_FEATURE_ID,
  stage: F337_STAGE,
  operationCode: F337_OPERATION_CODE,
  contractVersion: F337_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F337BayesianCptPriorNetworkBuilderValidationError extends Error {
  public readonly featureId = F337_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F337 Validation Error on '${field}']: ${message}`);
    this.name = "F337BayesianCptPriorNetworkBuilderValidationError";
    this.field = field;
  }
}

export function computeF337Digest(rawPayload: string): string {
  return `f337_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F337BayesianCptPriorNetworkBuilderService extends KosmoraFeatureAdapterBase<
  typeof F337_FEATURE_ID,
  typeof F337_STAGE,
  typeof F337_OPERATION_CODE,
  F337BayesianCptPriorNetworkBuilderConfig,
  F337BayesianCptPriorNetworkBuilderInput,
  F337BayesianCptPriorNetworkBuilderOutput
> {
  constructor(customConfig?: Partial<F337BayesianCptPriorNetworkBuilderConfig>, kernel?: Stage11CausalBayesianKernel) {
    super(
      DEFAULT_F337_CONFIG,
      customConfig,
      kernel ?? Stage11CausalBayesianKernel.getShared(),
      ["hypothesis_ids", "prior_vector", "cpt_matrix_dim", "normalization_ok"] as const,
      F337BayesianCptPriorNetworkBuilderValidationError
    );
  }
}

export function verifyF337Module(): {
  readonly featureId: typeof F337_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F337BayesianCptPriorNetworkBuilderService();
  const sampleInput: F337BayesianCptPriorNetworkBuilderInput = {
    requestId: "req_verify_f337",
    projectId: "proj_kosmora_f337",
    workspaceId: "ws_kosmora_f337",
    tenantId: "tenant_rlm_f337",
    actorId: "actor_verifier_f337",
    autonomyLevel: "A3",
    hypothesis_ids: "seed_f337_hypothesis_ids",
    prior_vector: 42,
    cpt_matrix_dim: true,
    normalization_ok: "seed_f337_normalization_ok",
    metadata: { stage: "stage11-causal-bayesian", featureId: "F337" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F337" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_hypothesis_ids !== sampleInput.hypothesis_ids &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F337] Verification failed`);
  }

  return {
    featureId: F337_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
