/**
 * F015 (stage1-autonomy): Контракты ввода-вывода (Strict JSON Schema IO)
 * Валидация типизированных ответов между агентами через схемы данных
 * Operation Code: schema_validator
 */

import { createHash } from "node:crypto";
import {
  Stage1AutonomyKernel,
  KosmoraFeatureAdapterBase,
  type BaseFeatureAuditEntry,
  type BaseFeatureConfig,
  type BaseFeatureInput,
  type BaseFeatureTelemetry,
  type StageKernelExecutionResult
} from "./stage-kernel.js";

export const F015_FEATURE_ID = "F015" as const;
export const F015_STAGE = "stage1-autonomy" as const;
export const F015_OPERATION_CODE = "schema_validator" as const;
export const F015_CONTRACT_VERSION = "2.0.0" as const;

export type F015StrictJsonSchemaIoExecutionStatus =
  "idle" | "validating" | "executing" | "completed" | "degraded" | "cancelled" | "failed";

export type F015StrictJsonSchemaIoConfig = BaseFeatureConfig<
  typeof F015_FEATURE_ID,
  typeof F015_STAGE,
  typeof F015_OPERATION_CODE
>;

export interface F015StrictJsonSchemaIoInput extends BaseFeatureInput {
  readonly schema_id: string;
  readonly payload_valid: string | number;
  readonly validated_fields_count: string | number | boolean | readonly string[];
  readonly violation_errors: string | number | boolean | Record<string, unknown>;
}

export type F015StrictJsonSchemaIoAuditEntry = BaseFeatureAuditEntry<typeof F015_FEATURE_ID>;

export interface F015StrictJsonSchemaIoOutput {
  readonly featureId: typeof F015_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F015StrictJsonSchemaIoExecutionStatus;
  readonly operationCode: typeof F015_OPERATION_CODE;
  readonly resolved_schema_id: string;
  readonly resolved_payload_valid: string | number;
  readonly resolved_validated_fields_count: string | number | boolean | readonly string[];
  readonly resolved_violation_errors: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F015StrictJsonSchemaIoAuditEntry;
}

export type F015StrictJsonSchemaIoTelemetrySnapshot = BaseFeatureTelemetry<typeof F015_FEATURE_ID>;

export const DEFAULT_F015_CONFIG: F015StrictJsonSchemaIoConfig = {
  featureId: F015_FEATURE_ID,
  stage: F015_STAGE,
  operationCode: F015_OPERATION_CODE,
  contractVersion: F015_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F015StrictJsonSchemaIoValidationError extends Error {
  public readonly featureId = F015_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F015 Validation Error on '${field}']: ${message}`);
    this.name = "F015StrictJsonSchemaIoValidationError";
    this.field = field;
  }
}

export function computeF015Digest(rawPayload: string): string {
  return `f015_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F015StrictJsonSchemaIoEngine extends KosmoraFeatureAdapterBase<
  typeof F015_FEATURE_ID,
  typeof F015_STAGE,
  typeof F015_OPERATION_CODE,
  F015StrictJsonSchemaIoConfig,
  F015StrictJsonSchemaIoInput,
  F015StrictJsonSchemaIoOutput
> {
  constructor(customConfig?: Partial<F015StrictJsonSchemaIoConfig>, kernel?: Stage1AutonomyKernel) {
    super(
      DEFAULT_F015_CONFIG,
      customConfig,
      kernel ?? new Stage1AutonomyKernel(),
      ["schema_id", "payload_valid", "validated_fields_count", "violation_errors"] as const,
      F015StrictJsonSchemaIoValidationError
    );
  }
}

export function verifyF015Module(): {
  featureId: typeof F015_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F015StrictJsonSchemaIoEngine();
  const sampleInput: F015StrictJsonSchemaIoInput = {
    requestId: "req_verify_f015",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    schema_id: "f015_schema_id_seed",
    payload_valid: 42,
    validated_fields_count: true,
    violation_errors: "verified_seed",
    metadata: { stage: "stage1-autonomy", featureNumber: 15 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F015" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_schema_id !== sampleInput.schema_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F015_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
