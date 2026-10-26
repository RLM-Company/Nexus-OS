/**
 * F084 (stage3-skills-bus): Пакетная обработка файлов (Batch File Processor)
 * Применение одного скилла сразу к 10–50 загруженным документам с агрегацией в таблицу
 * Operation Code: batch_doc_processor
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

export const F084_FEATURE_ID = "F084" as const;
export const F084_STAGE = "stage3-skills-bus" as const;
export const F084_OPERATION_CODE = "batch_doc_processor" as const;
export const F084_CONTRACT_VERSION = "2.0.0" as const;

export type F084BatchFileSkillProcessorExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export type F084BatchFileSkillProcessorConfig = BaseFeatureConfig<
  typeof F084_FEATURE_ID,
  typeof F084_STAGE,
  typeof F084_OPERATION_CODE
>;

export interface F084BatchFileSkillProcessorInput extends BaseFeatureInput {
  readonly batch_id: string;
  readonly processed_files_count: string | number;
  readonly skill_handle: string | number | boolean | readonly string[];
  readonly aggregated_rows: string | number | boolean | Record<string, unknown>;
}

export type F084BatchFileSkillProcessorAuditEntry = BaseFeatureAuditEntry<typeof F084_FEATURE_ID>;

export interface F084BatchFileSkillProcessorOutput {
  readonly featureId: typeof F084_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F084BatchFileSkillProcessorExecutionStatus;
  readonly operationCode: typeof F084_OPERATION_CODE;
  readonly resolved_batch_id: string;
  readonly resolved_processed_files_count: string | number;
  readonly resolved_skill_handle: string | number | boolean | readonly string[];
  readonly resolved_aggregated_rows: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F084BatchFileSkillProcessorAuditEntry;
}

export type F084BatchFileSkillProcessorTelemetrySnapshot = BaseFeatureTelemetry<typeof F084_FEATURE_ID>;

export const DEFAULT_F084_CONFIG: F084BatchFileSkillProcessorConfig = {
  featureId: F084_FEATURE_ID,
  stage: F084_STAGE,
  operationCode: F084_OPERATION_CODE,
  contractVersion: F084_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F084BatchFileSkillProcessorValidationError extends Error {
  public readonly featureId = F084_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F084 Validation Error on '${field}']: ${message}`);
    this.name = "F084BatchFileSkillProcessorValidationError";
    this.field = field;
  }
}

export function computeF084Digest(rawPayload: string): string {
  return `f084_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F084BatchFileSkillProcessorEngine extends KosmoraFeatureAdapterBase<
  typeof F084_FEATURE_ID,
  typeof F084_STAGE,
  typeof F084_OPERATION_CODE,
  F084BatchFileSkillProcessorConfig,
  F084BatchFileSkillProcessorInput,
  F084BatchFileSkillProcessorOutput
> {
  constructor(customConfig?: Partial<F084BatchFileSkillProcessorConfig>, kernel?: Stage3SkillsKernel) {
    super(
      DEFAULT_F084_CONFIG,
      customConfig,
      kernel ?? new Stage3SkillsKernel(),
      ["batch_id", "processed_files_count", "skill_handle", "aggregated_rows"] as const,
      F084BatchFileSkillProcessorValidationError
    );
  }
}

export function verifyF084Module(): {
  featureId: typeof F084_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F084BatchFileSkillProcessorEngine();
  const sampleInput: F084BatchFileSkillProcessorInput = {
    requestId: "req_verify_f084",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    batch_id: "f084_batch_id_seed",
    processed_files_count: 42,
    skill_handle: true,
    aggregated_rows: "verified_seed",
    metadata: { stage: "stage3-skills-bus", featureNumber: 84 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F084" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_batch_id !== sampleInput.batch_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F084_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
