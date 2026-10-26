/**
 * F090 (stage3-skills-bus): Конвертер форматов данных на лету
 * Мгновенный перевод JSON <-> CSV <-> XLSX <-> Markdown Table <-> SQL Insert
 * Operation Code: data_format_transformer
 */

import { createHash } from "node:crypto";
import {
  Stage3SkillsKernel,
  KosmoraFeatureAdapterBase,
  type BaseFeatureAuditEntry,
  type BaseFeatureConfig,
  type BaseFeatureInput,
  type BaseFeatureTelemetry,
  type StageKernelExecutionResult
} from "./stage-kernel.js";

export const F090_FEATURE_ID = "F090" as const;
export const F090_STAGE = "stage3-skills-bus" as const;
export const F090_OPERATION_CODE = "data_format_transformer" as const;
export const F090_CONTRACT_VERSION = "2.0.0" as const;

export type F090OntheflyDataFormatConverterExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export type F090OntheflyDataFormatConverterConfig = BaseFeatureConfig<
  typeof F090_FEATURE_ID,
  typeof F090_STAGE,
  typeof F090_OPERATION_CODE
>;

export interface F090OntheflyDataFormatConverterInput extends BaseFeatureInput {
  readonly source_format: string;
  readonly target_format: string | number;
  readonly records_converted: string | number | boolean | readonly string[];
  readonly serialized_output: string | number | boolean | Record<string, unknown>;
}

export type F090OntheflyDataFormatConverterAuditEntry = BaseFeatureAuditEntry<typeof F090_FEATURE_ID>;

export interface F090OntheflyDataFormatConverterOutput {
  readonly featureId: typeof F090_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F090OntheflyDataFormatConverterExecutionStatus;
  readonly operationCode: typeof F090_OPERATION_CODE;
  readonly resolved_source_format: string;
  readonly resolved_target_format: string | number;
  readonly resolved_records_converted: string | number | boolean | readonly string[];
  readonly resolved_serialized_output: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F090OntheflyDataFormatConverterAuditEntry;
}

export type F090OntheflyDataFormatConverterTelemetrySnapshot = BaseFeatureTelemetry<typeof F090_FEATURE_ID>;

export const DEFAULT_F090_CONFIG: F090OntheflyDataFormatConverterConfig = {
  featureId: F090_FEATURE_ID,
  stage: F090_STAGE,
  operationCode: F090_OPERATION_CODE,
  contractVersion: F090_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F090OntheflyDataFormatConverterValidationError extends Error {
  public readonly featureId = F090_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F090 Validation Error on '${field}']: ${message}`);
    this.name = "F090OntheflyDataFormatConverterValidationError";
    this.field = field;
  }
}

export function computeF090Digest(rawPayload: string): string {
  return `f090_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F090OntheflyDataFormatConverterEngine extends KosmoraFeatureAdapterBase<
  typeof F090_FEATURE_ID,
  typeof F090_STAGE,
  typeof F090_OPERATION_CODE,
  F090OntheflyDataFormatConverterConfig,
  F090OntheflyDataFormatConverterInput,
  F090OntheflyDataFormatConverterOutput
> {
  constructor(customConfig?: Partial<F090OntheflyDataFormatConverterConfig>, kernel?: Stage3SkillsKernel) {
    super(
      DEFAULT_F090_CONFIG,
      customConfig,
      kernel ?? new Stage3SkillsKernel(),
      ["source_format", "target_format", "records_converted", "serialized_output"] as const,
      F090OntheflyDataFormatConverterValidationError
    );
  }
}

export function verifyF090Module(): {
  featureId: typeof F090_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F090OntheflyDataFormatConverterEngine();
  const sampleInput: F090OntheflyDataFormatConverterInput = {
    requestId: "req_verify_f090",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    source_format: "f090_source_format_seed",
    target_format: 42,
    records_converted: true,
    serialized_output: "verified_seed",
    metadata: { stage: "stage3-skills-bus", featureNumber: 90 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F090" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_source_format !== sampleInput.source_format &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F090_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
