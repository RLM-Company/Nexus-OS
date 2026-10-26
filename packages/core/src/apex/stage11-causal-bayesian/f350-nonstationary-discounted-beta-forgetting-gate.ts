/**
 * F350 (stage11-causal-bayesian): Механизм экспоненциального забывания для нестационарных распределенийBeta(gamma*alpha, gamma*beta)
 * Адаптация параметров распределения при дрейфе качества или скорости внешних моделей
 * Operation Code: thompson_discounted_beta
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

export const F350_FEATURE_ID = "F350" as const;
export const F350_STAGE = "stage11-causal-bayesian" as const;
export const F350_OPERATION_CODE = "thompson_discounted_beta" as const;
export const F350_CONTRACT_VERSION = "2.0.0" as const;

export type F350NonstationaryDiscountedBetaForgettingGateConfig = BaseFeatureConfig<
  typeof F350_FEATURE_ID,
  typeof F350_STAGE,
  typeof F350_OPERATION_CODE
>;

export interface F350NonstationaryDiscountedBetaForgettingGateInput extends BaseFeatureInput {
  readonly discount_gamma: string | number | boolean | readonly string[];
  readonly decayed_alpha: string | number | boolean | readonly string[];
  readonly decayed_beta: string | number | boolean | readonly string[];
  readonly drift_adapted: string | number | boolean | readonly string[];
}

export interface F350NonstationaryDiscountedBetaForgettingGateOutput {
  readonly featureId: typeof F350_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F350_OPERATION_CODE;
  readonly resolved_discount_gamma: unknown;
  readonly resolved_decayed_alpha: unknown;
  readonly resolved_decayed_beta: unknown;
  readonly resolved_drift_adapted: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F350_FEATURE_ID>;
}

export type F350NonstationaryDiscountedBetaForgettingGateTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F350_FEATURE_ID
>;

export const DEFAULT_F350_CONFIG: F350NonstationaryDiscountedBetaForgettingGateConfig = {
  featureId: F350_FEATURE_ID,
  stage: F350_STAGE,
  operationCode: F350_OPERATION_CODE,
  contractVersion: F350_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F350NonstationaryDiscountedBetaForgettingGateValidationError extends Error {
  public readonly featureId = F350_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F350 Validation Error on '${field}']: ${message}`);
    this.name = "F350NonstationaryDiscountedBetaForgettingGateValidationError";
    this.field = field;
  }
}

export function computeF350Digest(rawPayload: string): string {
  return `f350_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F350NonstationaryDiscountedBetaForgettingGateService extends KosmoraFeatureAdapterBase<
  typeof F350_FEATURE_ID,
  typeof F350_STAGE,
  typeof F350_OPERATION_CODE,
  F350NonstationaryDiscountedBetaForgettingGateConfig,
  F350NonstationaryDiscountedBetaForgettingGateInput,
  F350NonstationaryDiscountedBetaForgettingGateOutput
> {
  constructor(
    customConfig?: Partial<F350NonstationaryDiscountedBetaForgettingGateConfig>,
    kernel?: Stage11CausalBayesianKernel
  ) {
    super(
      DEFAULT_F350_CONFIG,
      customConfig,
      kernel ?? Stage11CausalBayesianKernel.getShared(),
      ["discount_gamma", "decayed_alpha", "decayed_beta", "drift_adapted"] as const,
      F350NonstationaryDiscountedBetaForgettingGateValidationError
    );
  }
}

export function verifyF350Module(): {
  readonly featureId: typeof F350_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F350NonstationaryDiscountedBetaForgettingGateService();
  const sampleInput: F350NonstationaryDiscountedBetaForgettingGateInput = {
    requestId: "req_verify_f350",
    projectId: "proj_kosmora_f350",
    workspaceId: "ws_kosmora_f350",
    tenantId: "tenant_rlm_f350",
    actorId: "actor_verifier_f350",
    autonomyLevel: "A3",
    discount_gamma: "seed_f350_discount_gamma",
    decayed_alpha: 42,
    decayed_beta: true,
    drift_adapted: "seed_f350_drift_adapted",
    metadata: { stage: "stage11-causal-bayesian", featureId: "F350" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F350" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_discount_gamma !== sampleInput.discount_gamma &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F350] Verification failed`);
  }

  return {
    featureId: F350_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
