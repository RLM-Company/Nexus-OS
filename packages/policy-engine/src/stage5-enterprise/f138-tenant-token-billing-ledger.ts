/**
 * F138 (stage5-enterprise): Биллинг и учёт расхода токенов по тенантам
 * Детальная разбивка стоимости запросов по проектам, пользователям и моделям
 * Operation Code: tenant_usage_metering
 */

import { createHash } from "node:crypto";
import {
  Stage5EnterpriseKernel,
  KosmoraFeatureAdapterBase,
  type BaseFeatureAuditEntry,
  type BaseFeatureConfig,
  type BaseFeatureInput,
  type BaseFeatureTelemetry,
  type StageKernelExecutionResult
} from "./stage-kernel.js";

export const F138_FEATURE_ID = "F138" as const;
export const F138_STAGE = "stage5-enterprise" as const;
export const F138_OPERATION_CODE = "tenant_usage_metering" as const;
export const F138_CONTRACT_VERSION = "2.0.0" as const;

export type F138TenantTokenBillingLedgerExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export type F138TenantTokenBillingLedgerConfig = BaseFeatureConfig<
  typeof F138_FEATURE_ID,
  typeof F138_STAGE,
  typeof F138_OPERATION_CODE
>;

export interface F138TenantTokenBillingLedgerInput extends BaseFeatureInput {
  readonly tenant_id: string;
  readonly prompt_tokens: string | number;
  readonly completion_tokens: string | number | boolean | readonly string[];
  readonly accrued_cost_usd: string | number | boolean | Record<string, unknown>;
}

export type F138TenantTokenBillingLedgerAuditEntry = BaseFeatureAuditEntry<typeof F138_FEATURE_ID>;

export interface F138TenantTokenBillingLedgerOutput {
  readonly featureId: typeof F138_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F138TenantTokenBillingLedgerExecutionStatus;
  readonly operationCode: typeof F138_OPERATION_CODE;
  readonly resolved_tenant_id: string;
  readonly resolved_prompt_tokens: string | number;
  readonly resolved_completion_tokens: string | number | boolean | readonly string[];
  readonly resolved_accrued_cost_usd: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F138TenantTokenBillingLedgerAuditEntry;
}

export type F138TenantTokenBillingLedgerTelemetrySnapshot = BaseFeatureTelemetry<typeof F138_FEATURE_ID>;

export const DEFAULT_F138_CONFIG: F138TenantTokenBillingLedgerConfig = {
  featureId: F138_FEATURE_ID,
  stage: F138_STAGE,
  operationCode: F138_OPERATION_CODE,
  contractVersion: F138_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F138TenantTokenBillingLedgerValidationError extends Error {
  public readonly featureId = F138_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F138 Validation Error on '${field}']: ${message}`);
    this.name = "F138TenantTokenBillingLedgerValidationError";
    this.field = field;
  }
}

export function computeF138Digest(rawPayload: string): string {
  return `f138_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F138TenantTokenBillingLedgerEngine extends KosmoraFeatureAdapterBase<
  typeof F138_FEATURE_ID,
  typeof F138_STAGE,
  typeof F138_OPERATION_CODE,
  F138TenantTokenBillingLedgerConfig,
  F138TenantTokenBillingLedgerInput,
  F138TenantTokenBillingLedgerOutput
> {
  constructor(customConfig?: Partial<F138TenantTokenBillingLedgerConfig>, kernel?: Stage5EnterpriseKernel) {
    super(
      DEFAULT_F138_CONFIG,
      customConfig,
      kernel ?? new Stage5EnterpriseKernel(),
      ["tenant_id", "prompt_tokens", "completion_tokens", "accrued_cost_usd"] as const,
      F138TenantTokenBillingLedgerValidationError
    );
  }
}

export function verifyF138Module(): {
  featureId: typeof F138_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F138TenantTokenBillingLedgerEngine();
  const sampleInput: F138TenantTokenBillingLedgerInput = {
    requestId: "req_verify_f138",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    tenant_id: "f138_tenant_id_seed",
    prompt_tokens: 42,
    completion_tokens: true,
    accrued_cost_usd: "verified_seed",
    metadata: { stage: "stage5-enterprise", featureNumber: 138 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F138" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_tenant_id !== sampleInput.tenant_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F138_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
