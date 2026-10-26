/**
 * F348 (stage11-causal-bayesian): Оптимизатор вариантов системных промптов методом сэмплирования Томпсона
 * Автоматическое перераспределение трафика в пользу промптов с наивысшим апостериорным качеством
 * Operation Code: thompson_prompt_optimizer
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

export const F348_FEATURE_ID = "F348" as const;
export const F348_STAGE = "stage11-causal-bayesian" as const;
export const F348_OPERATION_CODE = "thompson_prompt_optimizer" as const;
export const F348_CONTRACT_VERSION = "2.0.0" as const;

export type F348ContextualThompsonPromptVariantOptimizerConfig = BaseFeatureConfig<
  typeof F348_FEATURE_ID,
  typeof F348_STAGE,
  typeof F348_OPERATION_CODE
>;

export interface F348ContextualThompsonPromptVariantOptimizerInput extends BaseFeatureInput {
  readonly prompt_variants: string | number | boolean | readonly string[];
  readonly winning_variant_id: string | number | boolean | readonly string[];
  readonly conversion_lift_pct: string | number | boolean | readonly string[];
  readonly posterior_confidence: string | number | boolean | readonly string[];
}

export interface F348ContextualThompsonPromptVariantOptimizerOutput {
  readonly featureId: typeof F348_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F348_OPERATION_CODE;
  readonly resolved_prompt_variants: unknown;
  readonly resolved_winning_variant_id: unknown;
  readonly resolved_conversion_lift_pct: unknown;
  readonly resolved_posterior_confidence: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F348_FEATURE_ID>;
}

export type F348ContextualThompsonPromptVariantOptimizerTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F348_FEATURE_ID
>;

export const DEFAULT_F348_CONFIG: F348ContextualThompsonPromptVariantOptimizerConfig = {
  featureId: F348_FEATURE_ID,
  stage: F348_STAGE,
  operationCode: F348_OPERATION_CODE,
  contractVersion: F348_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F348ContextualThompsonPromptVariantOptimizerValidationError extends Error {
  public readonly featureId = F348_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F348 Validation Error on '${field}']: ${message}`);
    this.name = "F348ContextualThompsonPromptVariantOptimizerValidationError";
    this.field = field;
  }
}

export function computeF348Digest(rawPayload: string): string {
  return `f348_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F348ContextualThompsonPromptVariantOptimizerService extends KosmoraFeatureAdapterBase<
  typeof F348_FEATURE_ID,
  typeof F348_STAGE,
  typeof F348_OPERATION_CODE,
  F348ContextualThompsonPromptVariantOptimizerConfig,
  F348ContextualThompsonPromptVariantOptimizerInput,
  F348ContextualThompsonPromptVariantOptimizerOutput
> {
  constructor(
    customConfig?: Partial<F348ContextualThompsonPromptVariantOptimizerConfig>,
    kernel?: Stage11CausalBayesianKernel
  ) {
    super(
      DEFAULT_F348_CONFIG,
      customConfig,
      kernel ?? Stage11CausalBayesianKernel.getShared(),
      [
        "prompt_variants",
        "winning_variant_id",
        "conversion_lift_pct",
        "posterior_confidence"
      ] as const,
      F348ContextualThompsonPromptVariantOptimizerValidationError
    );
  }
}

export function verifyF348Module(): {
  readonly featureId: typeof F348_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F348ContextualThompsonPromptVariantOptimizerService();
  const sampleInput: F348ContextualThompsonPromptVariantOptimizerInput = {
    requestId: "req_verify_f348",
    projectId: "proj_kosmora_f348",
    workspaceId: "ws_kosmora_f348",
    tenantId: "tenant_rlm_f348",
    actorId: "actor_verifier_f348",
    autonomyLevel: "A3",
    prompt_variants: "seed_f348_prompt_variants",
    winning_variant_id: 42,
    conversion_lift_pct: true,
    posterior_confidence: "seed_f348_posterior_confidence",
    metadata: { stage: "stage11-causal-bayesian", featureId: "F348" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F348" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_prompt_variants !== sampleInput.prompt_variants &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F348] Verification failed`);
  }

  return {
    featureId: F348_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
