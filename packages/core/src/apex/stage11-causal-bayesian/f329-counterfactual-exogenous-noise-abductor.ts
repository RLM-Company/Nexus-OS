/**
 * F329 (stage11-causal-bayesian): Модуль абдукции экзогенного шума по наблюдаемым фактам (Step 1: Abduction)
 * Восстановление скрытых индивидуальных факторов U = u из фактической траектории выполнения задачи
 * Operation Code: cf_noise_abductor
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

export const F329_FEATURE_ID = "F329" as const;
export const F329_STAGE = "stage11-causal-bayesian" as const;
export const F329_OPERATION_CODE = "cf_noise_abductor" as const;
export const F329_CONTRACT_VERSION = "2.0.0" as const;

export type F329CounterfactualExogenousNoiseAbductorConfig = BaseFeatureConfig<
  typeof F329_FEATURE_ID,
  typeof F329_STAGE,
  typeof F329_OPERATION_CODE
>;

export interface F329CounterfactualExogenousNoiseAbductorInput extends BaseFeatureInput {
  readonly observed_evidence: string | number | boolean | readonly string[];
  readonly inferred_exogenous_u: string | number | boolean | readonly string[];
  readonly residual_norm: string | number | boolean | readonly string[];
  readonly abduction_exact: string | number | boolean | readonly string[];
}

export interface F329CounterfactualExogenousNoiseAbductorOutput {
  readonly featureId: typeof F329_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F329_OPERATION_CODE;
  readonly resolved_observed_evidence: unknown;
  readonly resolved_inferred_exogenous_u: unknown;
  readonly resolved_residual_norm: unknown;
  readonly resolved_abduction_exact: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F329_FEATURE_ID>;
}

export type F329CounterfactualExogenousNoiseAbductorTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F329_FEATURE_ID
>;

export const DEFAULT_F329_CONFIG: F329CounterfactualExogenousNoiseAbductorConfig = {
  featureId: F329_FEATURE_ID,
  stage: F329_STAGE,
  operationCode: F329_OPERATION_CODE,
  contractVersion: F329_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F329CounterfactualExogenousNoiseAbductorValidationError extends Error {
  public readonly featureId = F329_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F329 Validation Error on '${field}']: ${message}`);
    this.name = "F329CounterfactualExogenousNoiseAbductorValidationError";
    this.field = field;
  }
}

export function computeF329Digest(rawPayload: string): string {
  return `f329_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F329CounterfactualExogenousNoiseAbductorService extends KosmoraFeatureAdapterBase<
  typeof F329_FEATURE_ID,
  typeof F329_STAGE,
  typeof F329_OPERATION_CODE,
  F329CounterfactualExogenousNoiseAbductorConfig,
  F329CounterfactualExogenousNoiseAbductorInput,
  F329CounterfactualExogenousNoiseAbductorOutput
> {
  constructor(
    customConfig?: Partial<F329CounterfactualExogenousNoiseAbductorConfig>,
    kernel?: Stage11CausalBayesianKernel
  ) {
    super(
      DEFAULT_F329_CONFIG,
      customConfig,
      kernel ?? Stage11CausalBayesianKernel.getShared(),
      ["observed_evidence", "inferred_exogenous_u", "residual_norm", "abduction_exact"] as const,
      F329CounterfactualExogenousNoiseAbductorValidationError
    );
  }
}

export function verifyF329Module(): {
  readonly featureId: typeof F329_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F329CounterfactualExogenousNoiseAbductorService();
  const sampleInput: F329CounterfactualExogenousNoiseAbductorInput = {
    requestId: "req_verify_f329",
    projectId: "proj_kosmora_f329",
    workspaceId: "ws_kosmora_f329",
    tenantId: "tenant_rlm_f329",
    actorId: "actor_verifier_f329",
    autonomyLevel: "A3",
    observed_evidence: "seed_f329_observed_evidence",
    inferred_exogenous_u: 42,
    residual_norm: true,
    abduction_exact: "seed_f329_abduction_exact",
    metadata: { stage: "stage11-causal-bayesian", featureId: "F329" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F329" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_observed_evidence !== sampleInput.observed_evidence &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F329] Verification failed`);
  }

  return {
    featureId: F329_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
