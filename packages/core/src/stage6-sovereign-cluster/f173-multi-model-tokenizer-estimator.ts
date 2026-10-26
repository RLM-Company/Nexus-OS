/**
 * F173 (stage6-sovereign-cluster): Калибровщик расхода токенов для кириллицы и кода
 * Точная оценка стоимости промпта с учётом плотности токенизации UTF-8, кода и пунктуации
 * Operation Code: multi_model_tokenizer_estimator
 */

import { createHash } from "node:crypto";
import {
  Stage6SovereignKernel,
  KosmoraFeatureAdapterBase,
  type BaseFeatureAuditEntry,
  type BaseFeatureConfig,
  type BaseFeatureInput,
  type BaseFeatureTelemetry,
  type StageKernelExecutionResult
} from "./stage-kernel.js";

export const F173_FEATURE_ID = "F173" as const;
export const F173_STAGE = "stage6-sovereign-cluster" as const;
export const F173_OPERATION_CODE = "multi_model_tokenizer_estimator" as const;
export const F173_CONTRACT_VERSION = "2.0.0" as const;

export type F173MultiModelTokenizerEstimatorExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export type F173MultiModelTokenizerEstimatorConfig = BaseFeatureConfig<
  typeof F173_FEATURE_ID,
  typeof F173_STAGE,
  typeof F173_OPERATION_CODE
>;

export interface F173MultiModelTokenizerEstimatorInput extends BaseFeatureInput {
  readonly estimated_tokens: string;
  readonly character_count: string | number;
  readonly budget_utilization_pct: string | number | boolean | readonly string[];
  readonly within_limit: string | number | boolean | Record<string, unknown>;
}

export type F173MultiModelTokenizerEstimatorAuditEntry = BaseFeatureAuditEntry<typeof F173_FEATURE_ID>;

export interface F173MultiModelTokenizerEstimatorOutput {
  readonly featureId: typeof F173_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F173MultiModelTokenizerEstimatorExecutionStatus;
  readonly operationCode: typeof F173_OPERATION_CODE;
  readonly resolved_estimated_tokens: string;
  readonly resolved_character_count: string | number;
  readonly resolved_budget_utilization_pct: string | number | boolean | readonly string[];
  readonly resolved_within_limit: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F173MultiModelTokenizerEstimatorAuditEntry;
}

export type F173MultiModelTokenizerEstimatorTelemetrySnapshot = BaseFeatureTelemetry<typeof F173_FEATURE_ID>;

export const DEFAULT_F173_CONFIG: F173MultiModelTokenizerEstimatorConfig = {
  featureId: F173_FEATURE_ID,
  stage: F173_STAGE,
  operationCode: F173_OPERATION_CODE,
  contractVersion: F173_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F173MultiModelTokenizerEstimatorValidationError extends Error {
  public readonly featureId = F173_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F173 Validation Error on '${field}']: ${message}`);
    this.name = "F173MultiModelTokenizerEstimatorValidationError";
    this.field = field;
  }
}

export function computeF173Digest(rawPayload: string): string {
  return `f173_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F173MultiModelTokenizerEstimatorEngine extends KosmoraFeatureAdapterBase<
  typeof F173_FEATURE_ID,
  typeof F173_STAGE,
  typeof F173_OPERATION_CODE,
  F173MultiModelTokenizerEstimatorConfig,
  F173MultiModelTokenizerEstimatorInput,
  F173MultiModelTokenizerEstimatorOutput
> {
  constructor(customConfig?: Partial<F173MultiModelTokenizerEstimatorConfig>, kernel?: Stage6SovereignKernel) {
    super(
      DEFAULT_F173_CONFIG,
      customConfig,
      kernel ?? new Stage6SovereignKernel(),
      ["estimated_tokens", "character_count", "budget_utilization_pct", "within_limit"] as const,
      F173MultiModelTokenizerEstimatorValidationError
    );
  }
}

export function verifyF173Module(): {
  featureId: typeof F173_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F173MultiModelTokenizerEstimatorEngine();
  const sampleInput: F173MultiModelTokenizerEstimatorInput = {
    requestId: "req_verify_f173",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    estimated_tokens: "f173_estimated_tokens_seed",
    character_count: 42,
    budget_utilization_pct: true,
    within_limit: "verified_seed",
    metadata: { stage: "stage6-sovereign-cluster", featureNumber: 173 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F173" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_estimated_tokens !== sampleInput.estimated_tokens &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F173_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
