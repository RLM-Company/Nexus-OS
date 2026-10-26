/**
 * F039 (stage2-canvas): Пакетная выгрузка для десктопа (Desktop / Archive Download)
 * Скачивание всего проекта, кода или пачки отчётов единым структурированным архивом
 * Operation Code: archive_bundler
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

export const F039_FEATURE_ID = "F039" as const;
export const F039_STAGE = "stage2-canvas" as const;
export const F039_OPERATION_CODE = "archive_bundler" as const;
export const F039_CONTRACT_VERSION = "2.0.0" as const;

export type F039DesktopArchiveBatchDownloadExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export type F039DesktopArchiveBatchDownloadConfig = BaseFeatureConfig<
  typeof F039_FEATURE_ID,
  typeof F039_STAGE,
  typeof F039_OPERATION_CODE
>;

export interface F039DesktopArchiveBatchDownloadInput extends BaseFeatureInput {
  readonly archive_id: string;
  readonly bundled_files_count: string | number;
  readonly compression_ratio: string | number | boolean | readonly string[];
  readonly checksum_sha256: string | number | boolean | Record<string, unknown>;
}

export type F039DesktopArchiveBatchDownloadAuditEntry = BaseFeatureAuditEntry<typeof F039_FEATURE_ID>;

export interface F039DesktopArchiveBatchDownloadOutput {
  readonly featureId: typeof F039_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F039DesktopArchiveBatchDownloadExecutionStatus;
  readonly operationCode: typeof F039_OPERATION_CODE;
  readonly resolved_archive_id: string;
  readonly resolved_bundled_files_count: string | number;
  readonly resolved_compression_ratio: string | number | boolean | readonly string[];
  readonly resolved_checksum_sha256: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F039DesktopArchiveBatchDownloadAuditEntry;
}

export type F039DesktopArchiveBatchDownloadTelemetrySnapshot = BaseFeatureTelemetry<typeof F039_FEATURE_ID>;

export const DEFAULT_F039_CONFIG: F039DesktopArchiveBatchDownloadConfig = {
  featureId: F039_FEATURE_ID,
  stage: F039_STAGE,
  operationCode: F039_OPERATION_CODE,
  contractVersion: F039_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F039DesktopArchiveBatchDownloadValidationError extends Error {
  public readonly featureId = F039_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F039 Validation Error on '${field}']: ${message}`);
    this.name = "F039DesktopArchiveBatchDownloadValidationError";
    this.field = field;
  }
}

export function computeF039Digest(rawPayload: string): string {
  return `f039_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F039DesktopArchiveBatchDownloadEngine extends KosmoraFeatureAdapterBase<
  typeof F039_FEATURE_ID,
  typeof F039_STAGE,
  typeof F039_OPERATION_CODE,
  F039DesktopArchiveBatchDownloadConfig,
  F039DesktopArchiveBatchDownloadInput,
  F039DesktopArchiveBatchDownloadOutput
> {
  constructor(customConfig?: Partial<F039DesktopArchiveBatchDownloadConfig>, kernel?: Stage2CanvasKernel) {
    super(
      DEFAULT_F039_CONFIG,
      customConfig,
      kernel ?? new Stage2CanvasKernel(),
      ["archive_id", "bundled_files_count", "compression_ratio", "checksum_sha256"] as const,
      F039DesktopArchiveBatchDownloadValidationError
    );
  }
}

export function verifyF039Module(): {
  featureId: typeof F039_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F039DesktopArchiveBatchDownloadEngine();
  const sampleInput: F039DesktopArchiveBatchDownloadInput = {
    requestId: "req_verify_f039",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    archive_id: "f039_archive_id_seed",
    bundled_files_count: 42,
    compression_ratio: true,
    checksum_sha256: "verified_seed",
    metadata: { stage: "stage2-canvas", featureNumber: 39 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F039" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_archive_id !== sampleInput.archive_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F039_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
