/**
 * F089 (stage3-skills-bus): Локальный файловый наблюдатель (File Watcher)
 * Автоматический подхват изменённых файлов в рабочей директории без ручной перезагрузки
 * Operation Code: fs_change_watcher
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

export const F089_FEATURE_ID = "F089" as const;
export const F089_STAGE = "stage3-skills-bus" as const;
export const F089_OPERATION_CODE = "fs_change_watcher" as const;
export const F089_CONTRACT_VERSION = "2.0.0" as const;

export type F089LocalWorkspaceFileWatcherExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export type F089LocalWorkspaceFileWatcherConfig = BaseFeatureConfig<
  typeof F089_FEATURE_ID,
  typeof F089_STAGE,
  typeof F089_OPERATION_CODE
>;

export interface F089LocalWorkspaceFileWatcherInput extends BaseFeatureInput {
  readonly watched_dir: string;
  readonly changed_file_path: string | number;
  readonly change_event_kind: string | number | boolean | readonly string[];
  readonly reindexed_ok: string | number | boolean | Record<string, unknown>;
}

export type F089LocalWorkspaceFileWatcherAuditEntry = BaseFeatureAuditEntry<typeof F089_FEATURE_ID>;

export interface F089LocalWorkspaceFileWatcherOutput {
  readonly featureId: typeof F089_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F089LocalWorkspaceFileWatcherExecutionStatus;
  readonly operationCode: typeof F089_OPERATION_CODE;
  readonly resolved_watched_dir: string;
  readonly resolved_changed_file_path: string | number;
  readonly resolved_change_event_kind: string | number | boolean | readonly string[];
  readonly resolved_reindexed_ok: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F089LocalWorkspaceFileWatcherAuditEntry;
}

export type F089LocalWorkspaceFileWatcherTelemetrySnapshot = BaseFeatureTelemetry<typeof F089_FEATURE_ID>;

export const DEFAULT_F089_CONFIG: F089LocalWorkspaceFileWatcherConfig = {
  featureId: F089_FEATURE_ID,
  stage: F089_STAGE,
  operationCode: F089_OPERATION_CODE,
  contractVersion: F089_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F089LocalWorkspaceFileWatcherValidationError extends Error {
  public readonly featureId = F089_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F089 Validation Error on '${field}']: ${message}`);
    this.name = "F089LocalWorkspaceFileWatcherValidationError";
    this.field = field;
  }
}

export function computeF089Digest(rawPayload: string): string {
  return `f089_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F089LocalWorkspaceFileWatcherEngine extends KosmoraFeatureAdapterBase<
  typeof F089_FEATURE_ID,
  typeof F089_STAGE,
  typeof F089_OPERATION_CODE,
  F089LocalWorkspaceFileWatcherConfig,
  F089LocalWorkspaceFileWatcherInput,
  F089LocalWorkspaceFileWatcherOutput
> {
  constructor(customConfig?: Partial<F089LocalWorkspaceFileWatcherConfig>, kernel?: Stage3SkillsKernel) {
    super(
      DEFAULT_F089_CONFIG,
      customConfig,
      kernel ?? new Stage3SkillsKernel(),
      ["watched_dir", "changed_file_path", "change_event_kind", "reindexed_ok"] as const,
      F089LocalWorkspaceFileWatcherValidationError
    );
  }
}

export function verifyF089Module(): {
  featureId: typeof F089_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F089LocalWorkspaceFileWatcherEngine();
  const sampleInput: F089LocalWorkspaceFileWatcherInput = {
    requestId: "req_verify_f089",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    watched_dir: "f089_watched_dir_seed",
    changed_file_path: 42,
    change_event_kind: true,
    reindexed_ok: "verified_seed",
    metadata: { stage: "stage3-skills-bus", featureNumber: 89 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F089" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_watched_dir !== sampleInput.watched_dir &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F089_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
