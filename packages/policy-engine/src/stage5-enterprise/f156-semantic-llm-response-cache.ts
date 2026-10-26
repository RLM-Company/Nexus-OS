/**
 * F156 (stage5-enterprise): Кэширование идентичных LLM-запросов (Semantic Cache)
 * Мгновенный возврат ответа на типовые аналитические подзапросы без повторной оплаты токенов
 * Operation Code: semantic_vector_cache
 */

import { createHash } from "node:crypto";
import {
  Stage5EnterpriseKernel,
  KosmoraFeatureAdapterBase,
  type BaseFeatureAuditEntry,
  type BaseFeatureConfig,
  type BaseFeatureInput,
  type BaseFeatureTelemetry,
  type StageKernelExecutionResult
} from "./stage-kernel.js";

export const F156_FEATURE_ID = "F156" as const;
export const F156_STAGE = "stage5-enterprise" as const;
export const F156_OPERATION_CODE = "semantic_vector_cache" as const;
export const F156_CONTRACT_VERSION = "2.0.0" as const;

export type F156SemanticLlmResponseCacheExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export type F156SemanticLlmResponseCacheConfig = BaseFeatureConfig<
  typeof F156_FEATURE_ID,
  typeof F156_STAGE,
  typeof F156_OPERATION_CODE
>;

export interface F156SemanticLlmResponseCacheInput extends BaseFeatureInput {
  readonly query_fingerprint: string;
  readonly similarity_hit: string | number;
  readonly tokens_saved: string | number | boolean | readonly string[];
  readonly cached_completion: string | number | boolean | Record<string, unknown>;
}

export type F156SemanticLlmResponseCacheAuditEntry = BaseFeatureAuditEntry<typeof F156_FEATURE_ID>;

export interface F156SemanticLlmResponseCacheOutput {
  readonly featureId: typeof F156_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F156SemanticLlmResponseCacheExecutionStatus;
  readonly operationCode: typeof F156_OPERATION_CODE;
  readonly resolved_query_fingerprint: string;
  readonly resolved_similarity_hit: string | number;
  readonly resolved_tokens_saved: string | number | boolean | readonly string[];
  readonly resolved_cached_completion: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F156SemanticLlmResponseCacheAuditEntry;
}

export type F156SemanticLlmResponseCacheTelemetrySnapshot = BaseFeatureTelemetry<typeof F156_FEATURE_ID>;

export const DEFAULT_F156_CONFIG: F156SemanticLlmResponseCacheConfig = {
  featureId: F156_FEATURE_ID,
  stage: F156_STAGE,
  operationCode: F156_OPERATION_CODE,
  contractVersion: F156_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F156SemanticLlmResponseCacheValidationError extends Error {
  public readonly featureId = F156_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F156 Validation Error on '${field}']: ${message}`);
    this.name = "F156SemanticLlmResponseCacheValidationError";
    this.field = field;
  }
}

export function computeF156Digest(rawPayload: string): string {
  return `f156_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F156SemanticLlmResponseCacheEngine extends KosmoraFeatureAdapterBase<
  typeof F156_FEATURE_ID,
  typeof F156_STAGE,
  typeof F156_OPERATION_CODE,
  F156SemanticLlmResponseCacheConfig,
  F156SemanticLlmResponseCacheInput,
  F156SemanticLlmResponseCacheOutput
> {
  constructor(customConfig?: Partial<F156SemanticLlmResponseCacheConfig>, kernel?: Stage5EnterpriseKernel) {
    super(
      DEFAULT_F156_CONFIG,
      customConfig,
      kernel ?? new Stage5EnterpriseKernel(),
      ["query_fingerprint", "similarity_hit", "tokens_saved", "cached_completion"] as const,
      F156SemanticLlmResponseCacheValidationError
    );
  }
}

export function verifyF156Module(): {
  featureId: typeof F156_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F156SemanticLlmResponseCacheEngine();
  const sampleInput: F156SemanticLlmResponseCacheInput = {
    requestId: "req_verify_f156",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    query_fingerprint: "f156_query_fingerprint_seed",
    similarity_hit: 42,
    tokens_saved: true,
    cached_completion: "verified_seed",
    metadata: { stage: "stage5-enterprise", featureNumber: 156 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F156" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_query_fingerprint !== sampleInput.query_fingerprint &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F156_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
