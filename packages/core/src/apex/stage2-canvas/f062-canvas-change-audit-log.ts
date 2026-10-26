/**
 * F062 (stage2-canvas): Журнал аудита изменений холста
 * Таймлайн того, какой агент или пользователь внёс правку и в какую секунду
 * Operation Code: canvas_audit_timeline
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

export const F062_FEATURE_ID = "F062" as const;
export const F062_STAGE = "stage2-canvas" as const;
export const F062_OPERATION_CODE = "canvas_audit_timeline" as const;
export const F062_CONTRACT_VERSION = "2.0.0" as const;

export type F062CanvasChangeAuditLogExecutionStatus =
  "idle" | "validating" | "executing" | "completed" | "degraded" | "cancelled" | "failed";

export type F062CanvasChangeAuditLogConfig = BaseFeatureConfig<
  typeof F062_FEATURE_ID,
  typeof F062_STAGE,
  typeof F062_OPERATION_CODE
>;

export interface F062CanvasChangeAuditLogInput extends BaseFeatureInput {
  readonly artifact_id: string;
  readonly audit_entries_count: string | number;
  readonly last_actor_id: string | number | boolean | readonly string[];
  readonly chronological_events: string | number | boolean | Record<string, unknown>;
}

export type F062CanvasChangeAuditLogAuditEntry = BaseFeatureAuditEntry<typeof F062_FEATURE_ID>;

export interface F062CanvasChangeAuditLogOutput {
  readonly featureId: typeof F062_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F062CanvasChangeAuditLogExecutionStatus;
  readonly operationCode: typeof F062_OPERATION_CODE;
  readonly resolved_artifact_id: string;
  readonly resolved_audit_entries_count: string | number;
  readonly resolved_last_actor_id: string | number | boolean | readonly string[];
  readonly resolved_chronological_events: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F062CanvasChangeAuditLogAuditEntry;
}

export type F062CanvasChangeAuditLogTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F062_FEATURE_ID
>;

export const DEFAULT_F062_CONFIG: F062CanvasChangeAuditLogConfig = {
  featureId: F062_FEATURE_ID,
  stage: F062_STAGE,
  operationCode: F062_OPERATION_CODE,
  contractVersion: F062_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F062CanvasChangeAuditLogValidationError extends Error {
  public readonly featureId = F062_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F062 Validation Error on '${field}']: ${message}`);
    this.name = "F062CanvasChangeAuditLogValidationError";
    this.field = field;
  }
}

export function computeF062Digest(rawPayload: string): string {
  return `f062_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F062CanvasChangeAuditLogEngine extends KosmoraFeatureAdapterBase<
  typeof F062_FEATURE_ID,
  typeof F062_STAGE,
  typeof F062_OPERATION_CODE,
  F062CanvasChangeAuditLogConfig,
  F062CanvasChangeAuditLogInput,
  F062CanvasChangeAuditLogOutput
> {
  constructor(customConfig?: Partial<F062CanvasChangeAuditLogConfig>, kernel?: Stage2CanvasKernel) {
    super(
      DEFAULT_F062_CONFIG,
      customConfig,
      kernel ?? new Stage2CanvasKernel(),
      ["artifact_id", "audit_entries_count", "last_actor_id", "chronological_events"] as const,
      F062CanvasChangeAuditLogValidationError
    );
  }
}

export function verifyF062Module(): {
  featureId: typeof F062_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F062CanvasChangeAuditLogEngine();
  const sampleInput: F062CanvasChangeAuditLogInput = {
    requestId: "req_verify_f062",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    artifact_id: "f062_artifact_id_seed",
    audit_entries_count: 42,
    last_actor_id: true,
    chronological_events: "verified_seed",
    metadata: { stage: "stage2-canvas", featureNumber: 62 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F062" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_artifact_id !== sampleInput.artifact_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F062_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
