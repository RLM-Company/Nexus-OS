/**
 * F023 (stage1-autonomy): Бюджетирование токенов на задачу
 * Жёсткий лимит стоимости одного запуска графа с защитой от перерасхода
 * Operation Code: token_budget_guard
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

export const F023_FEATURE_ID = "F023" as const;
export const F023_STAGE = "stage1-autonomy" as const;
export const F023_OPERATION_CODE = "token_budget_guard" as const;
export const F023_CONTRACT_VERSION = "2.0.0" as const;

export type F023TaskTokenBudgetingExecutionStatus =
  "idle" | "validating" | "executing" | "completed" | "degraded" | "cancelled" | "failed";

export type F023TaskTokenBudgetingConfig = BaseFeatureConfig<
  typeof F023_FEATURE_ID,
  typeof F023_STAGE,
  typeof F023_OPERATION_CODE
>;

export interface F023TaskTokenBudgetingInput extends BaseFeatureInput {
  readonly graph_id: string;
  readonly allocated_tokens: string | number;
  readonly consumed_tokens: string | number | boolean | readonly string[];
  readonly budget_remaining: string | number | boolean | Record<string, unknown>;
}

export type F023TaskTokenBudgetingAuditEntry = BaseFeatureAuditEntry<typeof F023_FEATURE_ID>;

export interface F023TaskTokenBudgetingOutput {
  readonly featureId: typeof F023_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F023TaskTokenBudgetingExecutionStatus;
  readonly operationCode: typeof F023_OPERATION_CODE;
  readonly resolved_graph_id: string;
  readonly resolved_allocated_tokens: string | number;
  readonly resolved_consumed_tokens: string | number | boolean | readonly string[];
  readonly resolved_budget_remaining: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F023TaskTokenBudgetingAuditEntry;
}

export type F023TaskTokenBudgetingTelemetrySnapshot = BaseFeatureTelemetry<typeof F023_FEATURE_ID>;

export const DEFAULT_F023_CONFIG: F023TaskTokenBudgetingConfig = {
  featureId: F023_FEATURE_ID,
  stage: F023_STAGE,
  operationCode: F023_OPERATION_CODE,
  contractVersion: F023_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F023TaskTokenBudgetingValidationError extends Error {
  public readonly featureId = F023_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F023 Validation Error on '${field}']: ${message}`);
    this.name = "F023TaskTokenBudgetingValidationError";
    this.field = field;
  }
}

export function computeF023Digest(rawPayload: string): string {
  return `f023_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F023TaskTokenBudgetingEngine extends KosmoraFeatureAdapterBase<
  typeof F023_FEATURE_ID,
  typeof F023_STAGE,
  typeof F023_OPERATION_CODE,
  F023TaskTokenBudgetingConfig,
  F023TaskTokenBudgetingInput,
  F023TaskTokenBudgetingOutput
> {
  constructor(customConfig?: Partial<F023TaskTokenBudgetingConfig>, kernel?: Stage1AutonomyKernel) {
    super(
      DEFAULT_F023_CONFIG,
      customConfig,
      kernel ?? new Stage1AutonomyKernel(),
      ["graph_id", "allocated_tokens", "consumed_tokens", "budget_remaining"] as const,
      F023TaskTokenBudgetingValidationError
    );
  }
}

export function verifyF023Module(): {
  featureId: typeof F023_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F023TaskTokenBudgetingEngine();
  const sampleInput: F023TaskTokenBudgetingInput = {
    requestId: "req_verify_f023",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    graph_id: "f023_graph_id_seed",
    allocated_tokens: 42,
    consumed_tokens: true,
    budget_remaining: "verified_seed",
    metadata: { stage: "stage1-autonomy", featureNumber: 23 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F023" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_graph_id !== sampleInput.graph_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F023_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
