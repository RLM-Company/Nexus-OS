/**
 * F157 (stage5-enterprise): Graceful Degradation (Отказоустойчивый фоллбэк)
 * Автоматическое переключение на резервного провайдера модели при падении основного API
 * Operation Code: provider_failover_switch
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

export const F157_FEATURE_ID = "F157" as const;
export const F157_STAGE = "stage5-enterprise" as const;
export const F157_OPERATION_CODE = "provider_failover_switch" as const;
export const F157_CONTRACT_VERSION = "2.0.0" as const;

export type F157GracefulDegradationFailoverExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export type F157GracefulDegradationFailoverConfig = BaseFeatureConfig<
  typeof F157_FEATURE_ID,
  typeof F157_STAGE,
  typeof F157_OPERATION_CODE
>;

export interface F157GracefulDegradationFailoverInput extends BaseFeatureInput {
  readonly primary_provider: string;
  readonly backup_provider: string | number;
  readonly failover_activated: string | number | boolean | readonly string[];
  readonly continuity_preserved: string | number | boolean | Record<string, unknown>;
}

export type F157GracefulDegradationFailoverAuditEntry = BaseFeatureAuditEntry<typeof F157_FEATURE_ID>;

export interface F157GracefulDegradationFailoverOutput {
  readonly featureId: typeof F157_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F157GracefulDegradationFailoverExecutionStatus;
  readonly operationCode: typeof F157_OPERATION_CODE;
  readonly resolved_primary_provider: string;
  readonly resolved_backup_provider: string | number;
  readonly resolved_failover_activated: string | number | boolean | readonly string[];
  readonly resolved_continuity_preserved: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F157GracefulDegradationFailoverAuditEntry;
}

export type F157GracefulDegradationFailoverTelemetrySnapshot = BaseFeatureTelemetry<typeof F157_FEATURE_ID>;

export const DEFAULT_F157_CONFIG: F157GracefulDegradationFailoverConfig = {
  featureId: F157_FEATURE_ID,
  stage: F157_STAGE,
  operationCode: F157_OPERATION_CODE,
  contractVersion: F157_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F157GracefulDegradationFailoverValidationError extends Error {
  public readonly featureId = F157_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F157 Validation Error on '${field}']: ${message}`);
    this.name = "F157GracefulDegradationFailoverValidationError";
    this.field = field;
  }
}

export function computeF157Digest(rawPayload: string): string {
  return `f157_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F157GracefulDegradationFailoverEngine extends KosmoraFeatureAdapterBase<
  typeof F157_FEATURE_ID,
  typeof F157_STAGE,
  typeof F157_OPERATION_CODE,
  F157GracefulDegradationFailoverConfig,
  F157GracefulDegradationFailoverInput,
  F157GracefulDegradationFailoverOutput
> {
  constructor(customConfig?: Partial<F157GracefulDegradationFailoverConfig>, kernel?: Stage5EnterpriseKernel) {
    super(
      DEFAULT_F157_CONFIG,
      customConfig,
      kernel ?? new Stage5EnterpriseKernel(),
      ["primary_provider", "backup_provider", "failover_activated", "continuity_preserved"] as const,
      F157GracefulDegradationFailoverValidationError
    );
  }
}

export function verifyF157Module(): {
  featureId: typeof F157_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F157GracefulDegradationFailoverEngine();
  const sampleInput: F157GracefulDegradationFailoverInput = {
    requestId: "req_verify_f157",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    primary_provider: "f157_primary_provider_seed",
    backup_provider: 42,
    failover_activated: true,
    continuity_preserved: "verified_seed",
    metadata: { stage: "stage5-enterprise", featureNumber: 157 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F157" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_primary_provider !== sampleInput.primary_provider &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F157_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
