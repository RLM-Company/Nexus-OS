/**
 * F105 (stage4-intelligence-graph): Разрешение дубликатов сущностей (Entity Resolution)
 * Склейка разных упоминаний одного и того же проекта, человека или модуля в единый узел графа
 * Operation Code: entity_canonical_merger
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

export const F105_FEATURE_ID = "F105" as const;
export const F105_STAGE = "stage4-intelligence-graph" as const;
export const F105_OPERATION_CODE = "entity_canonical_merger" as const;
export const F105_CONTRACT_VERSION = "2.0.0" as const;

export type F105EntityDeduplicationResolverExecutionStatus =
  "idle" | "validating" | "executing" | "completed" | "degraded" | "cancelled" | "failed";

export type F105EntityDeduplicationResolverConfig = BaseFeatureConfig<
  typeof F105_FEATURE_ID,
  typeof F105_STAGE,
  typeof F105_OPERATION_CODE
>;

export interface F105EntityDeduplicationResolverInput extends BaseFeatureInput {
  readonly canonical_node_id: string;
  readonly merged_aliases: string | number;
  readonly duplicate_nodes_collapsed: string | number | boolean | readonly string[];
  readonly similarity_score: string | number | boolean | Record<string, unknown>;
}

export type F105EntityDeduplicationResolverAuditEntry = BaseFeatureAuditEntry<
  typeof F105_FEATURE_ID
>;

export interface F105EntityDeduplicationResolverOutput {
  readonly featureId: typeof F105_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F105EntityDeduplicationResolverExecutionStatus;
  readonly operationCode: typeof F105_OPERATION_CODE;
  readonly resolved_canonical_node_id: string;
  readonly resolved_merged_aliases: string | number;
  readonly resolved_duplicate_nodes_collapsed: string | number | boolean | readonly string[];
  readonly resolved_similarity_score: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F105EntityDeduplicationResolverAuditEntry;
}

export type F105EntityDeduplicationResolverTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F105_FEATURE_ID
>;

export const DEFAULT_F105_CONFIG: F105EntityDeduplicationResolverConfig = {
  featureId: F105_FEATURE_ID,
  stage: F105_STAGE,
  operationCode: F105_OPERATION_CODE,
  contractVersion: F105_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F105EntityDeduplicationResolverValidationError extends Error {
  public readonly featureId = F105_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F105 Validation Error on '${field}']: ${message}`);
    this.name = "F105EntityDeduplicationResolverValidationError";
    this.field = field;
  }
}

export function computeF105Digest(rawPayload: string): string {
  return `f105_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F105EntityDeduplicationResolverEngine extends KosmoraFeatureAdapterBase<
  typeof F105_FEATURE_ID,
  typeof F105_STAGE,
  typeof F105_OPERATION_CODE,
  F105EntityDeduplicationResolverConfig,
  F105EntityDeduplicationResolverInput,
  F105EntityDeduplicationResolverOutput
> {
  constructor(
    customConfig?: Partial<F105EntityDeduplicationResolverConfig>,
    kernel?: Stage4GraphKernel
  ) {
    super(
      DEFAULT_F105_CONFIG,
      customConfig,
      kernel ?? new Stage4GraphKernel(),
      [
        "canonical_node_id",
        "merged_aliases",
        "duplicate_nodes_collapsed",
        "similarity_score"
      ] as const,
      F105EntityDeduplicationResolverValidationError
    );
  }
}

export function verifyF105Module(): {
  featureId: typeof F105_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F105EntityDeduplicationResolverEngine();
  const sampleInput: F105EntityDeduplicationResolverInput = {
    requestId: "req_verify_f105",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    canonical_node_id: "f105_canonical_node_id_seed",
    merged_aliases: 42,
    duplicate_nodes_collapsed: true,
    similarity_score: "verified_seed",
    metadata: { stage: "stage4-intelligence-graph", featureNumber: 105 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F105" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_canonical_node_id !== sampleInput.canonical_node_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F105_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
