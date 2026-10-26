/**
 * F122 (stage4-intelligence-graph): Кэширование эмбеддингов с инкрементальным обновлением
 * Пересчёт векторов только для изменённых абзацев при редактировании файла
 * Operation Code: delta_embedding_cache
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

export const F122_FEATURE_ID = "F122" as const;
export const F122_STAGE = "stage4-intelligence-graph" as const;
export const F122_OPERATION_CODE = "delta_embedding_cache" as const;
export const F122_CONTRACT_VERSION = "2.0.0" as const;

export type F122IncrementalEmbeddingCacheExecutionStatus =
  "idle" | "validating" | "executing" | "completed" | "degraded" | "cancelled" | "failed";

export type F122IncrementalEmbeddingCacheConfig = BaseFeatureConfig<
  typeof F122_FEATURE_ID,
  typeof F122_STAGE,
  typeof F122_OPERATION_CODE
>;

export interface F122IncrementalEmbeddingCacheInput extends BaseFeatureInput {
  readonly document_id: string;
  readonly unchanged_paragraphs_cached: string | number;
  readonly recomputed_paragraphs: string | number | boolean | readonly string[];
  readonly compute_saved_pct: string | number | boolean | Record<string, unknown>;
}

export type F122IncrementalEmbeddingCacheAuditEntry = BaseFeatureAuditEntry<typeof F122_FEATURE_ID>;

export interface F122IncrementalEmbeddingCacheOutput {
  readonly featureId: typeof F122_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F122IncrementalEmbeddingCacheExecutionStatus;
  readonly operationCode: typeof F122_OPERATION_CODE;
  readonly resolved_document_id: string;
  readonly resolved_unchanged_paragraphs_cached: string | number;
  readonly resolved_recomputed_paragraphs: string | number | boolean | readonly string[];
  readonly resolved_compute_saved_pct: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F122IncrementalEmbeddingCacheAuditEntry;
}

export type F122IncrementalEmbeddingCacheTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F122_FEATURE_ID
>;

export const DEFAULT_F122_CONFIG: F122IncrementalEmbeddingCacheConfig = {
  featureId: F122_FEATURE_ID,
  stage: F122_STAGE,
  operationCode: F122_OPERATION_CODE,
  contractVersion: F122_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F122IncrementalEmbeddingCacheValidationError extends Error {
  public readonly featureId = F122_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F122 Validation Error on '${field}']: ${message}`);
    this.name = "F122IncrementalEmbeddingCacheValidationError";
    this.field = field;
  }
}

export function computeF122Digest(rawPayload: string): string {
  return `f122_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F122IncrementalEmbeddingCacheEngine extends KosmoraFeatureAdapterBase<
  typeof F122_FEATURE_ID,
  typeof F122_STAGE,
  typeof F122_OPERATION_CODE,
  F122IncrementalEmbeddingCacheConfig,
  F122IncrementalEmbeddingCacheInput,
  F122IncrementalEmbeddingCacheOutput
> {
  constructor(
    customConfig?: Partial<F122IncrementalEmbeddingCacheConfig>,
    kernel?: Stage4GraphKernel
  ) {
    super(
      DEFAULT_F122_CONFIG,
      customConfig,
      kernel ?? new Stage4GraphKernel(),
      [
        "document_id",
        "unchanged_paragraphs_cached",
        "recomputed_paragraphs",
        "compute_saved_pct"
      ] as const,
      F122IncrementalEmbeddingCacheValidationError
    );
  }
}

export function verifyF122Module(): {
  featureId: typeof F122_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F122IncrementalEmbeddingCacheEngine();
  const sampleInput: F122IncrementalEmbeddingCacheInput = {
    requestId: "req_verify_f122",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    document_id: "f122_document_id_seed",
    unchanged_paragraphs_cached: 42,
    recomputed_paragraphs: true,
    compute_saved_pct: "verified_seed",
    metadata: { stage: "stage4-intelligence-graph", featureNumber: 122 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F122" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_document_id !== sampleInput.document_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F122_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
