/**
 * F046 (stage2-canvas): Разделение экрана внутри Canvas (Split-View)
 * Сопоставление исходного документа и сгенерированного отчёта бок о бок
 * Operation Code: split_view_comparer
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

export const F046_FEATURE_ID = "F046" as const;
export const F046_STAGE = "stage2-canvas" as const;
export const F046_OPERATION_CODE = "split_view_comparer" as const;
export const F046_CONTRACT_VERSION = "2.0.0" as const;

export type F046CanvasSplitViewExecutionStatus =
  "idle" | "validating" | "executing" | "completed" | "degraded" | "cancelled" | "failed";

export type F046CanvasSplitViewConfig = BaseFeatureConfig<
  typeof F046_FEATURE_ID,
  typeof F046_STAGE,
  typeof F046_OPERATION_CODE
>;

export interface F046CanvasSplitViewInput extends BaseFeatureInput {
  readonly left_tab_id: string;
  readonly right_tab_id: string | number;
  readonly synchronized_scroll: string | number | boolean | readonly string[];
  readonly viewport_ratio: string | number | boolean | Record<string, unknown>;
}

export type F046CanvasSplitViewAuditEntry = BaseFeatureAuditEntry<typeof F046_FEATURE_ID>;

export interface F046CanvasSplitViewOutput {
  readonly featureId: typeof F046_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F046CanvasSplitViewExecutionStatus;
  readonly operationCode: typeof F046_OPERATION_CODE;
  readonly resolved_left_tab_id: string;
  readonly resolved_right_tab_id: string | number;
  readonly resolved_synchronized_scroll: string | number | boolean | readonly string[];
  readonly resolved_viewport_ratio: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F046CanvasSplitViewAuditEntry;
}

export type F046CanvasSplitViewTelemetrySnapshot = BaseFeatureTelemetry<typeof F046_FEATURE_ID>;

export const DEFAULT_F046_CONFIG: F046CanvasSplitViewConfig = {
  featureId: F046_FEATURE_ID,
  stage: F046_STAGE,
  operationCode: F046_OPERATION_CODE,
  contractVersion: F046_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F046CanvasSplitViewValidationError extends Error {
  public readonly featureId = F046_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F046 Validation Error on '${field}']: ${message}`);
    this.name = "F046CanvasSplitViewValidationError";
    this.field = field;
  }
}

export function computeF046Digest(rawPayload: string): string {
  return `f046_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F046CanvasSplitViewEngine extends KosmoraFeatureAdapterBase<
  typeof F046_FEATURE_ID,
  typeof F046_STAGE,
  typeof F046_OPERATION_CODE,
  F046CanvasSplitViewConfig,
  F046CanvasSplitViewInput,
  F046CanvasSplitViewOutput
> {
  constructor(customConfig?: Partial<F046CanvasSplitViewConfig>, kernel?: Stage2CanvasKernel) {
    super(
      DEFAULT_F046_CONFIG,
      customConfig,
      kernel ?? new Stage2CanvasKernel(),
      ["left_tab_id", "right_tab_id", "synchronized_scroll", "viewport_ratio"] as const,
      F046CanvasSplitViewValidationError
    );
  }
}

export function verifyF046Module(): {
  featureId: typeof F046_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F046CanvasSplitViewEngine();
  const sampleInput: F046CanvasSplitViewInput = {
    requestId: "req_verify_f046",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    left_tab_id: "f046_left_tab_id_seed",
    right_tab_id: 42,
    synchronized_scroll: true,
    viewport_ratio: "verified_seed",
    metadata: { stage: "stage2-canvas", featureNumber: 46 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F046" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_left_tab_id !== sampleInput.left_tab_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F046_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
