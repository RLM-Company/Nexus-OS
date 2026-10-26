/**
 * F034 (stage2-canvas): Версионируемые отчёты (Versioned Canvas Reports)
 * Система контроля версий (v1, v2, v3) для каждого документа на холсте
 * Operation Code: report_versioning
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

export const F034_FEATURE_ID = "F034" as const;
export const F034_STAGE = "stage2-canvas" as const;
export const F034_OPERATION_CODE = "report_versioning" as const;
export const F034_CONTRACT_VERSION = "2.0.0" as const;

export type F034VersionedCanvasReportsExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export type F034VersionedCanvasReportsConfig = BaseFeatureConfig<
  typeof F034_FEATURE_ID,
  typeof F034_STAGE,
  typeof F034_OPERATION_CODE
>;

export interface F034VersionedCanvasReportsInput extends BaseFeatureInput {
  readonly artifact_id: string;
  readonly version_tag: string | number;
  readonly parent_version: string | number | boolean | readonly string[];
  readonly immutable_content_hash: string | number | boolean | Record<string, unknown>;
}

export type F034VersionedCanvasReportsAuditEntry = BaseFeatureAuditEntry<typeof F034_FEATURE_ID>;

export interface F034VersionedCanvasReportsOutput {
  readonly featureId: typeof F034_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F034VersionedCanvasReportsExecutionStatus;
  readonly operationCode: typeof F034_OPERATION_CODE;
  readonly resolved_artifact_id: string;
  readonly resolved_version_tag: string | number;
  readonly resolved_parent_version: string | number | boolean | readonly string[];
  readonly resolved_immutable_content_hash: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F034VersionedCanvasReportsAuditEntry;
}

export type F034VersionedCanvasReportsTelemetrySnapshot = BaseFeatureTelemetry<typeof F034_FEATURE_ID>;

export const DEFAULT_F034_CONFIG: F034VersionedCanvasReportsConfig = {
  featureId: F034_FEATURE_ID,
  stage: F034_STAGE,
  operationCode: F034_OPERATION_CODE,
  contractVersion: F034_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F034VersionedCanvasReportsValidationError extends Error {
  public readonly featureId = F034_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F034 Validation Error on '${field}']: ${message}`);
    this.name = "F034VersionedCanvasReportsValidationError";
    this.field = field;
  }
}

export function computeF034Digest(rawPayload: string): string {
  return `f034_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F034VersionedCanvasReportsEngine extends KosmoraFeatureAdapterBase<
  typeof F034_FEATURE_ID,
  typeof F034_STAGE,
  typeof F034_OPERATION_CODE,
  F034VersionedCanvasReportsConfig,
  F034VersionedCanvasReportsInput,
  F034VersionedCanvasReportsOutput
> {
  constructor(customConfig?: Partial<F034VersionedCanvasReportsConfig>, kernel?: Stage2CanvasKernel) {
    super(
      DEFAULT_F034_CONFIG,
      customConfig,
      kernel ?? new Stage2CanvasKernel(),
      ["artifact_id", "version_tag", "parent_version", "immutable_content_hash"] as const,
      F034VersionedCanvasReportsValidationError
    );
  }
}

export function verifyF034Module(): {
  featureId: typeof F034_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F034VersionedCanvasReportsEngine();
  const sampleInput: F034VersionedCanvasReportsInput = {
    requestId: "req_verify_f034",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    artifact_id: "f034_artifact_id_seed",
    version_tag: 42,
    parent_version: true,
    immutable_content_hash: "verified_seed",
    metadata: { stage: "stage2-canvas", featureNumber: 34 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F034" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_artifact_id !== sampleInput.artifact_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F034_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
