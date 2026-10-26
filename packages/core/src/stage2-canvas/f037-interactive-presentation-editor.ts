/**
 * F037 (stage2-canvas): Интерактивный редактор презентаций (Presentation Editor)
 * По-слайдовое создание, редактирование сетки, тезисов и заметок спикера прямо на Canvas
 * Operation Code: slide_deck_editor
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

export const F037_FEATURE_ID = "F037" as const;
export const F037_STAGE = "stage2-canvas" as const;
export const F037_OPERATION_CODE = "slide_deck_editor" as const;
export const F037_CONTRACT_VERSION = "2.0.0" as const;

export type F037InteractivePresentationEditorExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export type F037InteractivePresentationEditorConfig = BaseFeatureConfig<
  typeof F037_FEATURE_ID,
  typeof F037_STAGE,
  typeof F037_OPERATION_CODE
>;

export interface F037InteractivePresentationEditorInput extends BaseFeatureInput {
  readonly deck_id: string;
  readonly slide_count: string | number;
  readonly grid_layout: string | number | boolean | readonly string[];
  readonly speaker_notes_attached: string | number | boolean | Record<string, unknown>;
}

export type F037InteractivePresentationEditorAuditEntry = BaseFeatureAuditEntry<typeof F037_FEATURE_ID>;

export interface F037InteractivePresentationEditorOutput {
  readonly featureId: typeof F037_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F037InteractivePresentationEditorExecutionStatus;
  readonly operationCode: typeof F037_OPERATION_CODE;
  readonly resolved_deck_id: string;
  readonly resolved_slide_count: string | number;
  readonly resolved_grid_layout: string | number | boolean | readonly string[];
  readonly resolved_speaker_notes_attached: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F037InteractivePresentationEditorAuditEntry;
}

export type F037InteractivePresentationEditorTelemetrySnapshot = BaseFeatureTelemetry<typeof F037_FEATURE_ID>;

export const DEFAULT_F037_CONFIG: F037InteractivePresentationEditorConfig = {
  featureId: F037_FEATURE_ID,
  stage: F037_STAGE,
  operationCode: F037_OPERATION_CODE,
  contractVersion: F037_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F037InteractivePresentationEditorValidationError extends Error {
  public readonly featureId = F037_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F037 Validation Error on '${field}']: ${message}`);
    this.name = "F037InteractivePresentationEditorValidationError";
    this.field = field;
  }
}

export function computeF037Digest(rawPayload: string): string {
  return `f037_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F037InteractivePresentationEditorEngine extends KosmoraFeatureAdapterBase<
  typeof F037_FEATURE_ID,
  typeof F037_STAGE,
  typeof F037_OPERATION_CODE,
  F037InteractivePresentationEditorConfig,
  F037InteractivePresentationEditorInput,
  F037InteractivePresentationEditorOutput
> {
  constructor(customConfig?: Partial<F037InteractivePresentationEditorConfig>, kernel?: Stage2CanvasKernel) {
    super(
      DEFAULT_F037_CONFIG,
      customConfig,
      kernel ?? new Stage2CanvasKernel(),
      ["deck_id", "slide_count", "grid_layout", "speaker_notes_attached"] as const,
      F037InteractivePresentationEditorValidationError
    );
  }
}

export function verifyF037Module(): {
  featureId: typeof F037_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F037InteractivePresentationEditorEngine();
  const sampleInput: F037InteractivePresentationEditorInput = {
    requestId: "req_verify_f037",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    deck_id: "f037_deck_id_seed",
    slide_count: 42,
    grid_layout: true,
    speaker_notes_attached: "verified_seed",
    metadata: { stage: "stage2-canvas", featureNumber: 37 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F037" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_deck_id !== sampleInput.deck_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F037_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
