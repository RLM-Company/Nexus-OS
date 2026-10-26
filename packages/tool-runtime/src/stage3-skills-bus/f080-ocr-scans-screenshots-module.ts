/**
 * F080 (stage3-skills-bus): OCR-модуль для сканов и скриншотов
 * Распознавание текста и таблиц с изображений и фотографий документов
 * Operation Code: ocr_vision_extractor
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

export const F080_FEATURE_ID = "F080" as const;
export const F080_STAGE = "stage3-skills-bus" as const;
export const F080_OPERATION_CODE = "ocr_vision_extractor" as const;
export const F080_CONTRACT_VERSION = "2.0.0" as const;

export type F080OcrScansScreenshotsModuleExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export type F080OcrScansScreenshotsModuleConfig = BaseFeatureConfig<
  typeof F080_FEATURE_ID,
  typeof F080_STAGE,
  typeof F080_OPERATION_CODE
>;

export interface F080OcrScansScreenshotsModuleInput extends BaseFeatureInput {
  readonly image_id: string;
  readonly recognized_text: string | number;
  readonly confidence_pct: string | number | boolean | readonly string[];
  readonly detected_table_cells: string | number | boolean | Record<string, unknown>;
}

export type F080OcrScansScreenshotsModuleAuditEntry = BaseFeatureAuditEntry<typeof F080_FEATURE_ID>;

export interface F080OcrScansScreenshotsModuleOutput {
  readonly featureId: typeof F080_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F080OcrScansScreenshotsModuleExecutionStatus;
  readonly operationCode: typeof F080_OPERATION_CODE;
  readonly resolved_image_id: string;
  readonly resolved_recognized_text: string | number;
  readonly resolved_confidence_pct: string | number | boolean | readonly string[];
  readonly resolved_detected_table_cells: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F080OcrScansScreenshotsModuleAuditEntry;
}

export type F080OcrScansScreenshotsModuleTelemetrySnapshot = BaseFeatureTelemetry<typeof F080_FEATURE_ID>;

export const DEFAULT_F080_CONFIG: F080OcrScansScreenshotsModuleConfig = {
  featureId: F080_FEATURE_ID,
  stage: F080_STAGE,
  operationCode: F080_OPERATION_CODE,
  contractVersion: F080_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F080OcrScansScreenshotsModuleValidationError extends Error {
  public readonly featureId = F080_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F080 Validation Error on '${field}']: ${message}`);
    this.name = "F080OcrScansScreenshotsModuleValidationError";
    this.field = field;
  }
}

export function computeF080Digest(rawPayload: string): string {
  return `f080_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F080OcrScansScreenshotsModuleEngine extends KosmoraFeatureAdapterBase<
  typeof F080_FEATURE_ID,
  typeof F080_STAGE,
  typeof F080_OPERATION_CODE,
  F080OcrScansScreenshotsModuleConfig,
  F080OcrScansScreenshotsModuleInput,
  F080OcrScansScreenshotsModuleOutput
> {
  constructor(customConfig?: Partial<F080OcrScansScreenshotsModuleConfig>, kernel?: Stage3SkillsKernel) {
    super(
      DEFAULT_F080_CONFIG,
      customConfig,
      kernel ?? new Stage3SkillsKernel(),
      ["image_id", "recognized_text", "confidence_pct", "detected_table_cells"] as const,
      F080OcrScansScreenshotsModuleValidationError
    );
  }
}

export function verifyF080Module(): {
  featureId: typeof F080_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F080OcrScansScreenshotsModuleEngine();
  const sampleInput: F080OcrScansScreenshotsModuleInput = {
    requestId: "req_verify_f080",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    image_id: "f080_image_id_seed",
    recognized_text: 42,
    confidence_pct: true,
    detected_table_cells: "verified_seed",
    metadata: { stage: "stage3-skills-bus", featureNumber: 80 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F080" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_image_id !== sampleInput.image_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F080_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
