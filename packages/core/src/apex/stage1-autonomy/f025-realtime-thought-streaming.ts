/**
 * F025 (stage1-autonomy): Стриминг промежуточных мыслей (Thought Streaming)
 * Трансляция лога рассуждений и шагов графа в UI в реальном времени
 * Operation Code: thought_streamer
 */

import { createHash } from "node:crypto";
import {
  Stage1AutonomyKernel,
  KosmoraFeatureAdapterBase,
  type BaseFeatureAuditEntry,
  type BaseFeatureConfig,
  type BaseFeatureInput,
  type BaseFeatureTelemetry,
  type StageKernelExecutionResult
} from "./stage-kernel.js";

export const F025_FEATURE_ID = "F025" as const;
export const F025_STAGE = "stage1-autonomy" as const;
export const F025_OPERATION_CODE = "thought_streamer" as const;
export const F025_CONTRACT_VERSION = "2.0.0" as const;

export type F025RealtimeThoughtStreamingExecutionStatus =
  "idle" | "validating" | "executing" | "completed" | "degraded" | "cancelled" | "failed";

export type F025RealtimeThoughtStreamingConfig = BaseFeatureConfig<
  typeof F025_FEATURE_ID,
  typeof F025_STAGE,
  typeof F025_OPERATION_CODE
>;

export interface F025RealtimeThoughtStreamingInput extends BaseFeatureInput {
  readonly stream_id: string;
  readonly task_id: string | number;
  readonly chunk_sequence: string | number | boolean | readonly string[];
  readonly formatted_thought: string | number | boolean | Record<string, unknown>;
}

export type F025RealtimeThoughtStreamingAuditEntry = BaseFeatureAuditEntry<typeof F025_FEATURE_ID>;

export interface F025RealtimeThoughtStreamingOutput {
  readonly featureId: typeof F025_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F025RealtimeThoughtStreamingExecutionStatus;
  readonly operationCode: typeof F025_OPERATION_CODE;
  readonly resolved_stream_id: string;
  readonly resolved_task_id: string | number;
  readonly resolved_chunk_sequence: string | number | boolean | readonly string[];
  readonly resolved_formatted_thought: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F025RealtimeThoughtStreamingAuditEntry;
}

export type F025RealtimeThoughtStreamingTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F025_FEATURE_ID
>;

export const DEFAULT_F025_CONFIG: F025RealtimeThoughtStreamingConfig = {
  featureId: F025_FEATURE_ID,
  stage: F025_STAGE,
  operationCode: F025_OPERATION_CODE,
  contractVersion: F025_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F025RealtimeThoughtStreamingValidationError extends Error {
  public readonly featureId = F025_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F025 Validation Error on '${field}']: ${message}`);
    this.name = "F025RealtimeThoughtStreamingValidationError";
    this.field = field;
  }
}

export function computeF025Digest(rawPayload: string): string {
  return `f025_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F025RealtimeThoughtStreamingEngine extends KosmoraFeatureAdapterBase<
  typeof F025_FEATURE_ID,
  typeof F025_STAGE,
  typeof F025_OPERATION_CODE,
  F025RealtimeThoughtStreamingConfig,
  F025RealtimeThoughtStreamingInput,
  F025RealtimeThoughtStreamingOutput
> {
  constructor(
    customConfig?: Partial<F025RealtimeThoughtStreamingConfig>,
    kernel?: Stage1AutonomyKernel
  ) {
    super(
      DEFAULT_F025_CONFIG,
      customConfig,
      kernel ?? new Stage1AutonomyKernel(),
      ["stream_id", "task_id", "chunk_sequence", "formatted_thought"] as const,
      F025RealtimeThoughtStreamingValidationError
    );
  }
}

export function verifyF025Module(): {
  featureId: typeof F025_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F025RealtimeThoughtStreamingEngine();
  const sampleInput: F025RealtimeThoughtStreamingInput = {
    requestId: "req_verify_f025",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    stream_id: "f025_stream_id_seed",
    task_id: 42,
    chunk_sequence: true,
    formatted_thought: "verified_seed",
    metadata: { stage: "stage1-autonomy", featureNumber: 25 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F025" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_stream_id !== sampleInput.stream_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F025_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
