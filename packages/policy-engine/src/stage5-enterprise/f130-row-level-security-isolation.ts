/**
 * F130 (stage5-enterprise): Строгая изоляция данных на уровне БД (Row-Level Security)
 * Аппаратно-логическое разделение данных разных арендаторов (Tenants)
 * Operation Code: rls_tenant_guard
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

export const F130_FEATURE_ID = "F130" as const;
export const F130_STAGE = "stage5-enterprise" as const;
export const F130_OPERATION_CODE = "rls_tenant_guard" as const;
export const F130_CONTRACT_VERSION = "2.0.0" as const;

export type F130RowLevelSecurityIsolationExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export type F130RowLevelSecurityIsolationConfig = BaseFeatureConfig<
  typeof F130_FEATURE_ID,
  typeof F130_STAGE,
  typeof F130_OPERATION_CODE
>;

export interface F130RowLevelSecurityIsolationInput extends BaseFeatureInput {
  readonly requesting_tenant_id: string;
  readonly row_tenant_id: string | number;
  readonly access_granted: string | number | boolean | readonly string[];
  readonly policy_enforcement: string | number | boolean | Record<string, unknown>;
}

export type F130RowLevelSecurityIsolationAuditEntry = BaseFeatureAuditEntry<typeof F130_FEATURE_ID>;

export interface F130RowLevelSecurityIsolationOutput {
  readonly featureId: typeof F130_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F130RowLevelSecurityIsolationExecutionStatus;
  readonly operationCode: typeof F130_OPERATION_CODE;
  readonly resolved_requesting_tenant_id: string;
  readonly resolved_row_tenant_id: string | number;
  readonly resolved_access_granted: string | number | boolean | readonly string[];
  readonly resolved_policy_enforcement: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F130RowLevelSecurityIsolationAuditEntry;
}

export type F130RowLevelSecurityIsolationTelemetrySnapshot = BaseFeatureTelemetry<typeof F130_FEATURE_ID>;

export const DEFAULT_F130_CONFIG: F130RowLevelSecurityIsolationConfig = {
  featureId: F130_FEATURE_ID,
  stage: F130_STAGE,
  operationCode: F130_OPERATION_CODE,
  contractVersion: F130_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F130RowLevelSecurityIsolationValidationError extends Error {
  public readonly featureId = F130_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F130 Validation Error on '${field}']: ${message}`);
    this.name = "F130RowLevelSecurityIsolationValidationError";
    this.field = field;
  }
}

export function computeF130Digest(rawPayload: string): string {
  return `f130_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F130RowLevelSecurityIsolationEngine extends KosmoraFeatureAdapterBase<
  typeof F130_FEATURE_ID,
  typeof F130_STAGE,
  typeof F130_OPERATION_CODE,
  F130RowLevelSecurityIsolationConfig,
  F130RowLevelSecurityIsolationInput,
  F130RowLevelSecurityIsolationOutput
> {
  constructor(customConfig?: Partial<F130RowLevelSecurityIsolationConfig>, kernel?: Stage5EnterpriseKernel) {
    super(
      DEFAULT_F130_CONFIG,
      customConfig,
      kernel ?? new Stage5EnterpriseKernel(),
      ["requesting_tenant_id", "row_tenant_id", "access_granted", "policy_enforcement"] as const,
      F130RowLevelSecurityIsolationValidationError
    );
  }
}

export function verifyF130Module(): {
  featureId: typeof F130_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F130RowLevelSecurityIsolationEngine();
  const sampleInput: F130RowLevelSecurityIsolationInput = {
    requestId: "req_verify_f130",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    requesting_tenant_id: "f130_requesting_tenant_id_seed",
    row_tenant_id: 42,
    access_granted: true,
    policy_enforcement: "verified_seed",
    metadata: { stage: "stage5-enterprise", featureNumber: 130 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F130" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_requesting_tenant_id !== sampleInput.requesting_tenant_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F130_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
