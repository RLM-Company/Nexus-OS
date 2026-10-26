/**
 * F106 (stage4-intelligence-graph): Временная шкала графа знаний (Temporal Graph Tracking)
 * Просмотр того, как менялись знания и факты по проекту во времени с поддержкой дат актуальности
 * Operation Code: bitemporal_fact_ledger
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

export const F106_FEATURE_ID = "F106" as const;
export const F106_STAGE = "stage4-intelligence-graph" as const;
export const F106_OPERATION_CODE = "bitemporal_fact_ledger" as const;
export const F106_CONTRACT_VERSION = "2.0.0" as const;

export type F106TemporalKnowledgeGraphTrackerExecutionStatus =
  "idle" | "validating" | "executing" | "completed" | "degraded" | "cancelled" | "failed";

export type F106TemporalKnowledgeGraphTrackerConfig = BaseFeatureConfig<
  typeof F106_FEATURE_ID,
  typeof F106_STAGE,
  typeof F106_OPERATION_CODE
>;

export interface F106TemporalKnowledgeGraphTrackerInput extends BaseFeatureInput {
  readonly node_id: string;
  readonly valid_from_iso: string | number;
  readonly valid_to_iso: string | number | boolean | readonly string[];
  readonly point_in_time_snapshot: string | number | boolean | Record<string, unknown>;
}

export type F106TemporalKnowledgeGraphTrackerAuditEntry = BaseFeatureAuditEntry<
  typeof F106_FEATURE_ID
>;

export interface F106TemporalKnowledgeGraphTrackerOutput {
  readonly featureId: typeof F106_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F106TemporalKnowledgeGraphTrackerExecutionStatus;
  readonly operationCode: typeof F106_OPERATION_CODE;
  readonly resolved_node_id: string;
  readonly resolved_valid_from_iso: string | number;
  readonly resolved_valid_to_iso: string | number | boolean | readonly string[];
  readonly resolved_point_in_time_snapshot: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F106TemporalKnowledgeGraphTrackerAuditEntry;
}

export type F106TemporalKnowledgeGraphTrackerTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F106_FEATURE_ID
>;

export const DEFAULT_F106_CONFIG: F106TemporalKnowledgeGraphTrackerConfig = {
  featureId: F106_FEATURE_ID,
  stage: F106_STAGE,
  operationCode: F106_OPERATION_CODE,
  contractVersion: F106_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F106TemporalKnowledgeGraphTrackerValidationError extends Error {
  public readonly featureId = F106_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F106 Validation Error on '${field}']: ${message}`);
    this.name = "F106TemporalKnowledgeGraphTrackerValidationError";
    this.field = field;
  }
}

export function computeF106Digest(rawPayload: string): string {
  return `f106_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F106TemporalKnowledgeGraphTrackerEngine extends KosmoraFeatureAdapterBase<
  typeof F106_FEATURE_ID,
  typeof F106_STAGE,
  typeof F106_OPERATION_CODE,
  F106TemporalKnowledgeGraphTrackerConfig,
  F106TemporalKnowledgeGraphTrackerInput,
  F106TemporalKnowledgeGraphTrackerOutput
> {
  constructor(
    customConfig?: Partial<F106TemporalKnowledgeGraphTrackerConfig>,
    kernel?: Stage4GraphKernel
  ) {
    super(
      DEFAULT_F106_CONFIG,
      customConfig,
      kernel ?? new Stage4GraphKernel(),
      ["node_id", "valid_from_iso", "valid_to_iso", "point_in_time_snapshot"] as const,
      F106TemporalKnowledgeGraphTrackerValidationError
    );
  }
}

export function verifyF106Module(): {
  featureId: typeof F106_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F106TemporalKnowledgeGraphTrackerEngine();
  const sampleInput: F106TemporalKnowledgeGraphTrackerInput = {
    requestId: "req_verify_f106",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    node_id: "f106_node_id_seed",
    valid_from_iso: 42,
    valid_to_iso: true,
    point_in_time_snapshot: "verified_seed",
    metadata: { stage: "stage4-intelligence-graph", featureNumber: 106 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F106" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_node_id !== sampleInput.node_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F106_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
