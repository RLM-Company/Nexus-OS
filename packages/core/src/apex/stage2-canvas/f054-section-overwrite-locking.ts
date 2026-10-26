/**
 * F054 (stage2-canvas): Блокировка секций от перезаписи (Section Locking)
 * Заморозка утверждённых абзацев, чтобы агент не менял их при глобальном рефакторинге
 * Operation Code: section_lock_guard
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

export const F054_FEATURE_ID = "F054" as const;
export const F054_STAGE = "stage2-canvas" as const;
export const F054_OPERATION_CODE = "section_lock_guard" as const;
export const F054_CONTRACT_VERSION = "2.0.0" as const;

export type F054SectionOverwriteLockingExecutionStatus =
  "idle" | "validating" | "executing" | "completed" | "degraded" | "cancelled" | "failed";

export type F054SectionOverwriteLockingConfig = BaseFeatureConfig<
  typeof F054_FEATURE_ID,
  typeof F054_STAGE,
  typeof F054_OPERATION_CODE
>;

export interface F054SectionOverwriteLockingInput extends BaseFeatureInput {
  readonly artifact_id: string;
  readonly locked_section_ids: string | number;
  readonly write_attempt_blocked: string | number | boolean | readonly string[];
  readonly owner_lock_token: string | number | boolean | Record<string, unknown>;
}

export type F054SectionOverwriteLockingAuditEntry = BaseFeatureAuditEntry<typeof F054_FEATURE_ID>;

export interface F054SectionOverwriteLockingOutput {
  readonly featureId: typeof F054_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F054SectionOverwriteLockingExecutionStatus;
  readonly operationCode: typeof F054_OPERATION_CODE;
  readonly resolved_artifact_id: string;
  readonly resolved_locked_section_ids: string | number;
  readonly resolved_write_attempt_blocked: string | number | boolean | readonly string[];
  readonly resolved_owner_lock_token: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F054SectionOverwriteLockingAuditEntry;
}

export type F054SectionOverwriteLockingTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F054_FEATURE_ID
>;

export const DEFAULT_F054_CONFIG: F054SectionOverwriteLockingConfig = {
  featureId: F054_FEATURE_ID,
  stage: F054_STAGE,
  operationCode: F054_OPERATION_CODE,
  contractVersion: F054_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F054SectionOverwriteLockingValidationError extends Error {
  public readonly featureId = F054_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F054 Validation Error on '${field}']: ${message}`);
    this.name = "F054SectionOverwriteLockingValidationError";
    this.field = field;
  }
}

export function computeF054Digest(rawPayload: string): string {
  return `f054_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F054SectionOverwriteLockingEngine extends KosmoraFeatureAdapterBase<
  typeof F054_FEATURE_ID,
  typeof F054_STAGE,
  typeof F054_OPERATION_CODE,
  F054SectionOverwriteLockingConfig,
  F054SectionOverwriteLockingInput,
  F054SectionOverwriteLockingOutput
> {
  constructor(
    customConfig?: Partial<F054SectionOverwriteLockingConfig>,
    kernel?: Stage2CanvasKernel
  ) {
    super(
      DEFAULT_F054_CONFIG,
      customConfig,
      kernel ?? new Stage2CanvasKernel(),
      ["artifact_id", "locked_section_ids", "write_attempt_blocked", "owner_lock_token"] as const,
      F054SectionOverwriteLockingValidationError
    );
  }
}

export function verifyF054Module(): {
  featureId: typeof F054_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F054SectionOverwriteLockingEngine();
  const sampleInput: F054SectionOverwriteLockingInput = {
    requestId: "req_verify_f054",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    artifact_id: "f054_artifact_id_seed",
    locked_section_ids: 42,
    write_attempt_blocked: true,
    owner_lock_token: "verified_seed",
    metadata: { stage: "stage2-canvas", featureNumber: 54 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F054" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_artifact_id !== sampleInput.artifact_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F054_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
