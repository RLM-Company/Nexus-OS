/**
 * F172 (stage6-sovereign-cluster): Скользящая компрессия старых реплик диалога
 * Вытеснение низкоприоритетных исторических сообщений при сохранении свежих реплик и фактов
 * Operation Code: sliding_window_episodic_summarizer
 */

import { createHash } from "node:crypto";
import {
  Stage6SovereignKernel,
  KosmoraFeatureAdapterBase,
  type BaseFeatureAuditEntry,
  type BaseFeatureConfig,
  type BaseFeatureInput,
  type BaseFeatureTelemetry,
  type StageKernelExecutionResult
} from "./stage-kernel.js";

export const F172_FEATURE_ID = "F172" as const;
export const F172_STAGE = "stage6-sovereign-cluster" as const;
export const F172_OPERATION_CODE = "sliding_window_episodic_summarizer" as const;
export const F172_CONTRACT_VERSION = "2.0.0" as const;

export type F172SlidingWindowEpisodicSummarizerExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export type F172SlidingWindowEpisodicSummarizerConfig = BaseFeatureConfig<
  typeof F172_FEATURE_ID,
  typeof F172_STAGE,
  typeof F172_OPERATION_CODE
>;

export interface F172SlidingWindowEpisodicSummarizerInput extends BaseFeatureInput {
  readonly window_token_limit: string;
  readonly tokens_before: string | number;
  readonly tokens_after: string | number | boolean | readonly string[];
  readonly evicted_segment_ids: string | number | boolean | Record<string, unknown>;
}

export type F172SlidingWindowEpisodicSummarizerAuditEntry = BaseFeatureAuditEntry<typeof F172_FEATURE_ID>;

export interface F172SlidingWindowEpisodicSummarizerOutput {
  readonly featureId: typeof F172_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F172SlidingWindowEpisodicSummarizerExecutionStatus;
  readonly operationCode: typeof F172_OPERATION_CODE;
  readonly resolved_window_token_limit: string;
  readonly resolved_tokens_before: string | number;
  readonly resolved_tokens_after: string | number | boolean | readonly string[];
  readonly resolved_evicted_segment_ids: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F172SlidingWindowEpisodicSummarizerAuditEntry;
}

export type F172SlidingWindowEpisodicSummarizerTelemetrySnapshot = BaseFeatureTelemetry<typeof F172_FEATURE_ID>;

export const DEFAULT_F172_CONFIG: F172SlidingWindowEpisodicSummarizerConfig = {
  featureId: F172_FEATURE_ID,
  stage: F172_STAGE,
  operationCode: F172_OPERATION_CODE,
  contractVersion: F172_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F172SlidingWindowEpisodicSummarizerValidationError extends Error {
  public readonly featureId = F172_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F172 Validation Error on '${field}']: ${message}`);
    this.name = "F172SlidingWindowEpisodicSummarizerValidationError";
    this.field = field;
  }
}

export function computeF172Digest(rawPayload: string): string {
  return `f172_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F172SlidingWindowEpisodicSummarizerEngine extends KosmoraFeatureAdapterBase<
  typeof F172_FEATURE_ID,
  typeof F172_STAGE,
  typeof F172_OPERATION_CODE,
  F172SlidingWindowEpisodicSummarizerConfig,
  F172SlidingWindowEpisodicSummarizerInput,
  F172SlidingWindowEpisodicSummarizerOutput
> {
  constructor(customConfig?: Partial<F172SlidingWindowEpisodicSummarizerConfig>, kernel?: Stage6SovereignKernel) {
    super(
      DEFAULT_F172_CONFIG,
      customConfig,
      kernel ?? new Stage6SovereignKernel(),
      ["window_token_limit", "tokens_before", "tokens_after", "evicted_segment_ids"] as const,
      F172SlidingWindowEpisodicSummarizerValidationError
    );
  }
}

export function verifyF172Module(): {
  featureId: typeof F172_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F172SlidingWindowEpisodicSummarizerEngine();
  const sampleInput: F172SlidingWindowEpisodicSummarizerInput = {
    requestId: "req_verify_f172",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    window_token_limit: "f172_window_token_limit_seed",
    tokens_before: 42,
    tokens_after: true,
    evicted_segment_ids: "verified_seed",
    metadata: { stage: "stage6-sovereign-cluster", featureNumber: 172 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F172" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_window_token_limit !== sampleInput.window_token_limit &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F172_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
