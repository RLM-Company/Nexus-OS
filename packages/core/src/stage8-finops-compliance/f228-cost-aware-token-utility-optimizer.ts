/**
 * F228 (stage8-finops-compliance): Оптимизатор полезности токенов с учётом стоимости за 1K токенов
 * Выбор оптимального соотношения вероятности успеха (Empirical Win Rate) и стоимости вызова модели
 * Operation Code: cost_aware_token_utility_optimizer
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
import { Stage8FinOpsKernel } from "./stage-kernel.js";

export const F228_FEATURE_ID = "F228" as const;
export const F228_STAGE = "stage8-finops-compliance" as const;
export const F228_OPERATION_CODE = "cost_aware_token_utility_optimizer" as const;
export const F228_CONTRACT_VERSION = "2.0.0" as const;

export type F228CostAwareTokenUtilityOptimizerConfig = BaseFeatureConfig<
  typeof F228_FEATURE_ID,
  typeof F228_STAGE,
  typeof F228_OPERATION_CODE
>;

export interface F228CostAwareTokenUtilityOptimizerInput extends BaseFeatureInput {
  readonly selected_provider_id: string | number | boolean | readonly string[];
  readonly empirical_win_rate: string | number | boolean | readonly string[];
  readonly estimated_cost_usd: string | number | boolean | readonly string[];
  readonly ucb_score: string | number | boolean | readonly string[];
}

export interface F228CostAwareTokenUtilityOptimizerOutput {
  readonly featureId: typeof F228_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F228_OPERATION_CODE;
  readonly resolved_selected_provider_id: unknown;
  readonly resolved_empirical_win_rate: unknown;
  readonly resolved_estimated_cost_usd: unknown;
  readonly resolved_ucb_score: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F228_FEATURE_ID>;
}

export type F228CostAwareTokenUtilityOptimizerTelemetrySnapshot = BaseFeatureTelemetry<typeof F228_FEATURE_ID>;

export const DEFAULT_F228_CONFIG: F228CostAwareTokenUtilityOptimizerConfig = {
  featureId: F228_FEATURE_ID,
  stage: F228_STAGE,
  operationCode: F228_OPERATION_CODE,
  contractVersion: F228_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F228CostAwareTokenUtilityOptimizerValidationError extends Error {
  public readonly featureId = F228_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F228 Validation Error on '${field}']: ${message}`);
    this.name = "F228CostAwareTokenUtilityOptimizerValidationError";
    this.field = field;
  }
}

export function computeF228Digest(rawPayload: string): string {
  return `f228_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F228CostAwareTokenUtilityOptimizerService extends KosmoraFeatureAdapterBase<
  typeof F228_FEATURE_ID,
  typeof F228_STAGE,
  typeof F228_OPERATION_CODE,
  F228CostAwareTokenUtilityOptimizerConfig,
  F228CostAwareTokenUtilityOptimizerInput,
  F228CostAwareTokenUtilityOptimizerOutput
> {
  constructor(customConfig?: Partial<F228CostAwareTokenUtilityOptimizerConfig>, kernel?: Stage8FinOpsKernel) {
    super(
      DEFAULT_F228_CONFIG,
      customConfig,
      kernel ?? Stage8FinOpsKernel.getShared(),
      ["selected_provider_id", "empirical_win_rate", "estimated_cost_usd", "ucb_score"] as const,
      F228CostAwareTokenUtilityOptimizerValidationError
    );
  }
}

export function verifyF228Module(): {
  readonly featureId: typeof F228_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F228CostAwareTokenUtilityOptimizerService();
  const sampleInput: F228CostAwareTokenUtilityOptimizerInput = {
    requestId: "req_verify_f228",
    projectId: "proj_kosmora_f228",
    workspaceId: "ws_kosmora_f228",
    tenantId: "tenant_rlm_f228",
    actorId: "actor_verifier_f228",
    autonomyLevel: "A3",
    selected_provider_id: "seed_f228_selected_provider_id",
    empirical_win_rate: 42,
    estimated_cost_usd: true,
    ucb_score: "seed_f228_ucb_score",
    metadata: { stage: "stage8-finops-compliance", featureId: "F228" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F228" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_selected_provider_id !== sampleInput.selected_provider_id &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F228] Verification failed`);
  }

  return {
    featureId: F228_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
