/**
 * F112 (stage4-intelligence-graph): Оценка устаревания данных (Knowledge Decay Alert)
 * Маркировка узлов и отчётов, чьи исходные файлы были обновлены, как требующих пересборки
 * Operation Code: staleness_detector
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

export const F112_FEATURE_ID = "F112" as const;
export const F112_STAGE = "stage4-intelligence-graph" as const;
export const F112_OPERATION_CODE = "staleness_detector" as const;
export const F112_CONTRACT_VERSION = "2.0.0" as const;

export type F112KnowledgeDecayAlerterExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export type F112KnowledgeDecayAlerterConfig = BaseFeatureConfig<
  typeof F112_FEATURE_ID,
  typeof F112_STAGE,
  typeof F112_OPERATION_CODE
>;

export interface F112KnowledgeDecayAlerterInput extends BaseFeatureInput {
  readonly updated_source_id: string;
  readonly stale_artifact_ids: string | number;
  readonly decay_severity: string | number | boolean | readonly string[];
  readonly rebuild_queued: string | number | boolean | Record<string, unknown>;
}

export type F112KnowledgeDecayAlerterAuditEntry = BaseFeatureAuditEntry<typeof F112_FEATURE_ID>;

export interface F112KnowledgeDecayAlerterOutput {
  readonly featureId: typeof F112_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F112KnowledgeDecayAlerterExecutionStatus;
  readonly operationCode: typeof F112_OPERATION_CODE;
  readonly resolved_updated_source_id: string;
  readonly resolved_stale_artifact_ids: string | number;
  readonly resolved_decay_severity: string | number | boolean | readonly string[];
  readonly resolved_rebuild_queued: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F112KnowledgeDecayAlerterAuditEntry;
}

export type F112KnowledgeDecayAlerterTelemetrySnapshot = BaseFeatureTelemetry<typeof F112_FEATURE_ID>;

export const DEFAULT_F112_CONFIG: F112KnowledgeDecayAlerterConfig = {
  featureId: F112_FEATURE_ID,
  stage: F112_STAGE,
  operationCode: F112_OPERATION_CODE,
  contractVersion: F112_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F112KnowledgeDecayAlerterValidationError extends Error {
  public readonly featureId = F112_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F112 Validation Error on '${field}']: ${message}`);
    this.name = "F112KnowledgeDecayAlerterValidationError";
    this.field = field;
  }
}

export function computeF112Digest(rawPayload: string): string {
  return `f112_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F112KnowledgeDecayAlerterEngine extends KosmoraFeatureAdapterBase<
  typeof F112_FEATURE_ID,
  typeof F112_STAGE,
  typeof F112_OPERATION_CODE,
  F112KnowledgeDecayAlerterConfig,
  F112KnowledgeDecayAlerterInput,
  F112KnowledgeDecayAlerterOutput
> {
  constructor(customConfig?: Partial<F112KnowledgeDecayAlerterConfig>, kernel?: Stage4GraphKernel) {
    super(
      DEFAULT_F112_CONFIG,
      customConfig,
      kernel ?? new Stage4GraphKernel(),
      ["updated_source_id", "stale_artifact_ids", "decay_severity", "rebuild_queued"] as const,
      F112KnowledgeDecayAlerterValidationError
    );
  }
}

export function verifyF112Module(): {
  featureId: typeof F112_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F112KnowledgeDecayAlerterEngine();
  const sampleInput: F112KnowledgeDecayAlerterInput = {
    requestId: "req_verify_f112",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    updated_source_id: "f112_updated_source_id_seed",
    stale_artifact_ids: 42,
    decay_severity: true,
    rebuild_queued: "verified_seed",
    metadata: { stage: "stage4-intelligence-graph", featureNumber: 112 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F112" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_updated_source_id !== sampleInput.updated_source_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F112_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
