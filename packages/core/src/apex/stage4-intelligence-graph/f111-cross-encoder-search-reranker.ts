/**
 * F111 (stage4-intelligence-graph): Переранжирование результатов поиска (Cross-Encoder Reranking)
 * Отсев нерелевантных чанков перед подачей в контекстное окно модели
 * Operation Code: cross_encoder_reranker
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

export const F111_FEATURE_ID = "F111" as const;
export const F111_STAGE = "stage4-intelligence-graph" as const;
export const F111_OPERATION_CODE = "cross_encoder_reranker" as const;
export const F111_CONTRACT_VERSION = "2.0.0" as const;

export type F111CrossEncoderSearchRerankerExecutionStatus =
  "idle" | "validating" | "executing" | "completed" | "degraded" | "cancelled" | "failed";

export type F111CrossEncoderSearchRerankerConfig = BaseFeatureConfig<
  typeof F111_FEATURE_ID,
  typeof F111_STAGE,
  typeof F111_OPERATION_CODE
>;

export interface F111CrossEncoderSearchRerankerInput extends BaseFeatureInput {
  readonly query_id: string;
  readonly initial_candidates: string | number;
  readonly reranked_top_k: string | number | boolean | readonly string[];
  readonly precision_gain: string | number | boolean | Record<string, unknown>;
}

export type F111CrossEncoderSearchRerankerAuditEntry = BaseFeatureAuditEntry<
  typeof F111_FEATURE_ID
>;

export interface F111CrossEncoderSearchRerankerOutput {
  readonly featureId: typeof F111_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F111CrossEncoderSearchRerankerExecutionStatus;
  readonly operationCode: typeof F111_OPERATION_CODE;
  readonly resolved_query_id: string;
  readonly resolved_initial_candidates: string | number;
  readonly resolved_reranked_top_k: string | number | boolean | readonly string[];
  readonly resolved_precision_gain: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F111CrossEncoderSearchRerankerAuditEntry;
}

export type F111CrossEncoderSearchRerankerTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F111_FEATURE_ID
>;

export const DEFAULT_F111_CONFIG: F111CrossEncoderSearchRerankerConfig = {
  featureId: F111_FEATURE_ID,
  stage: F111_STAGE,
  operationCode: F111_OPERATION_CODE,
  contractVersion: F111_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F111CrossEncoderSearchRerankerValidationError extends Error {
  public readonly featureId = F111_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F111 Validation Error on '${field}']: ${message}`);
    this.name = "F111CrossEncoderSearchRerankerValidationError";
    this.field = field;
  }
}

export function computeF111Digest(rawPayload: string): string {
  return `f111_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F111CrossEncoderSearchRerankerEngine extends KosmoraFeatureAdapterBase<
  typeof F111_FEATURE_ID,
  typeof F111_STAGE,
  typeof F111_OPERATION_CODE,
  F111CrossEncoderSearchRerankerConfig,
  F111CrossEncoderSearchRerankerInput,
  F111CrossEncoderSearchRerankerOutput
> {
  constructor(
    customConfig?: Partial<F111CrossEncoderSearchRerankerConfig>,
    kernel?: Stage4GraphKernel
  ) {
    super(
      DEFAULT_F111_CONFIG,
      customConfig,
      kernel ?? new Stage4GraphKernel(),
      ["query_id", "initial_candidates", "reranked_top_k", "precision_gain"] as const,
      F111CrossEncoderSearchRerankerValidationError
    );
  }
}

export function verifyF111Module(): {
  featureId: typeof F111_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F111CrossEncoderSearchRerankerEngine();
  const sampleInput: F111CrossEncoderSearchRerankerInput = {
    requestId: "req_verify_f111",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    query_id: "f111_query_id_seed",
    initial_candidates: 42,
    reranked_top_k: true,
    precision_gain: "verified_seed",
    metadata: { stage: "stage4-intelligence-graph", featureNumber: 111 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F111" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_query_id !== sampleInput.query_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F111_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
