/**
 * F170 (stage6-sovereign-cluster): Защита цитируемых источников при сжатии контекста
 * Гарантированное сохранение чанков с активными библиографическими ссылками при усечении промпта
 * Operation Code: citation_anchoring_context_guard
 */

import { createHash } from "node:crypto";
import {
  Stage6SovereignKernel,
  KosmoraFeatureAdapterBase,
  type BaseFeatureAuditEntry,
  type BaseFeatureConfig,
  type BaseFeatureInput,
  type BaseFeatureTelemetry,
  type StageKernelExecutionResult
} from "./stage-kernel.js";

export const F170_FEATURE_ID = "F170" as const;
export const F170_STAGE = "stage6-sovereign-cluster" as const;
export const F170_OPERATION_CODE = "citation_anchoring_context_guard" as const;
export const F170_CONTRACT_VERSION = "2.0.0" as const;

export type F170CitationAnchoringContextGuardExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export type F170CitationAnchoringContextGuardConfig = BaseFeatureConfig<
  typeof F170_FEATURE_ID,
  typeof F170_STAGE,
  typeof F170_OPERATION_CODE
>;

export interface F170CitationAnchoringContextGuardInput extends BaseFeatureInput {
  readonly preserved_citations_count: string;
  readonly pinned_segments_count: string | number;
  readonly budget_overflow_prevented: string | number | boolean | readonly string[];
  readonly compiled_digest: string | number | boolean | Record<string, unknown>;
}

export type F170CitationAnchoringContextGuardAuditEntry = BaseFeatureAuditEntry<typeof F170_FEATURE_ID>;

export interface F170CitationAnchoringContextGuardOutput {
  readonly featureId: typeof F170_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F170CitationAnchoringContextGuardExecutionStatus;
  readonly operationCode: typeof F170_OPERATION_CODE;
  readonly resolved_preserved_citations_count: string;
  readonly resolved_pinned_segments_count: string | number;
  readonly resolved_budget_overflow_prevented: string | number | boolean | readonly string[];
  readonly resolved_compiled_digest: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F170CitationAnchoringContextGuardAuditEntry;
}

export type F170CitationAnchoringContextGuardTelemetrySnapshot = BaseFeatureTelemetry<typeof F170_FEATURE_ID>;

export const DEFAULT_F170_CONFIG: F170CitationAnchoringContextGuardConfig = {
  featureId: F170_FEATURE_ID,
  stage: F170_STAGE,
  operationCode: F170_OPERATION_CODE,
  contractVersion: F170_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F170CitationAnchoringContextGuardValidationError extends Error {
  public readonly featureId = F170_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F170 Validation Error on '${field}']: ${message}`);
    this.name = "F170CitationAnchoringContextGuardValidationError";
    this.field = field;
  }
}

export function computeF170Digest(rawPayload: string): string {
  return `f170_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F170CitationAnchoringContextGuardEngine extends KosmoraFeatureAdapterBase<
  typeof F170_FEATURE_ID,
  typeof F170_STAGE,
  typeof F170_OPERATION_CODE,
  F170CitationAnchoringContextGuardConfig,
  F170CitationAnchoringContextGuardInput,
  F170CitationAnchoringContextGuardOutput
> {
  constructor(customConfig?: Partial<F170CitationAnchoringContextGuardConfig>, kernel?: Stage6SovereignKernel) {
    super(
      DEFAULT_F170_CONFIG,
      customConfig,
      kernel ?? new Stage6SovereignKernel(),
      ["preserved_citations_count", "pinned_segments_count", "budget_overflow_prevented", "compiled_digest"] as const,
      F170CitationAnchoringContextGuardValidationError
    );
  }
}

export function verifyF170Module(): {
  featureId: typeof F170_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F170CitationAnchoringContextGuardEngine();
  const sampleInput: F170CitationAnchoringContextGuardInput = {
    requestId: "req_verify_f170",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    preserved_citations_count: "f170_preserved_citations_count_seed",
    pinned_segments_count: 42,
    budget_overflow_prevented: true,
    compiled_digest: "verified_seed",
    metadata: { stage: "stage6-sovereign-cluster", featureNumber: 170 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F170" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_preserved_citations_count !== sampleInput.preserved_citations_count &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F170_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
