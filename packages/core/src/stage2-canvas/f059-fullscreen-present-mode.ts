/**
 * F059 (stage2-canvas): Режим чтения и презентации (Full-screen Present Mode)
 * Разворачивание слайдов на весь экран с поддержкой горячих клавиш
 * Operation Code: present_mode_controller
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

export const F059_FEATURE_ID = "F059" as const;
export const F059_STAGE = "stage2-canvas" as const;
export const F059_OPERATION_CODE = "present_mode_controller" as const;
export const F059_CONTRACT_VERSION = "2.0.0" as const;

export type F059FullscreenPresentModeExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export type F059FullscreenPresentModeConfig = BaseFeatureConfig<
  typeof F059_FEATURE_ID,
  typeof F059_STAGE,
  typeof F059_OPERATION_CODE
>;

export interface F059FullscreenPresentModeInput extends BaseFeatureInput {
  readonly deck_id: string;
  readonly current_slide_index: string | number;
  readonly hotkeys_enabled: string | number | boolean | readonly string[];
  readonly fullscreen_active: string | number | boolean | Record<string, unknown>;
}

export type F059FullscreenPresentModeAuditEntry = BaseFeatureAuditEntry<typeof F059_FEATURE_ID>;

export interface F059FullscreenPresentModeOutput {
  readonly featureId: typeof F059_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F059FullscreenPresentModeExecutionStatus;
  readonly operationCode: typeof F059_OPERATION_CODE;
  readonly resolved_deck_id: string;
  readonly resolved_current_slide_index: string | number;
  readonly resolved_hotkeys_enabled: string | number | boolean | readonly string[];
  readonly resolved_fullscreen_active: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F059FullscreenPresentModeAuditEntry;
}

export type F059FullscreenPresentModeTelemetrySnapshot = BaseFeatureTelemetry<typeof F059_FEATURE_ID>;

export const DEFAULT_F059_CONFIG: F059FullscreenPresentModeConfig = {
  featureId: F059_FEATURE_ID,
  stage: F059_STAGE,
  operationCode: F059_OPERATION_CODE,
  contractVersion: F059_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F059FullscreenPresentModeValidationError extends Error {
  public readonly featureId = F059_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F059 Validation Error on '${field}']: ${message}`);
    this.name = "F059FullscreenPresentModeValidationError";
    this.field = field;
  }
}

export function computeF059Digest(rawPayload: string): string {
  return `f059_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F059FullscreenPresentModeEngine extends KosmoraFeatureAdapterBase<
  typeof F059_FEATURE_ID,
  typeof F059_STAGE,
  typeof F059_OPERATION_CODE,
  F059FullscreenPresentModeConfig,
  F059FullscreenPresentModeInput,
  F059FullscreenPresentModeOutput
> {
  constructor(customConfig?: Partial<F059FullscreenPresentModeConfig>, kernel?: Stage2CanvasKernel) {
    super(
      DEFAULT_F059_CONFIG,
      customConfig,
      kernel ?? new Stage2CanvasKernel(),
      ["deck_id", "current_slide_index", "hotkeys_enabled", "fullscreen_active"] as const,
      F059FullscreenPresentModeValidationError
    );
  }
}

export function verifyF059Module(): {
  featureId: typeof F059_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F059FullscreenPresentModeEngine();
  const sampleInput: F059FullscreenPresentModeInput = {
    requestId: "req_verify_f059",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    deck_id: "f059_deck_id_seed",
    current_slide_index: 42,
    hotkeys_enabled: true,
    fullscreen_active: "verified_seed",
    metadata: { stage: "stage2-canvas", featureNumber: 59 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F059" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_deck_id !== sampleInput.deck_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F059_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
