/**
 * F331 (stage11-causal-bayesian): Предиктор контрфактического исхода Y_{X <- x'}(u) (Step 3: Prediction)
 * Прямой прогон модифицированной структурной модели с индивидуальными шумами для ответа «что было бы, если»
 * Operation Code: cf_trajectory_predictor
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

export const F331_FEATURE_ID = "F331" as const;
export const F331_STAGE = "stage11-causal-bayesian" as const;
export const F331_OPERATION_CODE = "cf_trajectory_predictor" as const;
export const F331_CONTRACT_VERSION = "2.0.0" as const;

export type F331CounterfactualTrajectoryPredictorConfig = BaseFeatureConfig<
  typeof F331_FEATURE_ID,
  typeof F331_STAGE,
  typeof F331_OPERATION_CODE
>;

export interface F331CounterfactualTrajectoryPredictorInput extends BaseFeatureInput {
  readonly factual_outcome: string | number | boolean | readonly string[];
  readonly counterfactual_outcome: string | number | boolean | readonly string[];
  readonly individual_effect_ite: string | number | boolean | readonly string[];
  readonly prediction_digest: string | number | boolean | readonly string[];
}

export interface F331CounterfactualTrajectoryPredictorOutput {
  readonly featureId: typeof F331_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F331_OPERATION_CODE;
  readonly resolved_factual_outcome: unknown;
  readonly resolved_counterfactual_outcome: unknown;
  readonly resolved_individual_effect_ite: unknown;
  readonly resolved_prediction_digest: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F331_FEATURE_ID>;
}

export type F331CounterfactualTrajectoryPredictorTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F331_FEATURE_ID
>;

export const DEFAULT_F331_CONFIG: F331CounterfactualTrajectoryPredictorConfig = {
  featureId: F331_FEATURE_ID,
  stage: F331_STAGE,
  operationCode: F331_OPERATION_CODE,
  contractVersion: F331_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F331CounterfactualTrajectoryPredictorValidationError extends Error {
  public readonly featureId = F331_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F331 Validation Error on '${field}']: ${message}`);
    this.name = "F331CounterfactualTrajectoryPredictorValidationError";
    this.field = field;
  }
}

export function computeF331Digest(rawPayload: string): string {
  return `f331_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F331CounterfactualTrajectoryPredictorService extends KosmoraFeatureAdapterBase<
  typeof F331_FEATURE_ID,
  typeof F331_STAGE,
  typeof F331_OPERATION_CODE,
  F331CounterfactualTrajectoryPredictorConfig,
  F331CounterfactualTrajectoryPredictorInput,
  F331CounterfactualTrajectoryPredictorOutput
> {
  constructor(
    customConfig?: Partial<F331CounterfactualTrajectoryPredictorConfig>,
    kernel?: Stage11CausalBayesianKernel
  ) {
    super(
      DEFAULT_F331_CONFIG,
      customConfig,
      kernel ?? Stage11CausalBayesianKernel.getShared(),
      [
        "factual_outcome",
        "counterfactual_outcome",
        "individual_effect_ite",
        "prediction_digest"
      ] as const,
      F331CounterfactualTrajectoryPredictorValidationError
    );
  }
}

export function verifyF331Module(): {
  readonly featureId: typeof F331_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F331CounterfactualTrajectoryPredictorService();
  const sampleInput: F331CounterfactualTrajectoryPredictorInput = {
    requestId: "req_verify_f331",
    projectId: "proj_kosmora_f331",
    workspaceId: "ws_kosmora_f331",
    tenantId: "tenant_rlm_f331",
    actorId: "actor_verifier_f331",
    autonomyLevel: "A3",
    factual_outcome: "seed_f331_factual_outcome",
    counterfactual_outcome: 42,
    individual_effect_ite: true,
    prediction_digest: "seed_f331_prediction_digest",
    metadata: { stage: "stage11-causal-bayesian", featureId: "F331" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F331" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_factual_outcome !== sampleInput.factual_outcome &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F331] Verification failed`);
  }

  return {
    featureId: F331_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
