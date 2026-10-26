/**
 * F235 (stage8-finops-compliance): Аудитор финансовой траектории подразделений цифровой холдинговой компании
 * Верификация временных рядов затрат и защита от ретроспективного искажения биллинговой статистики
 * Operation Code: tenant_cost_trajectory_auditor
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

export const F235_FEATURE_ID = "F235" as const;
export const F235_STAGE = "stage8-finops-compliance" as const;
export const F235_OPERATION_CODE = "tenant_cost_trajectory_auditor" as const;
export const F235_CONTRACT_VERSION = "2.0.0" as const;

export type F235TenantCostTrajectoryAuditorConfig = BaseFeatureConfig<
  typeof F235_FEATURE_ID,
  typeof F235_STAGE,
  typeof F235_OPERATION_CODE
>;

export interface F235TenantCostTrajectoryAuditorInput extends BaseFeatureInput {
  readonly tenant_id: string | number | boolean | readonly string[];
  readonly current_cumulative_spend_usd: string | number | boolean | readonly string[];
  readonly remaining_budget_usd: string | number | boolean | readonly string[];
  readonly forecast_digest: string | number | boolean | readonly string[];
}

export interface F235TenantCostTrajectoryAuditorOutput {
  readonly featureId: typeof F235_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F235_OPERATION_CODE;
  readonly resolved_tenant_id: unknown;
  readonly resolved_current_cumulative_spend_usd: unknown;
  readonly resolved_remaining_budget_usd: unknown;
  readonly resolved_forecast_digest: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F235_FEATURE_ID>;
}

export type F235TenantCostTrajectoryAuditorTelemetrySnapshot = BaseFeatureTelemetry<typeof F235_FEATURE_ID>;

export const DEFAULT_F235_CONFIG: F235TenantCostTrajectoryAuditorConfig = {
  featureId: F235_FEATURE_ID,
  stage: F235_STAGE,
  operationCode: F235_OPERATION_CODE,
  contractVersion: F235_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F235TenantCostTrajectoryAuditorValidationError extends Error {
  public readonly featureId = F235_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F235 Validation Error on '${field}']: ${message}`);
    this.name = "F235TenantCostTrajectoryAuditorValidationError";
    this.field = field;
  }
}

export function computeF235Digest(rawPayload: string): string {
  return `f235_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F235TenantCostTrajectoryAuditorService extends KosmoraFeatureAdapterBase<
  typeof F235_FEATURE_ID,
  typeof F235_STAGE,
  typeof F235_OPERATION_CODE,
  F235TenantCostTrajectoryAuditorConfig,
  F235TenantCostTrajectoryAuditorInput,
  F235TenantCostTrajectoryAuditorOutput
> {
  constructor(customConfig?: Partial<F235TenantCostTrajectoryAuditorConfig>, kernel?: Stage8FinOpsKernel) {
    super(
      DEFAULT_F235_CONFIG,
      customConfig,
      kernel ?? Stage8FinOpsKernel.getShared(),
      ["tenant_id", "current_cumulative_spend_usd", "remaining_budget_usd", "forecast_digest"] as const,
      F235TenantCostTrajectoryAuditorValidationError
    );
  }
}

export function verifyF235Module(): {
  readonly featureId: typeof F235_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F235TenantCostTrajectoryAuditorService();
  const sampleInput: F235TenantCostTrajectoryAuditorInput = {
    requestId: "req_verify_f235",
    projectId: "proj_kosmora_f235",
    workspaceId: "ws_kosmora_f235",
    tenantId: "tenant_rlm_f235",
    actorId: "actor_verifier_f235",
    autonomyLevel: "A3",
    tenant_id: "seed_f235_tenant_id",
    current_cumulative_spend_usd: 42,
    remaining_budget_usd: true,
    forecast_digest: "seed_f235_forecast_digest",
    metadata: { stage: "stage8-finops-compliance", featureId: "F235" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F235" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_tenant_id !== sampleInput.tenant_id &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F235] Verification failed`);
  }

  return {
    featureId: F235_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
