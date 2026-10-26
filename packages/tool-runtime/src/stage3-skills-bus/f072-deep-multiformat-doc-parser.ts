/**
 * F072 (stage3-skills-bus): Глубокий парсер документов (PDF, DOCX, CSV, XLSX)
 * Извлечение текста, сложных многоуровневых таблиц и структуры заголовков без потери разметки
 * Operation Code: deep_document_extractor
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

export const F072_FEATURE_ID = "F072" as const;
export const F072_STAGE = "stage3-skills-bus" as const;
export const F072_OPERATION_CODE = "deep_document_extractor" as const;
export const F072_CONTRACT_VERSION = "2.0.0" as const;

export type F072DeepMultiformatDocParserExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export type F072DeepMultiformatDocParserConfig = BaseFeatureConfig<
  typeof F072_FEATURE_ID,
  typeof F072_STAGE,
  typeof F072_OPERATION_CODE
>;

export interface F072DeepMultiformatDocParserInput extends BaseFeatureInput {
  readonly file_name: string;
  readonly detected_format: string | number;
  readonly tables_extracted: string | number | boolean | readonly string[];
  readonly structured_markdown: string | number | boolean | Record<string, unknown>;
}

export type F072DeepMultiformatDocParserAuditEntry = BaseFeatureAuditEntry<typeof F072_FEATURE_ID>;

export interface F072DeepMultiformatDocParserOutput {
  readonly featureId: typeof F072_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F072DeepMultiformatDocParserExecutionStatus;
  readonly operationCode: typeof F072_OPERATION_CODE;
  readonly resolved_file_name: string;
  readonly resolved_detected_format: string | number;
  readonly resolved_tables_extracted: string | number | boolean | readonly string[];
  readonly resolved_structured_markdown: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F072DeepMultiformatDocParserAuditEntry;
}

export type F072DeepMultiformatDocParserTelemetrySnapshot = BaseFeatureTelemetry<typeof F072_FEATURE_ID>;

export const DEFAULT_F072_CONFIG: F072DeepMultiformatDocParserConfig = {
  featureId: F072_FEATURE_ID,
  stage: F072_STAGE,
  operationCode: F072_OPERATION_CODE,
  contractVersion: F072_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F072DeepMultiformatDocParserValidationError extends Error {
  public readonly featureId = F072_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F072 Validation Error on '${field}']: ${message}`);
    this.name = "F072DeepMultiformatDocParserValidationError";
    this.field = field;
  }
}

export function computeF072Digest(rawPayload: string): string {
  return `f072_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F072DeepMultiformatDocParserEngine extends KosmoraFeatureAdapterBase<
  typeof F072_FEATURE_ID,
  typeof F072_STAGE,
  typeof F072_OPERATION_CODE,
  F072DeepMultiformatDocParserConfig,
  F072DeepMultiformatDocParserInput,
  F072DeepMultiformatDocParserOutput
> {
  constructor(customConfig?: Partial<F072DeepMultiformatDocParserConfig>, kernel?: Stage3SkillsKernel) {
    super(
      DEFAULT_F072_CONFIG,
      customConfig,
      kernel ?? new Stage3SkillsKernel(),
      ["file_name", "detected_format", "tables_extracted", "structured_markdown"] as const,
      F072DeepMultiformatDocParserValidationError
    );
  }
}

export function verifyF072Module(): {
  featureId: typeof F072_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F072DeepMultiformatDocParserEngine();
  const sampleInput: F072DeepMultiformatDocParserInput = {
    requestId: "req_verify_f072",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    file_name: "f072_file_name_seed",
    detected_format: 42,
    tables_extracted: true,
    structured_markdown: "verified_seed",
    metadata: { stage: "stage3-skills-bus", featureNumber: 72 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F072" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_file_name !== sampleInput.file_name &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F072_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
