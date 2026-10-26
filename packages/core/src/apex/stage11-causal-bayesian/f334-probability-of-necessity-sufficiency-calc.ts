/**
 * F334 (stage11-causal-bayesian): Калькулятор вероятности необходимости и достаточности (PN / PS / PNS)
 * Математическая оценка того, насколько действие агента было необходимым и достаточным для успеха
 * Operation Code: cf_pns_calculator
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

export const F334_FEATURE_ID = "F334" as const;
export const F334_STAGE = "stage11-causal-bayesian" as const;
export const F334_OPERATION_CODE = "cf_pns_calculator" as const;
export const F334_CONTRACT_VERSION = "2.0.0" as const;

export type F334ProbabilityOfNecessitySufficiencyCalcConfig = BaseFeatureConfig<
  typeof F334_FEATURE_ID,
  typeof F334_STAGE,
  typeof F334_OPERATION_CODE
>;

export interface F334ProbabilityOfNecessitySufficiencyCalcInput extends BaseFeatureInput {
  readonly event_x: string | number | boolean | readonly string[];
  readonly outcome_y: string | number | boolean | readonly string[];
  readonly pns_score: string | number | boolean | readonly string[];
  readonly sufficiency_verified: string | number | boolean | readonly string[];
}

export interface F334ProbabilityOfNecessitySufficiencyCalcOutput {
  readonly featureId: typeof F334_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F334_OPERATION_CODE;
  readonly resolved_event_x: unknown;
  readonly resolved_outcome_y: unknown;
  readonly resolved_pns_score: unknown;
  readonly resolved_sufficiency_verified: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F334_FEATURE_ID>;
}

export type F334ProbabilityOfNecessitySufficiencyCalcTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F334_FEATURE_ID
>;

export const DEFAULT_F334_CONFIG: F334ProbabilityOfNecessitySufficiencyCalcConfig = {
  featureId: F334_FEATURE_ID,
  stage: F334_STAGE,
  operationCode: F334_OPERATION_CODE,
  contractVersion: F334_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F334ProbabilityOfNecessitySufficiencyCalcValidationError extends Error {
  public readonly featureId = F334_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F334 Validation Error on '${field}']: ${message}`);
    this.name = "F334ProbabilityOfNecessitySufficiencyCalcValidationError";
    this.field = field;
  }
}

export function computeF334Digest(rawPayload: string): string {
  return `f334_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F334ProbabilityOfNecessitySufficiencyCalcService extends KosmoraFeatureAdapterBase<
  typeof F334_FEATURE_ID,
  typeof F334_STAGE,
  typeof F334_OPERATION_CODE,
  F334ProbabilityOfNecessitySufficiencyCalcConfig,
  F334ProbabilityOfNecessitySufficiencyCalcInput,
  F334ProbabilityOfNecessitySufficiencyCalcOutput
> {
  constructor(
    customConfig?: Partial<F334ProbabilityOfNecessitySufficiencyCalcConfig>,
    kernel?: Stage11CausalBayesianKernel
  ) {
    super(
      DEFAULT_F334_CONFIG,
      customConfig,
      kernel ?? Stage11CausalBayesianKernel.getShared(),
      ["event_x", "outcome_y", "pns_score", "sufficiency_verified"] as const,
      F334ProbabilityOfNecessitySufficiencyCalcValidationError
    );
  }
}

export function verifyF334Module(): {
  readonly featureId: typeof F334_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F334ProbabilityOfNecessitySufficiencyCalcService();
  const sampleInput: F334ProbabilityOfNecessitySufficiencyCalcInput = {
    requestId: "req_verify_f334",
    projectId: "proj_kosmora_f334",
    workspaceId: "ws_kosmora_f334",
    tenantId: "tenant_rlm_f334",
    actorId: "actor_verifier_f334",
    autonomyLevel: "A3",
    event_x: "seed_f334_event_x",
    outcome_y: 42,
    pns_score: true,
    sufficiency_verified: "seed_f334_sufficiency_verified",
    metadata: { stage: "stage11-causal-bayesian", featureId: "F334" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F334" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_event_x !== sampleInput.event_x &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F334] Verification failed`);
  }

  return {
    featureId: F334_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
