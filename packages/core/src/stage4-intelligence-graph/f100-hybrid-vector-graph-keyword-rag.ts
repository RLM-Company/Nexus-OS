/**
 * F100 (stage4-intelligence-graph): Гибридный поиск (Vector + Graph + Keyword RAG)
 * Комбинирование семантического поиска по эмбеддингам с обходом графа связей и точным совпадением слов
 * Operation Code: hybrid_rag_retriever
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

export const F100_FEATURE_ID = "F100" as const;
export const F100_STAGE = "stage4-intelligence-graph" as const;
export const F100_OPERATION_CODE = "hybrid_rag_retriever" as const;
export const F100_CONTRACT_VERSION = "2.0.0" as const;

export type F100HybridVectorGraphKeywordRagExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export type F100HybridVectorGraphKeywordRagConfig = BaseFeatureConfig<
  typeof F100_FEATURE_ID,
  typeof F100_STAGE,
  typeof F100_OPERATION_CODE
>;

export interface F100HybridVectorGraphKeywordRagInput extends BaseFeatureInput {
  readonly query_text: string;
  readonly vector_matches: string | number;
  readonly graph_hop_matches: string | number | boolean | readonly string[];
  readonly fused_ranking: string | number | boolean | Record<string, unknown>;
}

export type F100HybridVectorGraphKeywordRagAuditEntry = BaseFeatureAuditEntry<typeof F100_FEATURE_ID>;

export interface F100HybridVectorGraphKeywordRagOutput {
  readonly featureId: typeof F100_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F100HybridVectorGraphKeywordRagExecutionStatus;
  readonly operationCode: typeof F100_OPERATION_CODE;
  readonly resolved_query_text: string;
  readonly resolved_vector_matches: string | number;
  readonly resolved_graph_hop_matches: string | number | boolean | readonly string[];
  readonly resolved_fused_ranking: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F100HybridVectorGraphKeywordRagAuditEntry;
}

export type F100HybridVectorGraphKeywordRagTelemetrySnapshot = BaseFeatureTelemetry<typeof F100_FEATURE_ID>;

export const DEFAULT_F100_CONFIG: F100HybridVectorGraphKeywordRagConfig = {
  featureId: F100_FEATURE_ID,
  stage: F100_STAGE,
  operationCode: F100_OPERATION_CODE,
  contractVersion: F100_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F100HybridVectorGraphKeywordRagValidationError extends Error {
  public readonly featureId = F100_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F100 Validation Error on '${field}']: ${message}`);
    this.name = "F100HybridVectorGraphKeywordRagValidationError";
    this.field = field;
  }
}

export function computeF100Digest(rawPayload: string): string {
  return `f100_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F100HybridVectorGraphKeywordRagEngine extends KosmoraFeatureAdapterBase<
  typeof F100_FEATURE_ID,
  typeof F100_STAGE,
  typeof F100_OPERATION_CODE,
  F100HybridVectorGraphKeywordRagConfig,
  F100HybridVectorGraphKeywordRagInput,
  F100HybridVectorGraphKeywordRagOutput
> {
  constructor(customConfig?: Partial<F100HybridVectorGraphKeywordRagConfig>, kernel?: Stage4GraphKernel) {
    super(
      DEFAULT_F100_CONFIG,
      customConfig,
      kernel ?? new Stage4GraphKernel(),
      ["query_text", "vector_matches", "graph_hop_matches", "fused_ranking"] as const,
      F100HybridVectorGraphKeywordRagValidationError
    );
  }
}

export function verifyF100Module(): {
  featureId: typeof F100_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F100HybridVectorGraphKeywordRagEngine();
  const sampleInput: F100HybridVectorGraphKeywordRagInput = {
    requestId: "req_verify_f100",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    query_text: "f100_query_text_seed",
    vector_matches: 42,
    graph_hop_matches: true,
    fused_ranking: "verified_seed",
    metadata: { stage: "stage4-intelligence-graph", featureNumber: 100 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F100" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_query_text !== sampleInput.query_text &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F100_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
