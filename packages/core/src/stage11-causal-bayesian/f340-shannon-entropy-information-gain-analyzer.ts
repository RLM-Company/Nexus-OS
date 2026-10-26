/**
 * F340 (stage11-causal-bayesian): Анализатор снижения энтропии Шеннона и прироста информации (Information Gain)
 * Измерение в битах того, насколько собранные свидетельства уменьшили неопределённость системы
 * Operation Code: bayes_info_gain_analyzer
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

export const F340_FEATURE_ID = "F340" as const;
export const F340_STAGE = "stage11-causal-bayesian" as const;
export const F340_OPERATION_CODE = "bayes_info_gain_analyzer" as const;
export const F340_CONTRACT_VERSION = "2.0.0" as const;

export type F340ShannonEntropyInformationGainAnalyzerConfig = BaseFeatureConfig<
  typeof F340_FEATURE_ID,
  typeof F340_STAGE,
  typeof F340_OPERATION_CODE
>;

export interface F340ShannonEntropyInformationGainAnalyzerInput extends BaseFeatureInput {
  readonly prior_entropy_bits: string | number | boolean | readonly string[];
  readonly posterior_entropy_bits: string | number | boolean | readonly string[];
  readonly information_gain_bits: string | number | boolean | readonly string[];
  readonly uncertainty_reduced: string | number | boolean | readonly string[];
}

export interface F340ShannonEntropyInformationGainAnalyzerOutput {
  readonly featureId: typeof F340_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F340_OPERATION_CODE;
  readonly resolved_prior_entropy_bits: unknown;
  readonly resolved_posterior_entropy_bits: unknown;
  readonly resolved_information_gain_bits: unknown;
  readonly resolved_uncertainty_reduced: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F340_FEATURE_ID>;
}

export type F340ShannonEntropyInformationGainAnalyzerTelemetrySnapshot = BaseFeatureTelemetry<typeof F340_FEATURE_ID>;

export const DEFAULT_F340_CONFIG: F340ShannonEntropyInformationGainAnalyzerConfig = {
  featureId: F340_FEATURE_ID,
  stage: F340_STAGE,
  operationCode: F340_OPERATION_CODE,
  contractVersion: F340_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F340ShannonEntropyInformationGainAnalyzerValidationError extends Error {
  public readonly featureId = F340_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F340 Validation Error on '${field}']: ${message}`);
    this.name = "F340ShannonEntropyInformationGainAnalyzerValidationError";
    this.field = field;
  }
}

export function computeF340Digest(rawPayload: string): string {
  return `f340_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F340ShannonEntropyInformationGainAnalyzerService extends KosmoraFeatureAdapterBase<
  typeof F340_FEATURE_ID,
  typeof F340_STAGE,
  typeof F340_OPERATION_CODE,
  F340ShannonEntropyInformationGainAnalyzerConfig,
  F340ShannonEntropyInformationGainAnalyzerInput,
  F340ShannonEntropyInformationGainAnalyzerOutput
> {
  constructor(customConfig?: Partial<F340ShannonEntropyInformationGainAnalyzerConfig>, kernel?: Stage11CausalBayesianKernel) {
    super(
      DEFAULT_F340_CONFIG,
      customConfig,
      kernel ?? Stage11CausalBayesianKernel.getShared(),
      ["prior_entropy_bits", "posterior_entropy_bits", "information_gain_bits", "uncertainty_reduced"] as const,
      F340ShannonEntropyInformationGainAnalyzerValidationError
    );
  }
}

export function verifyF340Module(): {
  readonly featureId: typeof F340_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F340ShannonEntropyInformationGainAnalyzerService();
  const sampleInput: F340ShannonEntropyInformationGainAnalyzerInput = {
    requestId: "req_verify_f340",
    projectId: "proj_kosmora_f340",
    workspaceId: "ws_kosmora_f340",
    tenantId: "tenant_rlm_f340",
    actorId: "actor_verifier_f340",
    autonomyLevel: "A3",
    prior_entropy_bits: "seed_f340_prior_entropy_bits",
    posterior_entropy_bits: 42,
    information_gain_bits: true,
    uncertainty_reduced: "seed_f340_uncertainty_reduced",
    metadata: { stage: "stage11-causal-bayesian", featureId: "F340" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F340" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_prior_entropy_bits !== sampleInput.prior_entropy_bits &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F340] Verification failed`);
  }

  return {
    featureId: F340_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
