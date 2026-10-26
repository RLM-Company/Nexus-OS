/**
 * F051 (stage2-canvas): Экспорт отчётов в PDF с корпоративной вёрсткой
 * Компиляция документов с титульным листом, оглавлением и кастомным брендингом
 * Operation Code: corporate_pdf_compiler
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

export const F051_FEATURE_ID = "F051" as const;
export const F051_STAGE = "stage2-canvas" as const;
export const F051_OPERATION_CODE = "corporate_pdf_compiler" as const;
export const F051_CONTRACT_VERSION = "2.0.0" as const;

export type F051CorporatePdfReportExporterExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export type F051CorporatePdfReportExporterConfig = BaseFeatureConfig<
  typeof F051_FEATURE_ID,
  typeof F051_STAGE,
  typeof F051_OPERATION_CODE
>;

export interface F051CorporatePdfReportExporterInput extends BaseFeatureInput {
  readonly document_id: string;
  readonly cover_page_included: string | number;
  readonly toc_generated: string | number | boolean | readonly string[];
  readonly page_count: string | number | boolean | Record<string, unknown>;
}

export type F051CorporatePdfReportExporterAuditEntry = BaseFeatureAuditEntry<typeof F051_FEATURE_ID>;

export interface F051CorporatePdfReportExporterOutput {
  readonly featureId: typeof F051_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F051CorporatePdfReportExporterExecutionStatus;
  readonly operationCode: typeof F051_OPERATION_CODE;
  readonly resolved_document_id: string;
  readonly resolved_cover_page_included: string | number;
  readonly resolved_toc_generated: string | number | boolean | readonly string[];
  readonly resolved_page_count: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F051CorporatePdfReportExporterAuditEntry;
}

export type F051CorporatePdfReportExporterTelemetrySnapshot = BaseFeatureTelemetry<typeof F051_FEATURE_ID>;

export const DEFAULT_F051_CONFIG: F051CorporatePdfReportExporterConfig = {
  featureId: F051_FEATURE_ID,
  stage: F051_STAGE,
  operationCode: F051_OPERATION_CODE,
  contractVersion: F051_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F051CorporatePdfReportExporterValidationError extends Error {
  public readonly featureId = F051_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F051 Validation Error on '${field}']: ${message}`);
    this.name = "F051CorporatePdfReportExporterValidationError";
    this.field = field;
  }
}

export function computeF051Digest(rawPayload: string): string {
  return `f051_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F051CorporatePdfReportExporterEngine extends KosmoraFeatureAdapterBase<
  typeof F051_FEATURE_ID,
  typeof F051_STAGE,
  typeof F051_OPERATION_CODE,
  F051CorporatePdfReportExporterConfig,
  F051CorporatePdfReportExporterInput,
  F051CorporatePdfReportExporterOutput
> {
  constructor(customConfig?: Partial<F051CorporatePdfReportExporterConfig>, kernel?: Stage2CanvasKernel) {
    super(
      DEFAULT_F051_CONFIG,
      customConfig,
      kernel ?? new Stage2CanvasKernel(),
      ["document_id", "cover_page_included", "toc_generated", "page_count"] as const,
      F051CorporatePdfReportExporterValidationError
    );
  }
}

export function verifyF051Module(): {
  featureId: typeof F051_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F051CorporatePdfReportExporterEngine();
  const sampleInput: F051CorporatePdfReportExporterInput = {
    requestId: "req_verify_f051",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    document_id: "f051_document_id_seed",
    cover_page_included: 42,
    toc_generated: true,
    page_count: "verified_seed",
    metadata: { stage: "stage2-canvas", featureNumber: 51 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F051" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_document_id !== sampleInput.document_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F051_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
