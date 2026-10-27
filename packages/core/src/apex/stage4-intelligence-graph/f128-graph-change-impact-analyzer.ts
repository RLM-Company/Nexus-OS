/**
 * F128 (stage4-intelligence-graph): Анализ влияния изменений (Impact Analysis on Graph)
 * Подсветка всех отчётов и задач, которые затронет изменение конкретного входного документа
 * Operation Code: blast_radius_analyzer
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

export const F128_FEATURE_ID = "F128" as const;
export const F128_STAGE = "stage4-intelligence-graph" as const;
export const F128_OPERATION_CODE = "blast_radius_analyzer" as const;
export const F128_CONTRACT_VERSION = "2.0.0" as const;

export type F128GraphChangeImpactAnalyzerExecutionStatus =
  "idle" | "validating" | "executing" | "completed" | "degraded" | "cancelled" | "failed";

export type F128GraphChangeImpactAnalyzerConfig = BaseFeatureConfig<
  typeof F128_FEATURE_ID,
  typeof F128_STAGE,
  typeof F128_OPERATION_CODE
>;

export interface F128GraphChangeImpactAnalyzerInput extends BaseFeatureInput {
  readonly modified_node_id: string;
  readonly affected_downstream_ids: string | number;
  readonly max_hop_distance: string | number | boolean | readonly string[];
  readonly risk_level: string | number | boolean | Record<string, unknown>;
}

export type F128GraphChangeImpactAnalyzerAuditEntry = BaseFeatureAuditEntry<typeof F128_FEATURE_ID>;

export interface F128GraphChangeImpactAnalyzerOutput {
  readonly featureId: typeof F128_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F128GraphChangeImpactAnalyzerExecutionStatus;
  readonly operationCode: typeof F128_OPERATION_CODE;
  readonly resolved_modified_node_id: string;
  readonly resolved_affected_downstream_ids: string | number;
  readonly resolved_max_hop_distance: string | number | boolean | readonly string[];
  readonly resolved_risk_level: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F128GraphChangeImpactAnalyzerAuditEntry;
}

export type F128GraphChangeImpactAnalyzerTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F128_FEATURE_ID
>;

export const DEFAULT_F128_CONFIG: F128GraphChangeImpactAnalyzerConfig = {
  featureId: F128_FEATURE_ID,
  stage: F128_STAGE,
  operationCode: F128_OPERATION_CODE,
  contractVersion: F128_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F128GraphChangeImpactAnalyzerValidationError extends Error {
  public readonly featureId = F128_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F128 Validation Error on '${field}']: ${message}`);
    this.name = "F128GraphChangeImpactAnalyzerValidationError";
    this.field = field;
  }
}

export function computeF128Digest(rawPayload: string): string {
  return `f128_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F128GraphChangeImpactAnalyzerEngine extends KosmoraFeatureAdapterBase<
  typeof F128_FEATURE_ID,
  typeof F128_STAGE,
  typeof F128_OPERATION_CODE,
  F128GraphChangeImpactAnalyzerConfig,
  F128GraphChangeImpactAnalyzerInput,
  F128GraphChangeImpactAnalyzerOutput
> {
  constructor(
    customConfig?: Partial<F128GraphChangeImpactAnalyzerConfig>,
    kernel?: Stage4GraphKernel
  ) {
    super(
      DEFAULT_F128_CONFIG,
      customConfig,
      kernel ?? new Stage4GraphKernel(),
      ["modified_node_id", "affected_downstream_ids", "max_hop_distance", "risk_level"] as const,
      F128GraphChangeImpactAnalyzerValidationError
    );
  }
}

export function verifyF128Module(): {
  featureId: typeof F128_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F128GraphChangeImpactAnalyzerEngine();
  const sampleInput: F128GraphChangeImpactAnalyzerInput = {
    requestId: "req_verify_f128",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    modified_node_id: "f128_modified_node_id_seed",
    affected_downstream_ids: 42,
    max_hop_distance: true,
    risk_level: "verified_seed",
    metadata: { stage: "stage4-intelligence-graph", featureNumber: 128 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F128" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_modified_node_id !== sampleInput.modified_node_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F128_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
