/**
 * F060 (stage2-canvas): Конвертер таблиц в слайды в один клик
 * Автоматическая выжимка ключевых трендов из большого XLSX-файла в 3–5 наглядных слайдов
 * Operation Code: table_to_slides_converter
 */

import { createHash } from "node:crypto";
import {
  Stage2CanvasKernel,
  KosmoraFeatureAdapterBase,
  type BaseFeatureAuditEntry,
  type BaseFeatureConfig,
  type BaseFeatureInput,
  type BaseFeatureTelemetry,
  type StageKernelExecutionResult
} from "./stage-kernel.js";

export const F060_FEATURE_ID = "F060" as const;
export const F060_STAGE = "stage2-canvas" as const;
export const F060_OPERATION_CODE = "table_to_slides_converter" as const;
export const F060_CONTRACT_VERSION = "2.0.0" as const;

export type F060OneclickTableToSlidesExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export type F060OneclickTableToSlidesConfig = BaseFeatureConfig<
  typeof F060_FEATURE_ID,
  typeof F060_STAGE,
  typeof F060_OPERATION_CODE
>;

export interface F060OneclickTableToSlidesInput extends BaseFeatureInput {
  readonly source_sheet_id: string;
  readonly generated_slides_count: string | number;
  readonly key_trends_extracted: string | number | boolean | readonly string[];
  readonly slides_payload: string | number | boolean | Record<string, unknown>;
}

export type F060OneclickTableToSlidesAuditEntry = BaseFeatureAuditEntry<typeof F060_FEATURE_ID>;

export interface F060OneclickTableToSlidesOutput {
  readonly featureId: typeof F060_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F060OneclickTableToSlidesExecutionStatus;
  readonly operationCode: typeof F060_OPERATION_CODE;
  readonly resolved_source_sheet_id: string;
  readonly resolved_generated_slides_count: string | number;
  readonly resolved_key_trends_extracted: string | number | boolean | readonly string[];
  readonly resolved_slides_payload: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F060OneclickTableToSlidesAuditEntry;
}

export type F060OneclickTableToSlidesTelemetrySnapshot = BaseFeatureTelemetry<typeof F060_FEATURE_ID>;

export const DEFAULT_F060_CONFIG: F060OneclickTableToSlidesConfig = {
  featureId: F060_FEATURE_ID,
  stage: F060_STAGE,
  operationCode: F060_OPERATION_CODE,
  contractVersion: F060_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F060OneclickTableToSlidesValidationError extends Error {
  public readonly featureId = F060_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F060 Validation Error on '${field}']: ${message}`);
    this.name = "F060OneclickTableToSlidesValidationError";
    this.field = field;
  }
}

export function computeF060Digest(rawPayload: string): string {
  return `f060_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F060OneclickTableToSlidesEngine extends KosmoraFeatureAdapterBase<
  typeof F060_FEATURE_ID,
  typeof F060_STAGE,
  typeof F060_OPERATION_CODE,
  F060OneclickTableToSlidesConfig,
  F060OneclickTableToSlidesInput,
  F060OneclickTableToSlidesOutput
> {
  constructor(customConfig?: Partial<F060OneclickTableToSlidesConfig>, kernel?: Stage2CanvasKernel) {
    super(
      DEFAULT_F060_CONFIG,
      customConfig,
      kernel ?? new Stage2CanvasKernel(),
      ["source_sheet_id", "generated_slides_count", "key_trends_extracted", "slides_payload"] as const,
      F060OneclickTableToSlidesValidationError
    );
  }
}

export function verifyF060Module(): {
  featureId: typeof F060_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F060OneclickTableToSlidesEngine();
  const sampleInput: F060OneclickTableToSlidesInput = {
    requestId: "req_verify_f060",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    source_sheet_id: "f060_source_sheet_id_seed",
    generated_slides_count: 42,
    key_trends_extracted: true,
    slides_payload: "verified_seed",
    metadata: { stage: "stage2-canvas", featureNumber: 60 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F060" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_source_sheet_id !== sampleInput.source_sheet_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F060_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
