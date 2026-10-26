/**
 * F202 (stage7-formal-verification): Минимизатор стоимости размещения при соблюдении SLA и ролей
 * Выбор наиболее экономичных совместимых узлов кластера без нарушения ограничений ролей и памяти
 * Operation Code: sla_cost_minimizing_scheduler
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
import { Stage7FormalKernel } from "./stage-kernel.js";

export const F202_FEATURE_ID = "F202" as const;
export const F202_STAGE = "stage7-formal-verification" as const;
export const F202_OPERATION_CODE = "sla_cost_minimizing_scheduler" as const;
export const F202_CONTRACT_VERSION = "2.0.0" as const;

export type F202SlaCostMinimizingSchedulerConfig = BaseFeatureConfig<
  typeof F202_FEATURE_ID,
  typeof F202_STAGE,
  typeof F202_OPERATION_CODE
>;

export interface F202SlaCostMinimizingSchedulerInput extends BaseFeatureInput {
  readonly total_cost_usd: string | number | boolean | readonly string[];
  readonly budget_limit_usd: string | number | boolean | readonly string[];
  readonly within_budget: string | number | boolean | readonly string[];
  readonly selected_hosts: string | number | boolean | readonly string[];
}

export interface F202SlaCostMinimizingSchedulerOutput {
  readonly featureId: typeof F202_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F202_OPERATION_CODE;
  readonly resolved_total_cost_usd: unknown;
  readonly resolved_budget_limit_usd: unknown;
  readonly resolved_within_budget: unknown;
  readonly resolved_selected_hosts: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F202_FEATURE_ID>;
}

export type F202SlaCostMinimizingSchedulerTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F202_FEATURE_ID
>;

export const DEFAULT_F202_CONFIG: F202SlaCostMinimizingSchedulerConfig = {
  featureId: F202_FEATURE_ID,
  stage: F202_STAGE,
  operationCode: F202_OPERATION_CODE,
  contractVersion: F202_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F202SlaCostMinimizingSchedulerValidationError extends Error {
  public readonly featureId = F202_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F202 Validation Error on '${field}']: ${message}`);
    this.name = "F202SlaCostMinimizingSchedulerValidationError";
    this.field = field;
  }
}

export function computeF202Digest(rawPayload: string): string {
  return `f202_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F202SlaCostMinimizingSchedulerService extends KosmoraFeatureAdapterBase<
  typeof F202_FEATURE_ID,
  typeof F202_STAGE,
  typeof F202_OPERATION_CODE,
  F202SlaCostMinimizingSchedulerConfig,
  F202SlaCostMinimizingSchedulerInput,
  F202SlaCostMinimizingSchedulerOutput
> {
  constructor(
    customConfig?: Partial<F202SlaCostMinimizingSchedulerConfig>,
    kernel?: Stage7FormalKernel
  ) {
    super(
      DEFAULT_F202_CONFIG,
      customConfig,
      kernel ?? Stage7FormalKernel.getShared(),
      ["total_cost_usd", "budget_limit_usd", "within_budget", "selected_hosts"] as const,
      F202SlaCostMinimizingSchedulerValidationError
    );
  }
}

export function verifyF202Module(): {
  readonly featureId: typeof F202_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F202SlaCostMinimizingSchedulerService();
  const sampleInput: F202SlaCostMinimizingSchedulerInput = {
    requestId: "req_verify_f202",
    projectId: "proj_kosmora_f202",
    workspaceId: "ws_kosmora_f202",
    tenantId: "tenant_rlm_f202",
    actorId: "actor_verifier_f202",
    autonomyLevel: "A3",
    total_cost_usd: "seed_f202_total_cost_usd",
    budget_limit_usd: 42,
    within_budget: true,
    selected_hosts: "seed_f202_selected_hosts",
    metadata: { stage: "stage7-formal-verification", featureId: "F202" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F202" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_total_cost_usd !== sampleInput.total_cost_usd &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F202] Verification failed`);
  }

  return {
    featureId: F202_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
