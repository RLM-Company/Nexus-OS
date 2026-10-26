/**
 * F118 (stage4-intelligence-graph): Тегирование и пользовательские метаданные узлов
 * Ручная и автоматическая разметка документов и артефактов статусами
 * Operation Code: node_metadata_tagger
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

export const F118_FEATURE_ID = "F118" as const;
export const F118_STAGE = "stage4-intelligence-graph" as const;
export const F118_OPERATION_CODE = "node_metadata_tagger" as const;
export const F118_CONTRACT_VERSION = "2.0.0" as const;

export type F118NodeTaggingCustomMetadataExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export type F118NodeTaggingCustomMetadataConfig = BaseFeatureConfig<
  typeof F118_FEATURE_ID,
  typeof F118_STAGE,
  typeof F118_OPERATION_CODE
>;

export interface F118NodeTaggingCustomMetadataInput extends BaseFeatureInput {
  readonly node_id: string;
  readonly applied_tags: string | number;
  readonly custom_attributes: string | number | boolean | readonly string[];
  readonly indexed_for_filter: string | number | boolean | Record<string, unknown>;
}

export type F118NodeTaggingCustomMetadataAuditEntry = BaseFeatureAuditEntry<typeof F118_FEATURE_ID>;

export interface F118NodeTaggingCustomMetadataOutput {
  readonly featureId: typeof F118_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F118NodeTaggingCustomMetadataExecutionStatus;
  readonly operationCode: typeof F118_OPERATION_CODE;
  readonly resolved_node_id: string;
  readonly resolved_applied_tags: string | number;
  readonly resolved_custom_attributes: string | number | boolean | readonly string[];
  readonly resolved_indexed_for_filter: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F118NodeTaggingCustomMetadataAuditEntry;
}

export type F118NodeTaggingCustomMetadataTelemetrySnapshot = BaseFeatureTelemetry<typeof F118_FEATURE_ID>;

export const DEFAULT_F118_CONFIG: F118NodeTaggingCustomMetadataConfig = {
  featureId: F118_FEATURE_ID,
  stage: F118_STAGE,
  operationCode: F118_OPERATION_CODE,
  contractVersion: F118_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F118NodeTaggingCustomMetadataValidationError extends Error {
  public readonly featureId = F118_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F118 Validation Error on '${field}']: ${message}`);
    this.name = "F118NodeTaggingCustomMetadataValidationError";
    this.field = field;
  }
}

export function computeF118Digest(rawPayload: string): string {
  return `f118_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F118NodeTaggingCustomMetadataEngine extends KosmoraFeatureAdapterBase<
  typeof F118_FEATURE_ID,
  typeof F118_STAGE,
  typeof F118_OPERATION_CODE,
  F118NodeTaggingCustomMetadataConfig,
  F118NodeTaggingCustomMetadataInput,
  F118NodeTaggingCustomMetadataOutput
> {
  constructor(customConfig?: Partial<F118NodeTaggingCustomMetadataConfig>, kernel?: Stage4GraphKernel) {
    super(
      DEFAULT_F118_CONFIG,
      customConfig,
      kernel ?? new Stage4GraphKernel(),
      ["node_id", "applied_tags", "custom_attributes", "indexed_for_filter"] as const,
      F118NodeTaggingCustomMetadataValidationError
    );
  }
}

export function verifyF118Module(): {
  featureId: typeof F118_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F118NodeTaggingCustomMetadataEngine();
  const sampleInput: F118NodeTaggingCustomMetadataInput = {
    requestId: "req_verify_f118",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    node_id: "f118_node_id_seed",
    applied_tags: 42,
    custom_attributes: true,
    indexed_for_filter: "verified_seed",
    metadata: { stage: "stage4-intelligence-graph", featureNumber: 118 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F118" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_node_id !== sampleInput.node_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F118_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
