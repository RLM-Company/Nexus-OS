/**
 * F169 (stage6-sovereign-cluster): Оптимизатор контекстного окна по лимиту токенов
 * Умное сжатие и отбор сегментов промпта в рамках жёсткого бюджета токенов модели
 * Operation Code: prompt_token_budget_pruner
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

export const F169_FEATURE_ID = "F169" as const;
export const F169_STAGE = "stage6-sovereign-cluster" as const;
export const F169_OPERATION_CODE = "prompt_token_budget_pruner" as const;
export const F169_CONTRACT_VERSION = "2.0.0" as const;

export type F169PromptTokenBudgetPrunerExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export type F169PromptTokenBudgetPrunerConfig = BaseFeatureConfig<
  typeof F169_FEATURE_ID,
  typeof F169_STAGE,
  typeof F169_OPERATION_CODE
>;

export interface F169PromptTokenBudgetPrunerInput extends BaseFeatureInput {
  readonly max_token_budget: string;
  readonly used_tokens: string | number;
  readonly retained_count: string | number | boolean | readonly string[];
  readonly compression_ratio: string | number | boolean | Record<string, unknown>;
}

export type F169PromptTokenBudgetPrunerAuditEntry = BaseFeatureAuditEntry<typeof F169_FEATURE_ID>;

export interface F169PromptTokenBudgetPrunerOutput {
  readonly featureId: typeof F169_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F169PromptTokenBudgetPrunerExecutionStatus;
  readonly operationCode: typeof F169_OPERATION_CODE;
  readonly resolved_max_token_budget: string;
  readonly resolved_used_tokens: string | number;
  readonly resolved_retained_count: string | number | boolean | readonly string[];
  readonly resolved_compression_ratio: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F169PromptTokenBudgetPrunerAuditEntry;
}

export type F169PromptTokenBudgetPrunerTelemetrySnapshot = BaseFeatureTelemetry<typeof F169_FEATURE_ID>;

export const DEFAULT_F169_CONFIG: F169PromptTokenBudgetPrunerConfig = {
  featureId: F169_FEATURE_ID,
  stage: F169_STAGE,
  operationCode: F169_OPERATION_CODE,
  contractVersion: F169_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F169PromptTokenBudgetPrunerValidationError extends Error {
  public readonly featureId = F169_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F169 Validation Error on '${field}']: ${message}`);
    this.name = "F169PromptTokenBudgetPrunerValidationError";
    this.field = field;
  }
}

export function computeF169Digest(rawPayload: string): string {
  return `f169_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F169PromptTokenBudgetPrunerEngine extends KosmoraFeatureAdapterBase<
  typeof F169_FEATURE_ID,
  typeof F169_STAGE,
  typeof F169_OPERATION_CODE,
  F169PromptTokenBudgetPrunerConfig,
  F169PromptTokenBudgetPrunerInput,
  F169PromptTokenBudgetPrunerOutput
> {
  constructor(customConfig?: Partial<F169PromptTokenBudgetPrunerConfig>, kernel?: Stage6SovereignKernel) {
    super(
      DEFAULT_F169_CONFIG,
      customConfig,
      kernel ?? new Stage6SovereignKernel(),
      ["max_token_budget", "used_tokens", "retained_count", "compression_ratio"] as const,
      F169PromptTokenBudgetPrunerValidationError
    );
  }
}

export function verifyF169Module(): {
  featureId: typeof F169_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F169PromptTokenBudgetPrunerEngine();
  const sampleInput: F169PromptTokenBudgetPrunerInput = {
    requestId: "req_verify_f169",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    max_token_budget: "f169_max_token_budget_seed",
    used_tokens: 42,
    retained_count: true,
    compression_ratio: "verified_seed",
    metadata: { stage: "stage6-sovereign-cluster", featureNumber: 169 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F169" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_max_token_budget !== sampleInput.max_token_budget &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F169_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
