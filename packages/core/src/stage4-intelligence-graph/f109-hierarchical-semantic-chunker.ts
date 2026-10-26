/**
 * F109 (stage4-intelligence-graph): Семантическое чанкование документов с сохранением иерархии
 * Нарезка файлов по смысловым блокам и главам, а не по слепому лимиту символов
 * Operation Code: semantic_tree_chunker
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

export const F109_FEATURE_ID = "F109" as const;
export const F109_STAGE = "stage4-intelligence-graph" as const;
export const F109_OPERATION_CODE = "semantic_tree_chunker" as const;
export const F109_CONTRACT_VERSION = "2.0.0" as const;

export type F109HierarchicalSemanticChunkerExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export type F109HierarchicalSemanticChunkerConfig = BaseFeatureConfig<
  typeof F109_FEATURE_ID,
  typeof F109_STAGE,
  typeof F109_OPERATION_CODE
>;

export interface F109HierarchicalSemanticChunkerInput extends BaseFeatureInput {
  readonly document_id: string;
  readonly chunks_created: string | number;
  readonly heading_breadcrumb_paths: string | number | boolean | readonly string[];
  readonly avg_chunk_tokens: string | number | boolean | Record<string, unknown>;
}

export type F109HierarchicalSemanticChunkerAuditEntry = BaseFeatureAuditEntry<typeof F109_FEATURE_ID>;

export interface F109HierarchicalSemanticChunkerOutput {
  readonly featureId: typeof F109_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F109HierarchicalSemanticChunkerExecutionStatus;
  readonly operationCode: typeof F109_OPERATION_CODE;
  readonly resolved_document_id: string;
  readonly resolved_chunks_created: string | number;
  readonly resolved_heading_breadcrumb_paths: string | number | boolean | readonly string[];
  readonly resolved_avg_chunk_tokens: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F109HierarchicalSemanticChunkerAuditEntry;
}

export type F109HierarchicalSemanticChunkerTelemetrySnapshot = BaseFeatureTelemetry<typeof F109_FEATURE_ID>;

export const DEFAULT_F109_CONFIG: F109HierarchicalSemanticChunkerConfig = {
  featureId: F109_FEATURE_ID,
  stage: F109_STAGE,
  operationCode: F109_OPERATION_CODE,
  contractVersion: F109_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F109HierarchicalSemanticChunkerValidationError extends Error {
  public readonly featureId = F109_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F109 Validation Error on '${field}']: ${message}`);
    this.name = "F109HierarchicalSemanticChunkerValidationError";
    this.field = field;
  }
}

export function computeF109Digest(rawPayload: string): string {
  return `f109_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F109HierarchicalSemanticChunkerEngine extends KosmoraFeatureAdapterBase<
  typeof F109_FEATURE_ID,
  typeof F109_STAGE,
  typeof F109_OPERATION_CODE,
  F109HierarchicalSemanticChunkerConfig,
  F109HierarchicalSemanticChunkerInput,
  F109HierarchicalSemanticChunkerOutput
> {
  constructor(customConfig?: Partial<F109HierarchicalSemanticChunkerConfig>, kernel?: Stage4GraphKernel) {
    super(
      DEFAULT_F109_CONFIG,
      customConfig,
      kernel ?? new Stage4GraphKernel(),
      ["document_id", "chunks_created", "heading_breadcrumb_paths", "avg_chunk_tokens"] as const,
      F109HierarchicalSemanticChunkerValidationError
    );
  }
}

export function verifyF109Module(): {
  featureId: typeof F109_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F109HierarchicalSemanticChunkerEngine();
  const sampleInput: F109HierarchicalSemanticChunkerInput = {
    requestId: "req_verify_f109",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    document_id: "f109_document_id_seed",
    chunks_created: 42,
    heading_breadcrumb_paths: true,
    avg_chunk_tokens: "verified_seed",
    metadata: { stage: "stage4-intelligence-graph", featureNumber: 109 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F109" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_document_id !== sampleInput.document_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F109_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
