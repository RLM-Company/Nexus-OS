/**
 * F110 (stage4-intelligence-graph): Кросс-документное связывание цитат
 * Обнаружение общих тем и противоречий между десятками разных PDF и таблиц в воркспейсе
 * Operation Code: cross_doc_correlator
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

export const F110_FEATURE_ID = "F110" as const;
export const F110_STAGE = "stage4-intelligence-graph" as const;
export const F110_OPERATION_CODE = "cross_doc_correlator" as const;
export const F110_CONTRACT_VERSION = "2.0.0" as const;

export type F110CrossDocumentCitationLinkerExecutionStatus =
  "idle" | "validating" | "executing" | "completed" | "degraded" | "cancelled" | "failed";

export type F110CrossDocumentCitationLinkerConfig = BaseFeatureConfig<
  typeof F110_FEATURE_ID,
  typeof F110_STAGE,
  typeof F110_OPERATION_CODE
>;

export interface F110CrossDocumentCitationLinkerInput extends BaseFeatureInput {
  readonly cluster_id: string;
  readonly corroborating_docs: string | number;
  readonly contradicting_pairs: string | number | boolean | readonly string[];
  readonly consensus_summary: string | number | boolean | Record<string, unknown>;
}

export type F110CrossDocumentCitationLinkerAuditEntry = BaseFeatureAuditEntry<
  typeof F110_FEATURE_ID
>;

export interface F110CrossDocumentCitationLinkerOutput {
  readonly featureId: typeof F110_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F110CrossDocumentCitationLinkerExecutionStatus;
  readonly operationCode: typeof F110_OPERATION_CODE;
  readonly resolved_cluster_id: string;
  readonly resolved_corroborating_docs: string | number;
  readonly resolved_contradicting_pairs: string | number | boolean | readonly string[];
  readonly resolved_consensus_summary: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F110CrossDocumentCitationLinkerAuditEntry;
}

export type F110CrossDocumentCitationLinkerTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F110_FEATURE_ID
>;

export const DEFAULT_F110_CONFIG: F110CrossDocumentCitationLinkerConfig = {
  featureId: F110_FEATURE_ID,
  stage: F110_STAGE,
  operationCode: F110_OPERATION_CODE,
  contractVersion: F110_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F110CrossDocumentCitationLinkerValidationError extends Error {
  public readonly featureId = F110_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F110 Validation Error on '${field}']: ${message}`);
    this.name = "F110CrossDocumentCitationLinkerValidationError";
    this.field = field;
  }
}

export function computeF110Digest(rawPayload: string): string {
  return `f110_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F110CrossDocumentCitationLinkerEngine extends KosmoraFeatureAdapterBase<
  typeof F110_FEATURE_ID,
  typeof F110_STAGE,
  typeof F110_OPERATION_CODE,
  F110CrossDocumentCitationLinkerConfig,
  F110CrossDocumentCitationLinkerInput,
  F110CrossDocumentCitationLinkerOutput
> {
  constructor(
    customConfig?: Partial<F110CrossDocumentCitationLinkerConfig>,
    kernel?: Stage4GraphKernel
  ) {
    super(
      DEFAULT_F110_CONFIG,
      customConfig,
      kernel ?? new Stage4GraphKernel(),
      ["cluster_id", "corroborating_docs", "contradicting_pairs", "consensus_summary"] as const,
      F110CrossDocumentCitationLinkerValidationError
    );
  }
}

export function verifyF110Module(): {
  featureId: typeof F110_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F110CrossDocumentCitationLinkerEngine();
  const sampleInput: F110CrossDocumentCitationLinkerInput = {
    requestId: "req_verify_f110",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    cluster_id: "f110_cluster_id_seed",
    corroborating_docs: 42,
    contradicting_pairs: true,
    consensus_summary: "verified_seed",
    metadata: { stage: "stage4-intelligence-graph", featureNumber: 110 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F110" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_cluster_id !== sampleInput.cluster_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F110_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
