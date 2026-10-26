/**
 * F040 (stage2-canvas): Уточняющие контролы холста (Refined Canvas Controls)
 * Быстрые кнопки над выделенным фрагментом: Сжать, Академический стиль, Проверить факты, В таблицу
 * Operation Code: floating_toolbar_action
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

export const F040_FEATURE_ID = "F040" as const;
export const F040_STAGE = "stage2-canvas" as const;
export const F040_OPERATION_CODE = "floating_toolbar_action" as const;
export const F040_CONTRACT_VERSION = "2.0.0" as const;

export type F040RefinedCanvasControlsExecutionStatus =
  "idle" | "validating" | "executing" | "completed" | "degraded" | "cancelled" | "failed";

export type F040RefinedCanvasControlsConfig = BaseFeatureConfig<
  typeof F040_FEATURE_ID,
  typeof F040_STAGE,
  typeof F040_OPERATION_CODE
>;

export interface F040RefinedCanvasControlsInput extends BaseFeatureInput {
  readonly selection_id: string;
  readonly control_action: string | number;
  readonly original_length: string | number | boolean | readonly string[];
  readonly transformed_output: string | number | boolean | Record<string, unknown>;
}

export type F040RefinedCanvasControlsAuditEntry = BaseFeatureAuditEntry<typeof F040_FEATURE_ID>;

export interface F040RefinedCanvasControlsOutput {
  readonly featureId: typeof F040_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F040RefinedCanvasControlsExecutionStatus;
  readonly operationCode: typeof F040_OPERATION_CODE;
  readonly resolved_selection_id: string;
  readonly resolved_control_action: string | number;
  readonly resolved_original_length: string | number | boolean | readonly string[];
  readonly resolved_transformed_output: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F040RefinedCanvasControlsAuditEntry;
}

export type F040RefinedCanvasControlsTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F040_FEATURE_ID
>;

export const DEFAULT_F040_CONFIG: F040RefinedCanvasControlsConfig = {
  featureId: F040_FEATURE_ID,
  stage: F040_STAGE,
  operationCode: F040_OPERATION_CODE,
  contractVersion: F040_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F040RefinedCanvasControlsValidationError extends Error {
  public readonly featureId = F040_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F040 Validation Error on '${field}']: ${message}`);
    this.name = "F040RefinedCanvasControlsValidationError";
    this.field = field;
  }
}

export function computeF040Digest(rawPayload: string): string {
  return `f040_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F040RefinedCanvasControlsEngine extends KosmoraFeatureAdapterBase<
  typeof F040_FEATURE_ID,
  typeof F040_STAGE,
  typeof F040_OPERATION_CODE,
  F040RefinedCanvasControlsConfig,
  F040RefinedCanvasControlsInput,
  F040RefinedCanvasControlsOutput
> {
  constructor(
    customConfig?: Partial<F040RefinedCanvasControlsConfig>,
    kernel?: Stage2CanvasKernel
  ) {
    super(
      DEFAULT_F040_CONFIG,
      customConfig,
      kernel ?? new Stage2CanvasKernel(),
      ["selection_id", "control_action", "original_length", "transformed_output"] as const,
      F040RefinedCanvasControlsValidationError
    );
  }
}

export function verifyF040Module(): {
  featureId: typeof F040_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F040RefinedCanvasControlsEngine();
  const sampleInput: F040RefinedCanvasControlsInput = {
    requestId: "req_verify_f040",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    selection_id: "f040_selection_id_seed",
    control_action: 42,
    original_length: true,
    transformed_output: "verified_seed",
    metadata: { stage: "stage2-canvas", featureNumber: 40 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F040" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_selection_id !== sampleInput.selection_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F040_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
