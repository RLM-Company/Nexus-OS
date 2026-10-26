/**
 * F171 (stage6-sovereign-cluster): Ранжирование сегментов контекста по информационной значимости
 * Приоритизация системных инструкций, свежих сообщений и высокорелевантных фактов перед упаковкой промпта
 * Operation Code: semantic_salience_segment_ranker
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

export const F171_FEATURE_ID = "F171" as const;
export const F171_STAGE = "stage6-sovereign-cluster" as const;
export const F171_OPERATION_CODE = "semantic_salience_segment_ranker" as const;
export const F171_CONTRACT_VERSION = "2.0.0" as const;

export type F171SemanticSalienceSegmentRankerExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export type F171SemanticSalienceSegmentRankerConfig = BaseFeatureConfig<
  typeof F171_FEATURE_ID,
  typeof F171_STAGE,
  typeof F171_OPERATION_CODE
>;

export interface F171SemanticSalienceSegmentRankerInput extends BaseFeatureInput {
  readonly total_segments: string;
  readonly retained_segments: string | number;
  readonly dropped_segments: string | number | boolean | readonly string[];
  readonly top_salience_score: string | number | boolean | Record<string, unknown>;
}

export type F171SemanticSalienceSegmentRankerAuditEntry = BaseFeatureAuditEntry<typeof F171_FEATURE_ID>;

export interface F171SemanticSalienceSegmentRankerOutput {
  readonly featureId: typeof F171_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F171SemanticSalienceSegmentRankerExecutionStatus;
  readonly operationCode: typeof F171_OPERATION_CODE;
  readonly resolved_total_segments: string;
  readonly resolved_retained_segments: string | number;
  readonly resolved_dropped_segments: string | number | boolean | readonly string[];
  readonly resolved_top_salience_score: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F171SemanticSalienceSegmentRankerAuditEntry;
}

export type F171SemanticSalienceSegmentRankerTelemetrySnapshot = BaseFeatureTelemetry<typeof F171_FEATURE_ID>;

export const DEFAULT_F171_CONFIG: F171SemanticSalienceSegmentRankerConfig = {
  featureId: F171_FEATURE_ID,
  stage: F171_STAGE,
  operationCode: F171_OPERATION_CODE,
  contractVersion: F171_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F171SemanticSalienceSegmentRankerValidationError extends Error {
  public readonly featureId = F171_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F171 Validation Error on '${field}']: ${message}`);
    this.name = "F171SemanticSalienceSegmentRankerValidationError";
    this.field = field;
  }
}

export function computeF171Digest(rawPayload: string): string {
  return `f171_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F171SemanticSalienceSegmentRankerEngine extends KosmoraFeatureAdapterBase<
  typeof F171_FEATURE_ID,
  typeof F171_STAGE,
  typeof F171_OPERATION_CODE,
  F171SemanticSalienceSegmentRankerConfig,
  F171SemanticSalienceSegmentRankerInput,
  F171SemanticSalienceSegmentRankerOutput
> {
  constructor(customConfig?: Partial<F171SemanticSalienceSegmentRankerConfig>, kernel?: Stage6SovereignKernel) {
    super(
      DEFAULT_F171_CONFIG,
      customConfig,
      kernel ?? new Stage6SovereignKernel(),
      ["total_segments", "retained_segments", "dropped_segments", "top_salience_score"] as const,
      F171SemanticSalienceSegmentRankerValidationError
    );
  }
}

export function verifyF171Module(): {
  featureId: typeof F171_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F171SemanticSalienceSegmentRankerEngine();
  const sampleInput: F171SemanticSalienceSegmentRankerInput = {
    requestId: "req_verify_f171",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    total_segments: "f171_total_segments_seed",
    retained_segments: 42,
    dropped_segments: true,
    top_salience_score: "verified_seed",
    metadata: { stage: "stage6-sovereign-cluster", featureNumber: 171 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F171" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_total_segments !== sampleInput.total_segments &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F171_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
