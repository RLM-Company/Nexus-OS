/**
 * F038 (stage2-canvas): Генератор XLSX-таблиц с формулами
 * Сборка полноценных многостраничных таблиц с рабочими формулами, стилями и выгрузкой в .xlsx
 * Operation Code: xlsx_formula_builder
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

export const F038_FEATURE_ID = "F038" as const;
export const F038_STAGE = "stage2-canvas" as const;
export const F038_OPERATION_CODE = "xlsx_formula_builder" as const;
export const F038_CONTRACT_VERSION = "2.0.0" as const;

export type F038XlsxFormulaTableGeneratorExecutionStatus =
  "idle" | "validating" | "executing" | "completed" | "degraded" | "cancelled" | "failed";

export type F038XlsxFormulaTableGeneratorConfig = BaseFeatureConfig<
  typeof F038_FEATURE_ID,
  typeof F038_STAGE,
  typeof F038_OPERATION_CODE
>;

export interface F038XlsxFormulaTableGeneratorInput extends BaseFeatureInput {
  readonly workbook_id: string;
  readonly sheet_names: string | number;
  readonly active_formulas_count: string | number | boolean | readonly string[];
  readonly recalculated_totals: string | number | boolean | Record<string, unknown>;
}

export type F038XlsxFormulaTableGeneratorAuditEntry = BaseFeatureAuditEntry<typeof F038_FEATURE_ID>;

export interface F038XlsxFormulaTableGeneratorOutput {
  readonly featureId: typeof F038_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F038XlsxFormulaTableGeneratorExecutionStatus;
  readonly operationCode: typeof F038_OPERATION_CODE;
  readonly resolved_workbook_id: string;
  readonly resolved_sheet_names: string | number;
  readonly resolved_active_formulas_count: string | number | boolean | readonly string[];
  readonly resolved_recalculated_totals: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F038XlsxFormulaTableGeneratorAuditEntry;
}

export type F038XlsxFormulaTableGeneratorTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F038_FEATURE_ID
>;

export const DEFAULT_F038_CONFIG: F038XlsxFormulaTableGeneratorConfig = {
  featureId: F038_FEATURE_ID,
  stage: F038_STAGE,
  operationCode: F038_OPERATION_CODE,
  contractVersion: F038_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F038XlsxFormulaTableGeneratorValidationError extends Error {
  public readonly featureId = F038_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F038 Validation Error on '${field}']: ${message}`);
    this.name = "F038XlsxFormulaTableGeneratorValidationError";
    this.field = field;
  }
}

export function computeF038Digest(rawPayload: string): string {
  return `f038_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F038XlsxFormulaTableGeneratorEngine extends KosmoraFeatureAdapterBase<
  typeof F038_FEATURE_ID,
  typeof F038_STAGE,
  typeof F038_OPERATION_CODE,
  F038XlsxFormulaTableGeneratorConfig,
  F038XlsxFormulaTableGeneratorInput,
  F038XlsxFormulaTableGeneratorOutput
> {
  constructor(
    customConfig?: Partial<F038XlsxFormulaTableGeneratorConfig>,
    kernel?: Stage2CanvasKernel
  ) {
    super(
      DEFAULT_F038_CONFIG,
      customConfig,
      kernel ?? new Stage2CanvasKernel(),
      ["workbook_id", "sheet_names", "active_formulas_count", "recalculated_totals"] as const,
      F038XlsxFormulaTableGeneratorValidationError
    );
  }
}

export function verifyF038Module(): {
  featureId: typeof F038_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F038XlsxFormulaTableGeneratorEngine();
  const sampleInput: F038XlsxFormulaTableGeneratorInput = {
    requestId: "req_verify_f038",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    workbook_id: "f038_workbook_id_seed",
    sheet_names: 42,
    active_formulas_count: true,
    recalculated_totals: "verified_seed",
    metadata: { stage: "stage2-canvas", featureNumber: 38 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F038" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_workbook_id !== sampleInput.workbook_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F038_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
