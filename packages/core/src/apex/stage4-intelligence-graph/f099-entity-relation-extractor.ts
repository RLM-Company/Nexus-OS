/**
 * F099 (stage4-intelligence-graph): Автоматическое извлечение сущностей и связей (Entity & Relation Extraction)
 * Пополнение графа при загрузке любого нового файла или завершении диалога
 * Operation Code: ner_relation_miner
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

export const F099_FEATURE_ID = "F099" as const;
export const F099_STAGE = "stage4-intelligence-graph" as const;
export const F099_OPERATION_CODE = "ner_relation_miner" as const;
export const F099_CONTRACT_VERSION = "2.0.0" as const;

export type F099EntityRelationExtractorExecutionStatus =
  "idle" | "validating" | "executing" | "completed" | "degraded" | "cancelled" | "failed";

export type F099EntityRelationExtractorConfig = BaseFeatureConfig<
  typeof F099_FEATURE_ID,
  typeof F099_STAGE,
  typeof F099_OPERATION_CODE
>;

export interface F099EntityRelationExtractorInput extends BaseFeatureInput {
  readonly source_id: string;
  readonly extracted_entities: string | number;
  readonly extracted_relations: string | number | boolean | readonly string[];
  readonly graph_updated: string | number | boolean | Record<string, unknown>;
}

export type F099EntityRelationExtractorAuditEntry = BaseFeatureAuditEntry<typeof F099_FEATURE_ID>;

export interface F099EntityRelationExtractorOutput {
  readonly featureId: typeof F099_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F099EntityRelationExtractorExecutionStatus;
  readonly operationCode: typeof F099_OPERATION_CODE;
  readonly resolved_source_id: string;
  readonly resolved_extracted_entities: string | number;
  readonly resolved_extracted_relations: string | number | boolean | readonly string[];
  readonly resolved_graph_updated: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F099EntityRelationExtractorAuditEntry;
}

export type F099EntityRelationExtractorTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F099_FEATURE_ID
>;

export const DEFAULT_F099_CONFIG: F099EntityRelationExtractorConfig = {
  featureId: F099_FEATURE_ID,
  stage: F099_STAGE,
  operationCode: F099_OPERATION_CODE,
  contractVersion: F099_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F099EntityRelationExtractorValidationError extends Error {
  public readonly featureId = F099_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F099 Validation Error on '${field}']: ${message}`);
    this.name = "F099EntityRelationExtractorValidationError";
    this.field = field;
  }
}

export function computeF099Digest(rawPayload: string): string {
  return `f099_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F099EntityRelationExtractorEngine extends KosmoraFeatureAdapterBase<
  typeof F099_FEATURE_ID,
  typeof F099_STAGE,
  typeof F099_OPERATION_CODE,
  F099EntityRelationExtractorConfig,
  F099EntityRelationExtractorInput,
  F099EntityRelationExtractorOutput
> {
  constructor(
    customConfig?: Partial<F099EntityRelationExtractorConfig>,
    kernel?: Stage4GraphKernel
  ) {
    super(
      DEFAULT_F099_CONFIG,
      customConfig,
      kernel ?? new Stage4GraphKernel(),
      ["source_id", "extracted_entities", "extracted_relations", "graph_updated"] as const,
      F099EntityRelationExtractorValidationError
    );
  }
}

export function verifyF099Module(): {
  featureId: typeof F099_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F099EntityRelationExtractorEngine();
  const sampleInput: F099EntityRelationExtractorInput = {
    requestId: "req_verify_f099",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    source_id: "f099_source_id_seed",
    extracted_entities: 42,
    extracted_relations: true,
    graph_updated: "verified_seed",
    metadata: { stage: "stage4-intelligence-graph", featureNumber: 99 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F099" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_source_id !== sampleInput.source_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F099_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
