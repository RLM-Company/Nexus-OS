/**
 * F108 (stage4-intelligence-graph): Автоматическая суммаризация старых веток диалога
 * Фоновое сжатие длинных чатов в структурированные конспекты узлов памяти
 * Operation Code: dialogue_compactor
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

export const F108_FEATURE_ID = "F108" as const;
export const F108_STAGE = "stage4-intelligence-graph" as const;
export const F108_OPERATION_CODE = "dialogue_compactor" as const;
export const F108_CONTRACT_VERSION = "2.0.0" as const;

export type F108BackgroundDialogueSummarizerExecutionStatus =
  "idle" | "validating" | "executing" | "completed" | "degraded" | "cancelled" | "failed";

export type F108BackgroundDialogueSummarizerConfig = BaseFeatureConfig<
  typeof F108_FEATURE_ID,
  typeof F108_STAGE,
  typeof F108_OPERATION_CODE
>;

export interface F108BackgroundDialogueSummarizerInput extends BaseFeatureInput {
  readonly thread_id: string;
  readonly original_messages_count: string | number;
  readonly compressed_digest: string | number | boolean | readonly string[];
  readonly compression_ratio: string | number | boolean | Record<string, unknown>;
}

export type F108BackgroundDialogueSummarizerAuditEntry = BaseFeatureAuditEntry<
  typeof F108_FEATURE_ID
>;

export interface F108BackgroundDialogueSummarizerOutput {
  readonly featureId: typeof F108_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F108BackgroundDialogueSummarizerExecutionStatus;
  readonly operationCode: typeof F108_OPERATION_CODE;
  readonly resolved_thread_id: string;
  readonly resolved_original_messages_count: string | number;
  readonly resolved_compressed_digest: string | number | boolean | readonly string[];
  readonly resolved_compression_ratio: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F108BackgroundDialogueSummarizerAuditEntry;
}

export type F108BackgroundDialogueSummarizerTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F108_FEATURE_ID
>;

export const DEFAULT_F108_CONFIG: F108BackgroundDialogueSummarizerConfig = {
  featureId: F108_FEATURE_ID,
  stage: F108_STAGE,
  operationCode: F108_OPERATION_CODE,
  contractVersion: F108_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F108BackgroundDialogueSummarizerValidationError extends Error {
  public readonly featureId = F108_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F108 Validation Error on '${field}']: ${message}`);
    this.name = "F108BackgroundDialogueSummarizerValidationError";
    this.field = field;
  }
}

export function computeF108Digest(rawPayload: string): string {
  return `f108_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F108BackgroundDialogueSummarizerEngine extends KosmoraFeatureAdapterBase<
  typeof F108_FEATURE_ID,
  typeof F108_STAGE,
  typeof F108_OPERATION_CODE,
  F108BackgroundDialogueSummarizerConfig,
  F108BackgroundDialogueSummarizerInput,
  F108BackgroundDialogueSummarizerOutput
> {
  constructor(
    customConfig?: Partial<F108BackgroundDialogueSummarizerConfig>,
    kernel?: Stage4GraphKernel
  ) {
    super(
      DEFAULT_F108_CONFIG,
      customConfig,
      kernel ?? new Stage4GraphKernel(),
      ["thread_id", "original_messages_count", "compressed_digest", "compression_ratio"] as const,
      F108BackgroundDialogueSummarizerValidationError
    );
  }
}

export function verifyF108Module(): {
  featureId: typeof F108_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F108BackgroundDialogueSummarizerEngine();
  const sampleInput: F108BackgroundDialogueSummarizerInput = {
    requestId: "req_verify_f108",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    thread_id: "f108_thread_id_seed",
    original_messages_count: 42,
    compressed_digest: true,
    compression_ratio: "verified_seed",
    metadata: { stage: "stage4-intelligence-graph", featureNumber: 108 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F108" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_thread_id !== sampleInput.thread_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F108_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
