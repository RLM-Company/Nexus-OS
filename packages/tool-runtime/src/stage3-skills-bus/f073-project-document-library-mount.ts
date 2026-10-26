/**
 * F073 (stage3-skills-bus): Интеграция с библиотекой документов проекта
 * Прямое монтирование папок хранилища в зону видимости агентов
 * Operation Code: storage_folder_mounter
 */

import { createHash } from "node:crypto";
import {
  Stage3SkillsKernel,
  KosmoraFeatureAdapterBase,
  type BaseFeatureAuditEntry,
  type BaseFeatureConfig,
  type BaseFeatureInput,
  type BaseFeatureTelemetry,
  type StageKernelExecutionResult
} from "./stage-kernel.js";

export const F073_FEATURE_ID = "F073" as const;
export const F073_STAGE = "stage3-skills-bus" as const;
export const F073_OPERATION_CODE = "storage_folder_mounter" as const;
export const F073_CONTRACT_VERSION = "2.0.0" as const;

export type F073ProjectDocumentLibraryMountExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export type F073ProjectDocumentLibraryMountConfig = BaseFeatureConfig<
  typeof F073_FEATURE_ID,
  typeof F073_STAGE,
  typeof F073_OPERATION_CODE
>;

export interface F073ProjectDocumentLibraryMountInput extends BaseFeatureInput {
  readonly mount_id: string;
  readonly folder_path: string | number;
  readonly indexed_files_count: string | number | boolean | readonly string[];
  readonly read_only_guard: string | number | boolean | Record<string, unknown>;
}

export type F073ProjectDocumentLibraryMountAuditEntry = BaseFeatureAuditEntry<typeof F073_FEATURE_ID>;

export interface F073ProjectDocumentLibraryMountOutput {
  readonly featureId: typeof F073_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F073ProjectDocumentLibraryMountExecutionStatus;
  readonly operationCode: typeof F073_OPERATION_CODE;
  readonly resolved_mount_id: string;
  readonly resolved_folder_path: string | number;
  readonly resolved_indexed_files_count: string | number | boolean | readonly string[];
  readonly resolved_read_only_guard: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F073ProjectDocumentLibraryMountAuditEntry;
}

export type F073ProjectDocumentLibraryMountTelemetrySnapshot = BaseFeatureTelemetry<typeof F073_FEATURE_ID>;

export const DEFAULT_F073_CONFIG: F073ProjectDocumentLibraryMountConfig = {
  featureId: F073_FEATURE_ID,
  stage: F073_STAGE,
  operationCode: F073_OPERATION_CODE,
  contractVersion: F073_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F073ProjectDocumentLibraryMountValidationError extends Error {
  public readonly featureId = F073_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F073 Validation Error on '${field}']: ${message}`);
    this.name = "F073ProjectDocumentLibraryMountValidationError";
    this.field = field;
  }
}

export function computeF073Digest(rawPayload: string): string {
  return `f073_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F073ProjectDocumentLibraryMountEngine extends KosmoraFeatureAdapterBase<
  typeof F073_FEATURE_ID,
  typeof F073_STAGE,
  typeof F073_OPERATION_CODE,
  F073ProjectDocumentLibraryMountConfig,
  F073ProjectDocumentLibraryMountInput,
  F073ProjectDocumentLibraryMountOutput
> {
  constructor(customConfig?: Partial<F073ProjectDocumentLibraryMountConfig>, kernel?: Stage3SkillsKernel) {
    super(
      DEFAULT_F073_CONFIG,
      customConfig,
      kernel ?? new Stage3SkillsKernel(),
      ["mount_id", "folder_path", "indexed_files_count", "read_only_guard"] as const,
      F073ProjectDocumentLibraryMountValidationError
    );
  }
}

export function verifyF073Module(): {
  featureId: typeof F073_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F073ProjectDocumentLibraryMountEngine();
  const sampleInput: F073ProjectDocumentLibraryMountInput = {
    requestId: "req_verify_f073",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    mount_id: "f073_mount_id_seed",
    folder_path: 42,
    indexed_files_count: true,
    read_only_guard: "verified_seed",
    metadata: { stage: "stage3-skills-bus", featureNumber: 73 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F073" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_mount_id !== sampleInput.mount_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F073_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
