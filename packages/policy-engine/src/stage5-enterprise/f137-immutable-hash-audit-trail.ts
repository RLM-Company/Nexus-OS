/**
 * F137 (stage5-enterprise): Неизменяемый лог безопасности (Immutable Audit Trail)
 * Запись всех входов, вызовов инструментов, экспорта данных и изменений прав
 * Operation Code: hash_chained_audit_ledger
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

export const F137_FEATURE_ID = "F137" as const;
export const F137_STAGE = "stage5-enterprise" as const;
export const F137_OPERATION_CODE = "hash_chained_audit_ledger" as const;
export const F137_CONTRACT_VERSION = "2.0.0" as const;

export type F137ImmutableHashAuditTrailExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export type F137ImmutableHashAuditTrailConfig = BaseFeatureConfig<
  typeof F137_FEATURE_ID,
  typeof F137_STAGE,
  typeof F137_OPERATION_CODE
>;

export interface F137ImmutableHashAuditTrailInput extends BaseFeatureInput {
  readonly sequence_number: string;
  readonly previous_entry_hash: string | number;
  readonly current_entry_hash: string | number | boolean | readonly string[];
  readonly chain_tamper_free: string | number | boolean | Record<string, unknown>;
}

export type F137ImmutableHashAuditTrailAuditEntry = BaseFeatureAuditEntry<typeof F137_FEATURE_ID>;

export interface F137ImmutableHashAuditTrailOutput {
  readonly featureId: typeof F137_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F137ImmutableHashAuditTrailExecutionStatus;
  readonly operationCode: typeof F137_OPERATION_CODE;
  readonly resolved_sequence_number: string;
  readonly resolved_previous_entry_hash: string | number;
  readonly resolved_current_entry_hash: string | number | boolean | readonly string[];
  readonly resolved_chain_tamper_free: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F137ImmutableHashAuditTrailAuditEntry;
}

export type F137ImmutableHashAuditTrailTelemetrySnapshot = BaseFeatureTelemetry<typeof F137_FEATURE_ID>;

export const DEFAULT_F137_CONFIG: F137ImmutableHashAuditTrailConfig = {
  featureId: F137_FEATURE_ID,
  stage: F137_STAGE,
  operationCode: F137_OPERATION_CODE,
  contractVersion: F137_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F137ImmutableHashAuditTrailValidationError extends Error {
  public readonly featureId = F137_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F137 Validation Error on '${field}']: ${message}`);
    this.name = "F137ImmutableHashAuditTrailValidationError";
    this.field = field;
  }
}

export function computeF137Digest(rawPayload: string): string {
  return `f137_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F137ImmutableHashAuditTrailEngine extends KosmoraFeatureAdapterBase<
  typeof F137_FEATURE_ID,
  typeof F137_STAGE,
  typeof F137_OPERATION_CODE,
  F137ImmutableHashAuditTrailConfig,
  F137ImmutableHashAuditTrailInput,
  F137ImmutableHashAuditTrailOutput
> {
  constructor(customConfig?: Partial<F137ImmutableHashAuditTrailConfig>, kernel?: Stage5EnterpriseKernel) {
    super(
      DEFAULT_F137_CONFIG,
      customConfig,
      kernel ?? new Stage5EnterpriseKernel(),
      ["sequence_number", "previous_entry_hash", "current_entry_hash", "chain_tamper_free"] as const,
      F137ImmutableHashAuditTrailValidationError
    );
  }
}

export function verifyF137Module(): {
  featureId: typeof F137_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F137ImmutableHashAuditTrailEngine();
  const sampleInput: F137ImmutableHashAuditTrailInput = {
    requestId: "req_verify_f137",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    sequence_number: "f137_sequence_number_seed",
    previous_entry_hash: 42,
    current_entry_hash: true,
    chain_tamper_free: "verified_seed",
    metadata: { stage: "stage5-enterprise", featureNumber: 137 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F137" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_sequence_number !== sampleInput.sequence_number &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F137_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
