/**
 * F050 (stage2-canvas): Двусторонняя синхронизация правок
 * Учёт ручных исправлений пользователя на Canvas в памяти агента при следующих сообщениях в чате
 * Operation Code: bidirectional_edit_sync
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

export const F050_FEATURE_ID = "F050" as const;
export const F050_STAGE = "stage2-canvas" as const;
export const F050_OPERATION_CODE = "bidirectional_edit_sync" as const;
export const F050_CONTRACT_VERSION = "2.0.0" as const;

export type F050TwoWayManualEditSyncExecutionStatus =
  "idle" | "validating" | "executing" | "completed" | "degraded" | "cancelled" | "failed";

export type F050TwoWayManualEditSyncConfig = BaseFeatureConfig<
  typeof F050_FEATURE_ID,
  typeof F050_STAGE,
  typeof F050_OPERATION_CODE
>;

export interface F050TwoWayManualEditSyncInput extends BaseFeatureInput {
  readonly artifact_id: string;
  readonly user_diff_patch: string | number;
  readonly agent_memory_updated: string | number | boolean | readonly string[];
  readonly sync_version: string | number | boolean | Record<string, unknown>;
}

export type F050TwoWayManualEditSyncAuditEntry = BaseFeatureAuditEntry<typeof F050_FEATURE_ID>;

export interface F050TwoWayManualEditSyncOutput {
  readonly featureId: typeof F050_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F050TwoWayManualEditSyncExecutionStatus;
  readonly operationCode: typeof F050_OPERATION_CODE;
  readonly resolved_artifact_id: string;
  readonly resolved_user_diff_patch: string | number;
  readonly resolved_agent_memory_updated: string | number | boolean | readonly string[];
  readonly resolved_sync_version: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F050TwoWayManualEditSyncAuditEntry;
}

export type F050TwoWayManualEditSyncTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F050_FEATURE_ID
>;

export const DEFAULT_F050_CONFIG: F050TwoWayManualEditSyncConfig = {
  featureId: F050_FEATURE_ID,
  stage: F050_STAGE,
  operationCode: F050_OPERATION_CODE,
  contractVersion: F050_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F050TwoWayManualEditSyncValidationError extends Error {
  public readonly featureId = F050_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F050 Validation Error on '${field}']: ${message}`);
    this.name = "F050TwoWayManualEditSyncValidationError";
    this.field = field;
  }
}

export function computeF050Digest(rawPayload: string): string {
  return `f050_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F050TwoWayManualEditSyncEngine extends KosmoraFeatureAdapterBase<
  typeof F050_FEATURE_ID,
  typeof F050_STAGE,
  typeof F050_OPERATION_CODE,
  F050TwoWayManualEditSyncConfig,
  F050TwoWayManualEditSyncInput,
  F050TwoWayManualEditSyncOutput
> {
  constructor(customConfig?: Partial<F050TwoWayManualEditSyncConfig>, kernel?: Stage2CanvasKernel) {
    super(
      DEFAULT_F050_CONFIG,
      customConfig,
      kernel ?? new Stage2CanvasKernel(),
      ["artifact_id", "user_diff_patch", "agent_memory_updated", "sync_version"] as const,
      F050TwoWayManualEditSyncValidationError
    );
  }
}

export function verifyF050Module(): {
  featureId: typeof F050_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F050TwoWayManualEditSyncEngine();
  const sampleInput: F050TwoWayManualEditSyncInput = {
    requestId: "req_verify_f050",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    artifact_id: "f050_artifact_id_seed",
    user_diff_patch: 42,
    agent_memory_updated: true,
    sync_version: "verified_seed",
    metadata: { stage: "stage2-canvas", featureNumber: 50 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F050" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_artifact_id !== sampleInput.artifact_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F050_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
