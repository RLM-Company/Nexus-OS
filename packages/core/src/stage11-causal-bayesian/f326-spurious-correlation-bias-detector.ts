/**
 * F326 (stage11-causal-bayesian): Детектор ложных корреляций и парадокса Симпсона (Spurious Correlation Guard)
 * Сравнение наблюдаемой ассоциации и интервенционного распределения для отсечения ложных выводов
 * Operation Code: spurious_bias_detector
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

export const F326_FEATURE_ID = "F326" as const;
export const F326_STAGE = "stage11-causal-bayesian" as const;
export const F326_OPERATION_CODE = "spurious_bias_detector" as const;
export const F326_CONTRACT_VERSION = "2.0.0" as const;

export type F326SpuriousCorrelationBiasDetectorConfig = BaseFeatureConfig<
  typeof F326_FEATURE_ID,
  typeof F326_STAGE,
  typeof F326_OPERATION_CODE
>;

export interface F326SpuriousCorrelationBiasDetectorInput extends BaseFeatureInput {
  readonly observational_corr: string | number | boolean | readonly string[];
  readonly interventional_effect: string | number | boolean | readonly string[];
  readonly bias_magnitude: string | number | boolean | readonly string[];
  readonly simpson_reversal: string | number | boolean | readonly string[];
}

export interface F326SpuriousCorrelationBiasDetectorOutput {
  readonly featureId: typeof F326_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F326_OPERATION_CODE;
  readonly resolved_observational_corr: unknown;
  readonly resolved_interventional_effect: unknown;
  readonly resolved_bias_magnitude: unknown;
  readonly resolved_simpson_reversal: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F326_FEATURE_ID>;
}

export type F326SpuriousCorrelationBiasDetectorTelemetrySnapshot = BaseFeatureTelemetry<typeof F326_FEATURE_ID>;

export const DEFAULT_F326_CONFIG: F326SpuriousCorrelationBiasDetectorConfig = {
  featureId: F326_FEATURE_ID,
  stage: F326_STAGE,
  operationCode: F326_OPERATION_CODE,
  contractVersion: F326_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F326SpuriousCorrelationBiasDetectorValidationError extends Error {
  public readonly featureId = F326_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F326 Validation Error on '${field}']: ${message}`);
    this.name = "F326SpuriousCorrelationBiasDetectorValidationError";
    this.field = field;
  }
}

export function computeF326Digest(rawPayload: string): string {
  return `f326_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F326SpuriousCorrelationBiasDetectorService extends KosmoraFeatureAdapterBase<
  typeof F326_FEATURE_ID,
  typeof F326_STAGE,
  typeof F326_OPERATION_CODE,
  F326SpuriousCorrelationBiasDetectorConfig,
  F326SpuriousCorrelationBiasDetectorInput,
  F326SpuriousCorrelationBiasDetectorOutput
> {
  constructor(customConfig?: Partial<F326SpuriousCorrelationBiasDetectorConfig>, kernel?: Stage11CausalBayesianKernel) {
    super(
      DEFAULT_F326_CONFIG,
      customConfig,
      kernel ?? Stage11CausalBayesianKernel.getShared(),
      ["observational_corr", "interventional_effect", "bias_magnitude", "simpson_reversal"] as const,
      F326SpuriousCorrelationBiasDetectorValidationError
    );
  }
}

export function verifyF326Module(): {
  readonly featureId: typeof F326_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F326SpuriousCorrelationBiasDetectorService();
  const sampleInput: F326SpuriousCorrelationBiasDetectorInput = {
    requestId: "req_verify_f326",
    projectId: "proj_kosmora_f326",
    workspaceId: "ws_kosmora_f326",
    tenantId: "tenant_rlm_f326",
    actorId: "actor_verifier_f326",
    autonomyLevel: "A3",
    observational_corr: "seed_f326_observational_corr",
    interventional_effect: 42,
    bias_magnitude: true,
    simpson_reversal: "seed_f326_simpson_reversal",
    metadata: { stage: "stage11-causal-bayesian", featureId: "F326" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F326" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_observational_corr !== sampleInput.observational_corr &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F326] Verification failed`);
  }

  return {
    featureId: F326_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
