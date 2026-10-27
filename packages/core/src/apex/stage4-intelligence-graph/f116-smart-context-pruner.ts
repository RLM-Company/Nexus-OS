/**
 * F116 (stage4-intelligence-graph): Умная обрезка контекста (Smart Context Pruning)
 * Вытеснение наименее релевантных кусков истории при приближении к лимиту токенов
 * Operation Code: relevance_context_pruner
 */

import { createHash } from "node:crypto";
import {
  Stage4GraphKernel,
  KosmoraFeatureAdapterBase,
  type BaseFeatureAuditEntry,
  type BaseFeatureConfig,
  type BaseFeatureInput,
  type BaseFeatureTelemetry,
  type StageKernelExecutionResult
} from "./stage-kernel.js";

export const F116_FEATURE_ID = "F116" as const;
export const F116_STAGE = "stage4-intelligence-graph" as const;
export const F116_OPERATION_CODE = "relevance_context_pruner" as const;
export const F116_CONTRACT_VERSION = "2.0.0" as const;

export type F116SmartContextPrunerExecutionStatus =
  "idle" | "validating" | "executing" | "completed" | "degraded" | "cancelled" | "failed";

export type F116SmartContextPrunerConfig = BaseFeatureConfig<
  typeof F116_FEATURE_ID,
  typeof F116_STAGE,
  typeof F116_OPERATION_CODE
>;

export interface F116SmartContextPrunerInput extends BaseFeatureInput {
  readonly budget_limit_tokens: string;
  readonly evicted_chunks_count: string | number;
  readonly retained_high_value_ids: string | number | boolean | readonly string[];
  readonly freed_tokens: string | number | boolean | Record<string, unknown>;
}

export type F116SmartContextPrunerAuditEntry = BaseFeatureAuditEntry<typeof F116_FEATURE_ID>;

export interface F116SmartContextPrunerOutput {
  readonly featureId: typeof F116_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F116SmartContextPrunerExecutionStatus;
  readonly operationCode: typeof F116_OPERATION_CODE;
  readonly resolved_budget_limit_tokens: string;
  readonly resolved_evicted_chunks_count: string | number;
  readonly resolved_retained_high_value_ids: string | number | boolean | readonly string[];
  readonly resolved_freed_tokens: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F116SmartContextPrunerAuditEntry;
}

export type F116SmartContextPrunerTelemetrySnapshot = BaseFeatureTelemetry<typeof F116_FEATURE_ID>;

export const DEFAULT_F116_CONFIG: F116SmartContextPrunerConfig = {
  featureId: F116_FEATURE_ID,
  stage: F116_STAGE,
  operationCode: F116_OPERATION_CODE,
  contractVersion: F116_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F116SmartContextPrunerValidationError extends Error {
  public readonly featureId = F116_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F116 Validation Error on '${field}']: ${message}`);
    this.name = "F116SmartContextPrunerValidationError";
    this.field = field;
  }
}

export function computeF116Digest(rawPayload: string): string {
  return `f116_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F116SmartContextPrunerEngine extends KosmoraFeatureAdapterBase<
  typeof F116_FEATURE_ID,
  typeof F116_STAGE,
  typeof F116_OPERATION_CODE,
  F116SmartContextPrunerConfig,
  F116SmartContextPrunerInput,
  F116SmartContextPrunerOutput
> {
  constructor(customConfig?: Partial<F116SmartContextPrunerConfig>, kernel?: Stage4GraphKernel) {
    super(
      DEFAULT_F116_CONFIG,
      customConfig,
      kernel ?? new Stage4GraphKernel(),
      [
        "budget_limit_tokens",
        "evicted_chunks_count",
        "retained_high_value_ids",
        "freed_tokens"
      ] as const,
      F116SmartContextPrunerValidationError
    );
  }
}

export function verifyF116Module(): {
  featureId: typeof F116_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F116SmartContextPrunerEngine();
  const sampleInput: F116SmartContextPrunerInput = {
    requestId: "req_verify_f116",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    budget_limit_tokens: "f116_budget_limit_tokens_seed",
    evicted_chunks_count: 42,
    retained_high_value_ids: true,
    freed_tokens: "verified_seed",
    metadata: { stage: "stage4-intelligence-graph", featureNumber: 116 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F116" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_budget_limit_tokens !== sampleInput.budget_limit_tokens &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F116_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
