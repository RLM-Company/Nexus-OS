/**
 * F139 (stage5-enterprise): Квоты и Rate Limiting
 * Ограничение числа одновременных агентных графов и запросов в минуту на организацию
 * Operation Code: token_bucket_ratelimiter
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

export const F139_FEATURE_ID = "F139" as const;
export const F139_STAGE = "stage5-enterprise" as const;
export const F139_OPERATION_CODE = "token_bucket_ratelimiter" as const;
export const F139_CONTRACT_VERSION = "2.0.0" as const;

export type F139OrgQuotasRateLimitingExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export type F139OrgQuotasRateLimitingConfig = BaseFeatureConfig<
  typeof F139_FEATURE_ID,
  typeof F139_STAGE,
  typeof F139_OPERATION_CODE
>;

export interface F139OrgQuotasRateLimitingInput extends BaseFeatureInput {
  readonly tenant_id: string;
  readonly requests_per_minute: string | number;
  readonly concurrent_graphs: string | number | boolean | readonly string[];
  readonly throttled: string | number | boolean | Record<string, unknown>;
}

export type F139OrgQuotasRateLimitingAuditEntry = BaseFeatureAuditEntry<typeof F139_FEATURE_ID>;

export interface F139OrgQuotasRateLimitingOutput {
  readonly featureId: typeof F139_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F139OrgQuotasRateLimitingExecutionStatus;
  readonly operationCode: typeof F139_OPERATION_CODE;
  readonly resolved_tenant_id: string;
  readonly resolved_requests_per_minute: string | number;
  readonly resolved_concurrent_graphs: string | number | boolean | readonly string[];
  readonly resolved_throttled: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F139OrgQuotasRateLimitingAuditEntry;
}

export type F139OrgQuotasRateLimitingTelemetrySnapshot = BaseFeatureTelemetry<typeof F139_FEATURE_ID>;

export const DEFAULT_F139_CONFIG: F139OrgQuotasRateLimitingConfig = {
  featureId: F139_FEATURE_ID,
  stage: F139_STAGE,
  operationCode: F139_OPERATION_CODE,
  contractVersion: F139_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F139OrgQuotasRateLimitingValidationError extends Error {
  public readonly featureId = F139_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F139 Validation Error on '${field}']: ${message}`);
    this.name = "F139OrgQuotasRateLimitingValidationError";
    this.field = field;
  }
}

export function computeF139Digest(rawPayload: string): string {
  return `f139_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F139OrgQuotasRateLimitingEngine extends KosmoraFeatureAdapterBase<
  typeof F139_FEATURE_ID,
  typeof F139_STAGE,
  typeof F139_OPERATION_CODE,
  F139OrgQuotasRateLimitingConfig,
  F139OrgQuotasRateLimitingInput,
  F139OrgQuotasRateLimitingOutput
> {
  constructor(customConfig?: Partial<F139OrgQuotasRateLimitingConfig>, kernel?: Stage5EnterpriseKernel) {
    super(
      DEFAULT_F139_CONFIG,
      customConfig,
      kernel ?? new Stage5EnterpriseKernel(),
      ["tenant_id", "requests_per_minute", "concurrent_graphs", "throttled"] as const,
      F139OrgQuotasRateLimitingValidationError
    );
  }
}

export function verifyF139Module(): {
  featureId: typeof F139_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F139OrgQuotasRateLimitingEngine();
  const sampleInput: F139OrgQuotasRateLimitingInput = {
    requestId: "req_verify_f139",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    tenant_id: "f139_tenant_id_seed",
    requests_per_minute: 42,
    concurrent_graphs: true,
    throttled: "verified_seed",
    metadata: { stage: "stage5-enterprise", featureNumber: 139 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F139" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_tenant_id !== sampleInput.tenant_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F139_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
