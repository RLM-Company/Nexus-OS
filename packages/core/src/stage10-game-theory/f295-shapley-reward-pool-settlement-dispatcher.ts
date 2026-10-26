/**
 * F295 (stage10-game-theory): Диспетчер распределения призового бюджета по долям Шепли
 * Пропорциональное начисление квот токенов и вычислительного бюджета по нормализованным весам Шепли
 * Operation Code: shapley_reward_settle
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
import { Stage10GameTheoryKernel } from "./stage-kernel.js";

export const F295_FEATURE_ID = "F295" as const;
export const F295_STAGE = "stage10-game-theory" as const;
export const F295_OPERATION_CODE = "shapley_reward_settle" as const;
export const F295_CONTRACT_VERSION = "2.0.0" as const;

export type F295ShapleyRewardPoolSettlementDispatcherConfig = BaseFeatureConfig<
  typeof F295_FEATURE_ID,
  typeof F295_STAGE,
  typeof F295_OPERATION_CODE
>;

export interface F295ShapleyRewardPoolSettlementDispatcherInput extends BaseFeatureInput {
  readonly settlement_batch_id: string | number | boolean | readonly string[];
  readonly total_budget_usd: string | number | boolean | readonly string[];
  readonly normalized_shares: string | number | boolean | readonly string[];
  readonly ledger_account: string | number | boolean | readonly string[];
}

export interface F295ShapleyRewardPoolSettlementDispatcherOutput {
  readonly featureId: typeof F295_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F295_OPERATION_CODE;
  readonly resolved_settlement_batch_id: unknown;
  readonly resolved_total_budget_usd: unknown;
  readonly resolved_normalized_shares: unknown;
  readonly resolved_ledger_account: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F295_FEATURE_ID>;
}

export type F295ShapleyRewardPoolSettlementDispatcherTelemetrySnapshot = BaseFeatureTelemetry<typeof F295_FEATURE_ID>;

export const DEFAULT_F295_CONFIG: F295ShapleyRewardPoolSettlementDispatcherConfig = {
  featureId: F295_FEATURE_ID,
  stage: F295_STAGE,
  operationCode: F295_OPERATION_CODE,
  contractVersion: F295_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F295ShapleyRewardPoolSettlementDispatcherValidationError extends Error {
  public readonly featureId = F295_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F295 Validation Error on '${field}']: ${message}`);
    this.name = "F295ShapleyRewardPoolSettlementDispatcherValidationError";
    this.field = field;
  }
}

export function computeF295Digest(rawPayload: string): string {
  return `f295_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F295ShapleyRewardPoolSettlementDispatcherService extends KosmoraFeatureAdapterBase<
  typeof F295_FEATURE_ID,
  typeof F295_STAGE,
  typeof F295_OPERATION_CODE,
  F295ShapleyRewardPoolSettlementDispatcherConfig,
  F295ShapleyRewardPoolSettlementDispatcherInput,
  F295ShapleyRewardPoolSettlementDispatcherOutput
> {
  constructor(customConfig?: Partial<F295ShapleyRewardPoolSettlementDispatcherConfig>, kernel?: Stage10GameTheoryKernel) {
    super(
      DEFAULT_F295_CONFIG,
      customConfig,
      kernel ?? Stage10GameTheoryKernel.getShared(),
      ["settlement_batch_id", "total_budget_usd", "normalized_shares", "ledger_account"] as const,
      F295ShapleyRewardPoolSettlementDispatcherValidationError
    );
  }
}

export function verifyF295Module(): {
  readonly featureId: typeof F295_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F295ShapleyRewardPoolSettlementDispatcherService();
  const sampleInput: F295ShapleyRewardPoolSettlementDispatcherInput = {
    requestId: "req_verify_f295",
    projectId: "proj_kosmora_f295",
    workspaceId: "ws_kosmora_f295",
    tenantId: "tenant_rlm_f295",
    actorId: "actor_verifier_f295",
    autonomyLevel: "A3",
    settlement_batch_id: "seed_f295_settlement_batch_id",
    total_budget_usd: 42,
    normalized_shares: true,
    ledger_account: "seed_f295_ledger_account",
    metadata: { stage: "stage10-game-theory", featureId: "F295" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F295" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_settlement_batch_id !== sampleInput.settlement_batch_id &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F295] Verification failed`);
  }

  return {
    featureId: F295_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
