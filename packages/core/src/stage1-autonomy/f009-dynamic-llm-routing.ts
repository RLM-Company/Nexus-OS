/**
 * F009 (stage1-autonomy): Роутер моделей (Dynamic LLM Routing)
 * Распределение простых задач на быстрые модели и сложных архитектурных узлов на флагманские модели
 * Operation Code: llm_router
 */

import { createHash } from "node:crypto";
import {
  Stage1AutonomyKernel,
  KosmoraFeatureAdapterBase,
  type BaseFeatureAuditEntry,
  type BaseFeatureConfig,
  type BaseFeatureInput,
  type BaseFeatureTelemetry,
  type StageKernelExecutionResult
} from "./stage-kernel.js";

export const F009_FEATURE_ID = "F009" as const;
export const F009_STAGE = "stage1-autonomy" as const;
export const F009_OPERATION_CODE = "llm_router" as const;
export const F009_CONTRACT_VERSION = "2.0.0" as const;

export type F009DynamicLlmRoutingExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export type F009DynamicLlmRoutingConfig = BaseFeatureConfig<
  typeof F009_FEATURE_ID,
  typeof F009_STAGE,
  typeof F009_OPERATION_CODE
>;

export interface F009DynamicLlmRoutingInput extends BaseFeatureInput {
  readonly route_id: string;
  readonly selected_model: string | number;
  readonly complexity_tier: string | number | boolean | readonly string[];
  readonly estimated_cost_usd: string | number | boolean | Record<string, unknown>;
}

export type F009DynamicLlmRoutingAuditEntry = BaseFeatureAuditEntry<typeof F009_FEATURE_ID>;

export interface F009DynamicLlmRoutingOutput {
  readonly featureId: typeof F009_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F009DynamicLlmRoutingExecutionStatus;
  readonly operationCode: typeof F009_OPERATION_CODE;
  readonly resolved_route_id: string;
  readonly resolved_selected_model: string | number;
  readonly resolved_complexity_tier: string | number | boolean | readonly string[];
  readonly resolved_estimated_cost_usd: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F009DynamicLlmRoutingAuditEntry;
}

export type F009DynamicLlmRoutingTelemetrySnapshot = BaseFeatureTelemetry<typeof F009_FEATURE_ID>;

export const DEFAULT_F009_CONFIG: F009DynamicLlmRoutingConfig = {
  featureId: F009_FEATURE_ID,
  stage: F009_STAGE,
  operationCode: F009_OPERATION_CODE,
  contractVersion: F009_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F009DynamicLlmRoutingValidationError extends Error {
  public readonly featureId = F009_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F009 Validation Error on '${field}']: ${message}`);
    this.name = "F009DynamicLlmRoutingValidationError";
    this.field = field;
  }
}

export function computeF009Digest(rawPayload: string): string {
  return `f009_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F009DynamicLlmRoutingEngine extends KosmoraFeatureAdapterBase<
  typeof F009_FEATURE_ID,
  typeof F009_STAGE,
  typeof F009_OPERATION_CODE,
  F009DynamicLlmRoutingConfig,
  F009DynamicLlmRoutingInput,
  F009DynamicLlmRoutingOutput
> {
  constructor(customConfig?: Partial<F009DynamicLlmRoutingConfig>, kernel?: Stage1AutonomyKernel) {
    super(
      DEFAULT_F009_CONFIG,
      customConfig,
      kernel ?? new Stage1AutonomyKernel(),
      ["route_id", "selected_model", "complexity_tier", "estimated_cost_usd"] as const,
      F009DynamicLlmRoutingValidationError
    );
  }
}

export function verifyF009Module(): {
  featureId: typeof F009_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F009DynamicLlmRoutingEngine();
  const sampleInput: F009DynamicLlmRoutingInput = {
    requestId: "req_verify_f009",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    route_id: "f009_route_id_seed",
    selected_model: 42,
    complexity_tier: true,
    estimated_cost_usd: "verified_seed",
    metadata: { stage: "stage1-autonomy", featureNumber: 9 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F009" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_route_id !== sampleInput.route_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F009_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
