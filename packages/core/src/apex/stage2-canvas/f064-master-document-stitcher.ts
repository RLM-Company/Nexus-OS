/**
 * F064 (stage2-canvas): Сшивка нескольких артефактов в мастер-документ
 * Объединение разрозненных заметок, таблиц и графиков в единый финальный релиз
 * Operation Code: master_doc_stitcher
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

export const F064_FEATURE_ID = "F064" as const;
export const F064_STAGE = "stage2-canvas" as const;
export const F064_OPERATION_CODE = "master_doc_stitcher" as const;
export const F064_CONTRACT_VERSION = "2.0.0" as const;

export type F064MasterDocumentStitcherExecutionStatus =
  "idle" | "validating" | "executing" | "completed" | "degraded" | "cancelled" | "failed";

export type F064MasterDocumentStitcherConfig = BaseFeatureConfig<
  typeof F064_FEATURE_ID,
  typeof F064_STAGE,
  typeof F064_OPERATION_CODE
>;

export interface F064MasterDocumentStitcherInput extends BaseFeatureInput {
  readonly master_artifact_id: string;
  readonly source_tab_ids: string | number;
  readonly unified_toc: string | number | boolean | readonly string[];
  readonly compiled_markdown: string | number | boolean | Record<string, unknown>;
}

export type F064MasterDocumentStitcherAuditEntry = BaseFeatureAuditEntry<typeof F064_FEATURE_ID>;

export interface F064MasterDocumentStitcherOutput {
  readonly featureId: typeof F064_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F064MasterDocumentStitcherExecutionStatus;
  readonly operationCode: typeof F064_OPERATION_CODE;
  readonly resolved_master_artifact_id: string;
  readonly resolved_source_tab_ids: string | number;
  readonly resolved_unified_toc: string | number | boolean | readonly string[];
  readonly resolved_compiled_markdown: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F064MasterDocumentStitcherAuditEntry;
}

export type F064MasterDocumentStitcherTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F064_FEATURE_ID
>;

export const DEFAULT_F064_CONFIG: F064MasterDocumentStitcherConfig = {
  featureId: F064_FEATURE_ID,
  stage: F064_STAGE,
  operationCode: F064_OPERATION_CODE,
  contractVersion: F064_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F064MasterDocumentStitcherValidationError extends Error {
  public readonly featureId = F064_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F064 Validation Error on '${field}']: ${message}`);
    this.name = "F064MasterDocumentStitcherValidationError";
    this.field = field;
  }
}

export function computeF064Digest(rawPayload: string): string {
  return `f064_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F064MasterDocumentStitcherEngine extends KosmoraFeatureAdapterBase<
  typeof F064_FEATURE_ID,
  typeof F064_STAGE,
  typeof F064_OPERATION_CODE,
  F064MasterDocumentStitcherConfig,
  F064MasterDocumentStitcherInput,
  F064MasterDocumentStitcherOutput
> {
  constructor(
    customConfig?: Partial<F064MasterDocumentStitcherConfig>,
    kernel?: Stage2CanvasKernel
  ) {
    super(
      DEFAULT_F064_CONFIG,
      customConfig,
      kernel ?? new Stage2CanvasKernel(),
      ["master_artifact_id", "source_tab_ids", "unified_toc", "compiled_markdown"] as const,
      F064MasterDocumentStitcherValidationError
    );
  }
}

export function verifyF064Module(): {
  featureId: typeof F064_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F064MasterDocumentStitcherEngine();
  const sampleInput: F064MasterDocumentStitcherInput = {
    requestId: "req_verify_f064",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    master_artifact_id: "f064_master_artifact_id_seed",
    source_tab_ids: 42,
    unified_toc: true,
    compiled_markdown: "verified_seed",
    metadata: { stage: "stage2-canvas", featureNumber: 64 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F064" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_master_artifact_id !== sampleInput.master_artifact_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F064_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
