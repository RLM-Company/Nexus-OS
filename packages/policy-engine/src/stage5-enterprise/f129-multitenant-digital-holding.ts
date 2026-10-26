/**
 * F129 (stage5-enterprise): Мультитенантная архитектура («Цифровая холдинговая компания»)
 * Управление независимыми организациями, департаментами и проектами из единого мастер-аккаунта
 * Operation Code: holding_hierarchy_manager
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

export const F129_FEATURE_ID = "F129" as const;
export const F129_STAGE = "stage5-enterprise" as const;
export const F129_OPERATION_CODE = "holding_hierarchy_manager" as const;
export const F129_CONTRACT_VERSION = "2.0.0" as const;

export type F129MultitenantDigitalHoldingExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export type F129MultitenantDigitalHoldingConfig = BaseFeatureConfig<
  typeof F129_FEATURE_ID,
  typeof F129_STAGE,
  typeof F129_OPERATION_CODE
>;

export interface F129MultitenantDigitalHoldingInput extends BaseFeatureInput {
  readonly holding_id: string;
  readonly subsidiary_tenant_ids: string | number;
  readonly consolidated_governance: string | number | boolean | readonly string[];
  readonly isolation_mode: string | number | boolean | Record<string, unknown>;
}

export type F129MultitenantDigitalHoldingAuditEntry = BaseFeatureAuditEntry<typeof F129_FEATURE_ID>;

export interface F129MultitenantDigitalHoldingOutput {
  readonly featureId: typeof F129_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F129MultitenantDigitalHoldingExecutionStatus;
  readonly operationCode: typeof F129_OPERATION_CODE;
  readonly resolved_holding_id: string;
  readonly resolved_subsidiary_tenant_ids: string | number;
  readonly resolved_consolidated_governance: string | number | boolean | readonly string[];
  readonly resolved_isolation_mode: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F129MultitenantDigitalHoldingAuditEntry;
}

export type F129MultitenantDigitalHoldingTelemetrySnapshot = BaseFeatureTelemetry<typeof F129_FEATURE_ID>;

export const DEFAULT_F129_CONFIG: F129MultitenantDigitalHoldingConfig = {
  featureId: F129_FEATURE_ID,
  stage: F129_STAGE,
  operationCode: F129_OPERATION_CODE,
  contractVersion: F129_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F129MultitenantDigitalHoldingValidationError extends Error {
  public readonly featureId = F129_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F129 Validation Error on '${field}']: ${message}`);
    this.name = "F129MultitenantDigitalHoldingValidationError";
    this.field = field;
  }
}

export function computeF129Digest(rawPayload: string): string {
  return `f129_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F129MultitenantDigitalHoldingEngine extends KosmoraFeatureAdapterBase<
  typeof F129_FEATURE_ID,
  typeof F129_STAGE,
  typeof F129_OPERATION_CODE,
  F129MultitenantDigitalHoldingConfig,
  F129MultitenantDigitalHoldingInput,
  F129MultitenantDigitalHoldingOutput
> {
  constructor(customConfig?: Partial<F129MultitenantDigitalHoldingConfig>, kernel?: Stage5EnterpriseKernel) {
    super(
      DEFAULT_F129_CONFIG,
      customConfig,
      kernel ?? new Stage5EnterpriseKernel(),
      ["holding_id", "subsidiary_tenant_ids", "consolidated_governance", "isolation_mode"] as const,
      F129MultitenantDigitalHoldingValidationError
    );
  }
}

export function verifyF129Module(): {
  featureId: typeof F129_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F129MultitenantDigitalHoldingEngine();
  const sampleInput: F129MultitenantDigitalHoldingInput = {
    requestId: "req_verify_f129",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    holding_id: "f129_holding_id_seed",
    subsidiary_tenant_ids: 42,
    consolidated_governance: true,
    isolation_mode: "verified_seed",
    metadata: { stage: "stage5-enterprise", featureNumber: 129 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F129" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_holding_id !== sampleInput.holding_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F129_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
