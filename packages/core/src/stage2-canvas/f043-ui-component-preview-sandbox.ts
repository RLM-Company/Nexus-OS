/**
 * F043 (stage2-canvas): Песочница предпросмотра UI-компонентов
 * Живой рендер HTML/Tailwind/React-артефактов прямо внутри вкладки Canvas
 * Operation Code: ui_sandbox_preview
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

export const F043_FEATURE_ID = "F043" as const;
export const F043_STAGE = "stage2-canvas" as const;
export const F043_OPERATION_CODE = "ui_sandbox_preview" as const;
export const F043_CONTRACT_VERSION = "2.0.0" as const;

export type F043UiComponentPreviewSandboxExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export type F043UiComponentPreviewSandboxConfig = BaseFeatureConfig<
  typeof F043_FEATURE_ID,
  typeof F043_STAGE,
  typeof F043_OPERATION_CODE
>;

export interface F043UiComponentPreviewSandboxInput extends BaseFeatureInput {
  readonly component_id: string;
  readonly framework_mode: string | number;
  readonly isolated_iframe_csp: string | number | boolean | readonly string[];
  readonly hydrated_ok: string | number | boolean | Record<string, unknown>;
}

export type F043UiComponentPreviewSandboxAuditEntry = BaseFeatureAuditEntry<typeof F043_FEATURE_ID>;

export interface F043UiComponentPreviewSandboxOutput {
  readonly featureId: typeof F043_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F043UiComponentPreviewSandboxExecutionStatus;
  readonly operationCode: typeof F043_OPERATION_CODE;
  readonly resolved_component_id: string;
  readonly resolved_framework_mode: string | number;
  readonly resolved_isolated_iframe_csp: string | number | boolean | readonly string[];
  readonly resolved_hydrated_ok: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F043UiComponentPreviewSandboxAuditEntry;
}

export type F043UiComponentPreviewSandboxTelemetrySnapshot = BaseFeatureTelemetry<typeof F043_FEATURE_ID>;

export const DEFAULT_F043_CONFIG: F043UiComponentPreviewSandboxConfig = {
  featureId: F043_FEATURE_ID,
  stage: F043_STAGE,
  operationCode: F043_OPERATION_CODE,
  contractVersion: F043_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F043UiComponentPreviewSandboxValidationError extends Error {
  public readonly featureId = F043_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F043 Validation Error on '${field}']: ${message}`);
    this.name = "F043UiComponentPreviewSandboxValidationError";
    this.field = field;
  }
}

export function computeF043Digest(rawPayload: string): string {
  return `f043_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F043UiComponentPreviewSandboxEngine extends KosmoraFeatureAdapterBase<
  typeof F043_FEATURE_ID,
  typeof F043_STAGE,
  typeof F043_OPERATION_CODE,
  F043UiComponentPreviewSandboxConfig,
  F043UiComponentPreviewSandboxInput,
  F043UiComponentPreviewSandboxOutput
> {
  constructor(customConfig?: Partial<F043UiComponentPreviewSandboxConfig>, kernel?: Stage2CanvasKernel) {
    super(
      DEFAULT_F043_CONFIG,
      customConfig,
      kernel ?? new Stage2CanvasKernel(),
      ["component_id", "framework_mode", "isolated_iframe_csp", "hydrated_ok"] as const,
      F043UiComponentPreviewSandboxValidationError
    );
  }
}

export function verifyF043Module(): {
  featureId: typeof F043_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F043UiComponentPreviewSandboxEngine();
  const sampleInput: F043UiComponentPreviewSandboxInput = {
    requestId: "req_verify_f043",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    component_id: "f043_component_id_seed",
    framework_mode: 42,
    isolated_iframe_csp: true,
    hydrated_ok: "verified_seed",
    metadata: { stage: "stage2-canvas", featureNumber: 43 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F043" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_component_id !== sampleInput.component_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F043_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
