/**
 * F033 (stage2-canvas): Двухпанельный интерфейс Kosmora Canvas
 * Синхронная работа чата управления слева и интерактивного рабочего полотна справа
 * Operation Code: dual_pane_sync
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

export const F033_FEATURE_ID = "F033" as const;
export const F033_STAGE = "stage2-canvas" as const;
export const F033_OPERATION_CODE = "dual_pane_sync" as const;
export const F033_CONTRACT_VERSION = "2.0.0" as const;

export type F033DualPaneKosmoraCanvasExecutionStatus =
  "idle" | "validating" | "executing" | "completed" | "degraded" | "cancelled" | "failed";

export type F033DualPaneKosmoraCanvasConfig = BaseFeatureConfig<
  typeof F033_FEATURE_ID,
  typeof F033_STAGE,
  typeof F033_OPERATION_CODE
>;

export interface F033DualPaneKosmoraCanvasInput extends BaseFeatureInput {
  readonly workspace_id: string;
  readonly chat_pane_width_pct: string | number;
  readonly canvas_pane_width_pct: string | number | boolean | readonly string[];
  readonly sync_cursor_active: string | number | boolean | Record<string, unknown>;
}

export type F033DualPaneKosmoraCanvasAuditEntry = BaseFeatureAuditEntry<typeof F033_FEATURE_ID>;

export interface F033DualPaneKosmoraCanvasOutput {
  readonly featureId: typeof F033_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F033DualPaneKosmoraCanvasExecutionStatus;
  readonly operationCode: typeof F033_OPERATION_CODE;
  readonly resolved_workspace_id: string;
  readonly resolved_chat_pane_width_pct: string | number;
  readonly resolved_canvas_pane_width_pct: string | number | boolean | readonly string[];
  readonly resolved_sync_cursor_active: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F033DualPaneKosmoraCanvasAuditEntry;
}

export type F033DualPaneKosmoraCanvasTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F033_FEATURE_ID
>;

export const DEFAULT_F033_CONFIG: F033DualPaneKosmoraCanvasConfig = {
  featureId: F033_FEATURE_ID,
  stage: F033_STAGE,
  operationCode: F033_OPERATION_CODE,
  contractVersion: F033_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F033DualPaneKosmoraCanvasValidationError extends Error {
  public readonly featureId = F033_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F033 Validation Error on '${field}']: ${message}`);
    this.name = "F033DualPaneKosmoraCanvasValidationError";
    this.field = field;
  }
}

export function computeF033Digest(rawPayload: string): string {
  return `f033_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F033DualPaneKosmoraCanvasEngine extends KosmoraFeatureAdapterBase<
  typeof F033_FEATURE_ID,
  typeof F033_STAGE,
  typeof F033_OPERATION_CODE,
  F033DualPaneKosmoraCanvasConfig,
  F033DualPaneKosmoraCanvasInput,
  F033DualPaneKosmoraCanvasOutput
> {
  constructor(
    customConfig?: Partial<F033DualPaneKosmoraCanvasConfig>,
    kernel?: Stage2CanvasKernel
  ) {
    super(
      DEFAULT_F033_CONFIG,
      customConfig,
      kernel ?? new Stage2CanvasKernel(),
      [
        "workspace_id",
        "chat_pane_width_pct",
        "canvas_pane_width_pct",
        "sync_cursor_active"
      ] as const,
      F033DualPaneKosmoraCanvasValidationError
    );
  }
  protected override validateDomainInvariants(input: F033DualPaneKosmoraCanvasInput): void {
    if (typeof input.chat_pane_width_pct === "number" && input.chat_pane_width_pct > 1000) {
      throw new F033DualPaneKosmoraCanvasValidationError(
        "chat_pane_width_pct",
        "Metric 'chat_pane_width_pct' exceeds maximum normalized ceiling (1000)."
      );
    }
  }
}

export function verifyF033Module(): {
  featureId: typeof F033_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F033DualPaneKosmoraCanvasEngine();
  const sampleInput: F033DualPaneKosmoraCanvasInput = {
    requestId: "req_verify_f033",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    workspace_id: "f033_workspace_id_seed",
    chat_pane_width_pct: 42,
    canvas_pane_width_pct: true,
    sync_cursor_active: "verified_seed",
    metadata: { stage: "stage2-canvas", featureNumber: 33 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F033" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_workspace_id !== sampleInput.workspace_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F033_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
