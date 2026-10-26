/**
 * F343 (stage11-causal-bayesian): Аудитор коэффициентов Байеса (Bayes Factor K) для проверки конкурирующих гипотез
 * Количественная оценка силы доказательств в пользу основной гипотезы против альтернативной
 * Operation Code: bayes_factor_auditor
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

export const F343_FEATURE_ID = "F343" as const;
export const F343_STAGE = "stage11-causal-bayesian" as const;
export const F343_OPERATION_CODE = "bayes_factor_auditor" as const;
export const F343_CONTRACT_VERSION = "2.0.0" as const;

export type F343LikelihoodRatioBayesFactorAuditorConfig = BaseFeatureConfig<
  typeof F343_FEATURE_ID,
  typeof F343_STAGE,
  typeof F343_OPERATION_CODE
>;

export interface F343LikelihoodRatioBayesFactorAuditorInput extends BaseFeatureInput {
  readonly hypothesis_a: string | number | boolean | readonly string[];
  readonly hypothesis_b: string | number | boolean | readonly string[];
  readonly bayes_factor_k: string | number | boolean | readonly string[];
  readonly evidence_strength: string | number | boolean | readonly string[];
}

export interface F343LikelihoodRatioBayesFactorAuditorOutput {
  readonly featureId: typeof F343_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F343_OPERATION_CODE;
  readonly resolved_hypothesis_a: unknown;
  readonly resolved_hypothesis_b: unknown;
  readonly resolved_bayes_factor_k: unknown;
  readonly resolved_evidence_strength: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F343_FEATURE_ID>;
}

export type F343LikelihoodRatioBayesFactorAuditorTelemetrySnapshot = BaseFeatureTelemetry<typeof F343_FEATURE_ID>;

export const DEFAULT_F343_CONFIG: F343LikelihoodRatioBayesFactorAuditorConfig = {
  featureId: F343_FEATURE_ID,
  stage: F343_STAGE,
  operationCode: F343_OPERATION_CODE,
  contractVersion: F343_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F343LikelihoodRatioBayesFactorAuditorValidationError extends Error {
  public readonly featureId = F343_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F343 Validation Error on '${field}']: ${message}`);
    this.name = "F343LikelihoodRatioBayesFactorAuditorValidationError";
    this.field = field;
  }
}

export function computeF343Digest(rawPayload: string): string {
  return `f343_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F343LikelihoodRatioBayesFactorAuditorService extends KosmoraFeatureAdapterBase<
  typeof F343_FEATURE_ID,
  typeof F343_STAGE,
  typeof F343_OPERATION_CODE,
  F343LikelihoodRatioBayesFactorAuditorConfig,
  F343LikelihoodRatioBayesFactorAuditorInput,
  F343LikelihoodRatioBayesFactorAuditorOutput
> {
  constructor(customConfig?: Partial<F343LikelihoodRatioBayesFactorAuditorConfig>, kernel?: Stage11CausalBayesianKernel) {
    super(
      DEFAULT_F343_CONFIG,
      customConfig,
      kernel ?? Stage11CausalBayesianKernel.getShared(),
      ["hypothesis_a", "hypothesis_b", "bayes_factor_k", "evidence_strength"] as const,
      F343LikelihoodRatioBayesFactorAuditorValidationError
    );
  }
}

export function verifyF343Module(): {
  readonly featureId: typeof F343_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F343LikelihoodRatioBayesFactorAuditorService();
  const sampleInput: F343LikelihoodRatioBayesFactorAuditorInput = {
    requestId: "req_verify_f343",
    projectId: "proj_kosmora_f343",
    workspaceId: "ws_kosmora_f343",
    tenantId: "tenant_rlm_f343",
    actorId: "actor_verifier_f343",
    autonomyLevel: "A3",
    hypothesis_a: "seed_f343_hypothesis_a",
    hypothesis_b: 42,
    bayes_factor_k: true,
    evidence_strength: "seed_f343_evidence_strength",
    metadata: { stage: "stage11-causal-bayesian", featureId: "F343" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F343" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_hypothesis_a !== sampleInput.hypothesis_a &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F343] Verification failed`);
  }

  return {
    featureId: F343_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
