/**
 * F303 (stage10-game-theory): Контроллер бюджетного баланса и информационной ренты аукциона VCG
 * Учёт премий Кларка и контроль соблюдения верхнего лимита расходов воркспейса
 * Operation Code: vcg_budget_balance
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

export const F303_FEATURE_ID = "F303" as const;
export const F303_STAGE = "stage10-game-theory" as const;
export const F303_OPERATION_CODE = "vcg_budget_balance" as const;
export const F303_CONTRACT_VERSION = "2.0.0" as const;

export type F303VcgBudgetBalanceSubsidyControllerConfig = BaseFeatureConfig<
  typeof F303_FEATURE_ID,
  typeof F303_STAGE,
  typeof F303_OPERATION_CODE
>;

export interface F303VcgBudgetBalanceSubsidyControllerInput extends BaseFeatureInput {
  readonly total_vcg_payments: string | number | boolean | readonly string[];
  readonly total_reported_costs: string | number | boolean | readonly string[];
  readonly information_rent_usd: string | number | boolean | readonly string[];
  readonly treasury_pool_id: string | number | boolean | readonly string[];
}

export interface F303VcgBudgetBalanceSubsidyControllerOutput {
  readonly featureId: typeof F303_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F303_OPERATION_CODE;
  readonly resolved_total_vcg_payments: unknown;
  readonly resolved_total_reported_costs: unknown;
  readonly resolved_information_rent_usd: unknown;
  readonly resolved_treasury_pool_id: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F303_FEATURE_ID>;
}

export type F303VcgBudgetBalanceSubsidyControllerTelemetrySnapshot = BaseFeatureTelemetry<typeof F303_FEATURE_ID>;

export const DEFAULT_F303_CONFIG: F303VcgBudgetBalanceSubsidyControllerConfig = {
  featureId: F303_FEATURE_ID,
  stage: F303_STAGE,
  operationCode: F303_OPERATION_CODE,
  contractVersion: F303_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F303VcgBudgetBalanceSubsidyControllerValidationError extends Error {
  public readonly featureId = F303_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F303 Validation Error on '${field}']: ${message}`);
    this.name = "F303VcgBudgetBalanceSubsidyControllerValidationError";
    this.field = field;
  }
}

export function computeF303Digest(rawPayload: string): string {
  return `f303_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F303VcgBudgetBalanceSubsidyControllerService extends KosmoraFeatureAdapterBase<
  typeof F303_FEATURE_ID,
  typeof F303_STAGE,
  typeof F303_OPERATION_CODE,
  F303VcgBudgetBalanceSubsidyControllerConfig,
  F303VcgBudgetBalanceSubsidyControllerInput,
  F303VcgBudgetBalanceSubsidyControllerOutput
> {
  constructor(customConfig?: Partial<F303VcgBudgetBalanceSubsidyControllerConfig>, kernel?: Stage10GameTheoryKernel) {
    super(
      DEFAULT_F303_CONFIG,
      customConfig,
      kernel ?? Stage10GameTheoryKernel.getShared(),
      ["total_vcg_payments", "total_reported_costs", "information_rent_usd", "treasury_pool_id"] as const,
      F303VcgBudgetBalanceSubsidyControllerValidationError
    );
  }
}

export function verifyF303Module(): {
  readonly featureId: typeof F303_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F303VcgBudgetBalanceSubsidyControllerService();
  const sampleInput: F303VcgBudgetBalanceSubsidyControllerInput = {
    requestId: "req_verify_f303",
    projectId: "proj_kosmora_f303",
    workspaceId: "ws_kosmora_f303",
    tenantId: "tenant_rlm_f303",
    actorId: "actor_verifier_f303",
    autonomyLevel: "A3",
    total_vcg_payments: "seed_f303_total_vcg_payments",
    total_reported_costs: 42,
    information_rent_usd: true,
    treasury_pool_id: "seed_f303_treasury_pool_id",
    metadata: { stage: "stage10-game-theory", featureId: "F303" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F303" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_total_vcg_payments !== sampleInput.total_vcg_payments &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F303] Verification failed`);
  }

  return {
    featureId: F303_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
