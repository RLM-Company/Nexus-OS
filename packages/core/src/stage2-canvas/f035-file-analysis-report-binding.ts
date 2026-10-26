/**
 * F035 (stage2-canvas): Прямая связь анализа файлов с отчётами (File Analysis-to-Report Binding)
 * Живые ссылки из выводов в отчёте на конкретные строки/ячейки исходного загруженного файла
 * Operation Code: cell_citation_binding
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

export const F035_FEATURE_ID = "F035" as const;
export const F035_STAGE = "stage2-canvas" as const;
export const F035_OPERATION_CODE = "cell_citation_binding" as const;
export const F035_CONTRACT_VERSION = "2.0.0" as const;

export type F035FileAnalysisReportBindingExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export type F035FileAnalysisReportBindingConfig = BaseFeatureConfig<
  typeof F035_FEATURE_ID,
  typeof F035_STAGE,
  typeof F035_OPERATION_CODE
>;

export interface F035FileAnalysisReportBindingInput extends BaseFeatureInput {
  readonly binding_id: string;
  readonly source_file_id: string | number;
  readonly sheet_cell_coord: string | number | boolean | readonly string[];
  readonly bound_report_paragraph: string | number | boolean | Record<string, unknown>;
}

export type F035FileAnalysisReportBindingAuditEntry = BaseFeatureAuditEntry<typeof F035_FEATURE_ID>;

export interface F035FileAnalysisReportBindingOutput {
  readonly featureId: typeof F035_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F035FileAnalysisReportBindingExecutionStatus;
  readonly operationCode: typeof F035_OPERATION_CODE;
  readonly resolved_binding_id: string;
  readonly resolved_source_file_id: string | number;
  readonly resolved_sheet_cell_coord: string | number | boolean | readonly string[];
  readonly resolved_bound_report_paragraph: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F035FileAnalysisReportBindingAuditEntry;
}

export type F035FileAnalysisReportBindingTelemetrySnapshot = BaseFeatureTelemetry<typeof F035_FEATURE_ID>;

export const DEFAULT_F035_CONFIG: F035FileAnalysisReportBindingConfig = {
  featureId: F035_FEATURE_ID,
  stage: F035_STAGE,
  operationCode: F035_OPERATION_CODE,
  contractVersion: F035_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F035FileAnalysisReportBindingValidationError extends Error {
  public readonly featureId = F035_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F035 Validation Error on '${field}']: ${message}`);
    this.name = "F035FileAnalysisReportBindingValidationError";
    this.field = field;
  }
}

export function computeF035Digest(rawPayload: string): string {
  return `f035_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F035FileAnalysisReportBindingEngine extends KosmoraFeatureAdapterBase<
  typeof F035_FEATURE_ID,
  typeof F035_STAGE,
  typeof F035_OPERATION_CODE,
  F035FileAnalysisReportBindingConfig,
  F035FileAnalysisReportBindingInput,
  F035FileAnalysisReportBindingOutput
> {
  constructor(customConfig?: Partial<F035FileAnalysisReportBindingConfig>, kernel?: Stage2CanvasKernel) {
    super(
      DEFAULT_F035_CONFIG,
      customConfig,
      kernel ?? new Stage2CanvasKernel(),
      ["binding_id", "source_file_id", "sheet_cell_coord", "bound_report_paragraph"] as const,
      F035FileAnalysisReportBindingValidationError
    );
  }
}

export function verifyF035Module(): {
  featureId: typeof F035_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F035FileAnalysisReportBindingEngine();
  const sampleInput: F035FileAnalysisReportBindingInput = {
    requestId: "req_verify_f035",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    binding_id: "f035_binding_id_seed",
    source_file_id: 42,
    sheet_cell_coord: true,
    bound_report_paragraph: "verified_seed",
    metadata: { stage: "stage2-canvas", featureNumber: 35 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F035" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_binding_id !== sampleInput.binding_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F035_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
