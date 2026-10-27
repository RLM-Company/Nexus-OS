/**
 * F044 (stage2-canvas): Встраивание интерактивных графиков (Chart Widgets)
 * Генерация динамических дашбордов (линейные, бар-чарты, воронки) по данным из отчёта
 * Operation Code: chart_widget_engine
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

export const F044_FEATURE_ID = "F044" as const;
export const F044_STAGE = "stage2-canvas" as const;
export const F044_OPERATION_CODE = "chart_widget_engine" as const;
export const F044_CONTRACT_VERSION = "2.0.0" as const;

export type F044InteractiveChartWidgetsExecutionStatus =
  "idle" | "validating" | "executing" | "completed" | "degraded" | "cancelled" | "failed";

export type F044InteractiveChartWidgetsConfig = BaseFeatureConfig<
  typeof F044_FEATURE_ID,
  typeof F044_STAGE,
  typeof F044_OPERATION_CODE
>;

export interface F044InteractiveChartWidgetsInput extends BaseFeatureInput {
  readonly widget_id: string;
  readonly chart_type: string | number;
  readonly series_count: string | number | boolean | readonly string[];
  readonly interactive_tooltips: string | number | boolean | Record<string, unknown>;
}

export type F044InteractiveChartWidgetsAuditEntry = BaseFeatureAuditEntry<typeof F044_FEATURE_ID>;

export interface F044InteractiveChartWidgetsOutput {
  readonly featureId: typeof F044_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F044InteractiveChartWidgetsExecutionStatus;
  readonly operationCode: typeof F044_OPERATION_CODE;
  readonly resolved_widget_id: string;
  readonly resolved_chart_type: string | number;
  readonly resolved_series_count: string | number | boolean | readonly string[];
  readonly resolved_interactive_tooltips: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F044InteractiveChartWidgetsAuditEntry;
}

export type F044InteractiveChartWidgetsTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F044_FEATURE_ID
>;

export const DEFAULT_F044_CONFIG: F044InteractiveChartWidgetsConfig = {
  featureId: F044_FEATURE_ID,
  stage: F044_STAGE,
  operationCode: F044_OPERATION_CODE,
  contractVersion: F044_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F044InteractiveChartWidgetsValidationError extends Error {
  public readonly featureId = F044_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F044 Validation Error on '${field}']: ${message}`);
    this.name = "F044InteractiveChartWidgetsValidationError";
    this.field = field;
  }
}

export function computeF044Digest(rawPayload: string): string {
  return `f044_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F044InteractiveChartWidgetsEngine extends KosmoraFeatureAdapterBase<
  typeof F044_FEATURE_ID,
  typeof F044_STAGE,
  typeof F044_OPERATION_CODE,
  F044InteractiveChartWidgetsConfig,
  F044InteractiveChartWidgetsInput,
  F044InteractiveChartWidgetsOutput
> {
  constructor(
    customConfig?: Partial<F044InteractiveChartWidgetsConfig>,
    kernel?: Stage2CanvasKernel
  ) {
    super(
      DEFAULT_F044_CONFIG,
      customConfig,
      kernel ?? new Stage2CanvasKernel(),
      ["widget_id", "chart_type", "series_count", "interactive_tooltips"] as const,
      F044InteractiveChartWidgetsValidationError
    );
  }
}

export function verifyF044Module(): {
  featureId: typeof F044_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F044InteractiveChartWidgetsEngine();
  const sampleInput: F044InteractiveChartWidgetsInput = {
    requestId: "req_verify_f044",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    widget_id: "f044_widget_id_seed",
    chart_type: 42,
    series_count: true,
    interactive_tooltips: "verified_seed",
    metadata: { stage: "stage2-canvas", featureNumber: 44 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F044" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_widget_id !== sampleInput.widget_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F044_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
