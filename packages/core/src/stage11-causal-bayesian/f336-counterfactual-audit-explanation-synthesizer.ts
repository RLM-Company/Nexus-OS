/**
 * F336 (stage11-causal-bayesian): Синтезатор верифицируемых контрфактических объяснений для аудитора
 * Формирование отчёта о минимальном изменении входа, которое перевело бы вердикт Критика в Approved
 * Operation Code: cf_explanation_synth
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

export const F336_FEATURE_ID = "F336" as const;
export const F336_STAGE = "stage11-causal-bayesian" as const;
export const F336_OPERATION_CODE = "cf_explanation_synth" as const;
export const F336_CONTRACT_VERSION = "2.0.0" as const;

export type F336CounterfactualAuditExplanationSynthesizerConfig = BaseFeatureConfig<
  typeof F336_FEATURE_ID,
  typeof F336_STAGE,
  typeof F336_OPERATION_CODE
>;

export interface F336CounterfactualAuditExplanationSynthesizerInput extends BaseFeatureInput {
  readonly current_verdict: string | number | boolean | readonly string[];
  readonly minimal_delta_input: string | number | boolean | readonly string[];
  readonly flipped_verdict: string | number | boolean | readonly string[];
  readonly explanation_sha256: string | number | boolean | readonly string[];
}

export interface F336CounterfactualAuditExplanationSynthesizerOutput {
  readonly featureId: typeof F336_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F336_OPERATION_CODE;
  readonly resolved_current_verdict: unknown;
  readonly resolved_minimal_delta_input: unknown;
  readonly resolved_flipped_verdict: unknown;
  readonly resolved_explanation_sha256: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F336_FEATURE_ID>;
}

export type F336CounterfactualAuditExplanationSynthesizerTelemetrySnapshot = BaseFeatureTelemetry<typeof F336_FEATURE_ID>;

export const DEFAULT_F336_CONFIG: F336CounterfactualAuditExplanationSynthesizerConfig = {
  featureId: F336_FEATURE_ID,
  stage: F336_STAGE,
  operationCode: F336_OPERATION_CODE,
  contractVersion: F336_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F336CounterfactualAuditExplanationSynthesizerValidationError extends Error {
  public readonly featureId = F336_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F336 Validation Error on '${field}']: ${message}`);
    this.name = "F336CounterfactualAuditExplanationSynthesizerValidationError";
    this.field = field;
  }
}

export function computeF336Digest(rawPayload: string): string {
  return `f336_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F336CounterfactualAuditExplanationSynthesizerService extends KosmoraFeatureAdapterBase<
  typeof F336_FEATURE_ID,
  typeof F336_STAGE,
  typeof F336_OPERATION_CODE,
  F336CounterfactualAuditExplanationSynthesizerConfig,
  F336CounterfactualAuditExplanationSynthesizerInput,
  F336CounterfactualAuditExplanationSynthesizerOutput
> {
  constructor(customConfig?: Partial<F336CounterfactualAuditExplanationSynthesizerConfig>, kernel?: Stage11CausalBayesianKernel) {
    super(
      DEFAULT_F336_CONFIG,
      customConfig,
      kernel ?? Stage11CausalBayesianKernel.getShared(),
      ["current_verdict", "minimal_delta_input", "flipped_verdict", "explanation_sha256"] as const,
      F336CounterfactualAuditExplanationSynthesizerValidationError
    );
  }
}

export function verifyF336Module(): {
  readonly featureId: typeof F336_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F336CounterfactualAuditExplanationSynthesizerService();
  const sampleInput: F336CounterfactualAuditExplanationSynthesizerInput = {
    requestId: "req_verify_f336",
    projectId: "proj_kosmora_f336",
    workspaceId: "ws_kosmora_f336",
    tenantId: "tenant_rlm_f336",
    actorId: "actor_verifier_f336",
    autonomyLevel: "A3",
    current_verdict: "seed_f336_current_verdict",
    minimal_delta_input: 42,
    flipped_verdict: true,
    explanation_sha256: "seed_f336_explanation_sha256",
    metadata: { stage: "stage11-causal-bayesian", featureId: "F336" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F336" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_current_verdict !== sampleInput.current_verdict &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F336] Verification failed`);
  }

  return {
    featureId: F336_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
