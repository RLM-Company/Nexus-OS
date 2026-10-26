/**
 * F103 (stage4-intelligence-graph): Краткосрочная память рабочей сессии (Working Memory Buffer)
 * Удержание фокуса на текущих переменных и открытых артефактах без размытия внимания
 * Operation Code: working_memory_ring
 */

import { createHash } from "node:crypto";
import {
  Stage4GraphKernel,
  KosmoraFeatureAdapterBase,
  type BaseFeatureAuditEntry,
  type BaseFeatureConfig,
  type BaseFeatureInput,
  type BaseFeatureTelemetry,
  type StageKernelExecutionResult
} from "./stage-kernel.js";

export const F103_FEATURE_ID = "F103" as const;
export const F103_STAGE = "stage4-intelligence-graph" as const;
export const F103_OPERATION_CODE = "working_memory_ring" as const;
export const F103_CONTRACT_VERSION = "2.0.0" as const;

export type F103WorkingMemorySessionBufferExecutionStatus =
  "idle" | "validating" | "executing" | "completed" | "degraded" | "cancelled" | "failed";

export type F103WorkingMemorySessionBufferConfig = BaseFeatureConfig<
  typeof F103_FEATURE_ID,
  typeof F103_STAGE,
  typeof F103_OPERATION_CODE
>;

export interface F103WorkingMemorySessionBufferInput extends BaseFeatureInput {
  readonly session_id: string;
  readonly active_slots_used: string | number;
  readonly focused_artifact_ids: string | number | boolean | readonly string[];
  readonly attention_score: string | number | boolean | Record<string, unknown>;
}

export type F103WorkingMemorySessionBufferAuditEntry = BaseFeatureAuditEntry<
  typeof F103_FEATURE_ID
>;

export interface F103WorkingMemorySessionBufferOutput {
  readonly featureId: typeof F103_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F103WorkingMemorySessionBufferExecutionStatus;
  readonly operationCode: typeof F103_OPERATION_CODE;
  readonly resolved_session_id: string;
  readonly resolved_active_slots_used: string | number;
  readonly resolved_focused_artifact_ids: string | number | boolean | readonly string[];
  readonly resolved_attention_score: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F103WorkingMemorySessionBufferAuditEntry;
}

export type F103WorkingMemorySessionBufferTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F103_FEATURE_ID
>;

export const DEFAULT_F103_CONFIG: F103WorkingMemorySessionBufferConfig = {
  featureId: F103_FEATURE_ID,
  stage: F103_STAGE,
  operationCode: F103_OPERATION_CODE,
  contractVersion: F103_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F103WorkingMemorySessionBufferValidationError extends Error {
  public readonly featureId = F103_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F103 Validation Error on '${field}']: ${message}`);
    this.name = "F103WorkingMemorySessionBufferValidationError";
    this.field = field;
  }
}

export function computeF103Digest(rawPayload: string): string {
  return `f103_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F103WorkingMemorySessionBufferEngine extends KosmoraFeatureAdapterBase<
  typeof F103_FEATURE_ID,
  typeof F103_STAGE,
  typeof F103_OPERATION_CODE,
  F103WorkingMemorySessionBufferConfig,
  F103WorkingMemorySessionBufferInput,
  F103WorkingMemorySessionBufferOutput
> {
  constructor(
    customConfig?: Partial<F103WorkingMemorySessionBufferConfig>,
    kernel?: Stage4GraphKernel
  ) {
    super(
      DEFAULT_F103_CONFIG,
      customConfig,
      kernel ?? new Stage4GraphKernel(),
      ["session_id", "active_slots_used", "focused_artifact_ids", "attention_score"] as const,
      F103WorkingMemorySessionBufferValidationError
    );
  }
}

export function verifyF103Module(): {
  featureId: typeof F103_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F103WorkingMemorySessionBufferEngine();
  const sampleInput: F103WorkingMemorySessionBufferInput = {
    requestId: "req_verify_f103",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    session_id: "f103_session_id_seed",
    active_slots_used: 42,
    focused_artifact_ids: true,
    attention_score: "verified_seed",
    metadata: { stage: "stage4-intelligence-graph", featureNumber: 103 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F103" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_session_id !== sampleInput.session_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F103_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
