/**
 * F119 (stage4-intelligence-graph): Поиск «белых пятен» в графе (Gap Analysis)
 * Выявление задач или разделов отчёта, не подкреплённых ни одним исходным документом
 * Operation Code: evidence_gap_finder
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

export const F119_FEATURE_ID = "F119" as const;
export const F119_STAGE = "stage4-intelligence-graph" as const;
export const F119_OPERATION_CODE = "evidence_gap_finder" as const;
export const F119_CONTRACT_VERSION = "2.0.0" as const;

export type F119GraphGapAnalyzerExecutionStatus =
  "idle" | "validating" | "executing" | "completed" | "degraded" | "cancelled" | "failed";

export type F119GraphGapAnalyzerConfig = BaseFeatureConfig<
  typeof F119_FEATURE_ID,
  typeof F119_STAGE,
  typeof F119_OPERATION_CODE
>;

export interface F119GraphGapAnalyzerInput extends BaseFeatureInput {
  readonly workspace_id: string;
  readonly unbacked_task_ids: string | number;
  readonly orphan_claims_count: string | number | boolean | readonly string[];
  readonly remediation_plan: string | number | boolean | Record<string, unknown>;
}

export type F119GraphGapAnalyzerAuditEntry = BaseFeatureAuditEntry<typeof F119_FEATURE_ID>;

export interface F119GraphGapAnalyzerOutput {
  readonly featureId: typeof F119_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F119GraphGapAnalyzerExecutionStatus;
  readonly operationCode: typeof F119_OPERATION_CODE;
  readonly resolved_workspace_id: string;
  readonly resolved_unbacked_task_ids: string | number;
  readonly resolved_orphan_claims_count: string | number | boolean | readonly string[];
  readonly resolved_remediation_plan: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F119GraphGapAnalyzerAuditEntry;
}

export type F119GraphGapAnalyzerTelemetrySnapshot = BaseFeatureTelemetry<typeof F119_FEATURE_ID>;

export const DEFAULT_F119_CONFIG: F119GraphGapAnalyzerConfig = {
  featureId: F119_FEATURE_ID,
  stage: F119_STAGE,
  operationCode: F119_OPERATION_CODE,
  contractVersion: F119_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F119GraphGapAnalyzerValidationError extends Error {
  public readonly featureId = F119_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F119 Validation Error on '${field}']: ${message}`);
    this.name = "F119GraphGapAnalyzerValidationError";
    this.field = field;
  }
}

export function computeF119Digest(rawPayload: string): string {
  return `f119_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F119GraphGapAnalyzerEngine extends KosmoraFeatureAdapterBase<
  typeof F119_FEATURE_ID,
  typeof F119_STAGE,
  typeof F119_OPERATION_CODE,
  F119GraphGapAnalyzerConfig,
  F119GraphGapAnalyzerInput,
  F119GraphGapAnalyzerOutput
> {
  constructor(customConfig?: Partial<F119GraphGapAnalyzerConfig>, kernel?: Stage4GraphKernel) {
    super(
      DEFAULT_F119_CONFIG,
      customConfig,
      kernel ?? new Stage4GraphKernel(),
      ["workspace_id", "unbacked_task_ids", "orphan_claims_count", "remediation_plan"] as const,
      F119GraphGapAnalyzerValidationError
    );
  }
}

export function verifyF119Module(): {
  featureId: typeof F119_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F119GraphGapAnalyzerEngine();
  const sampleInput: F119GraphGapAnalyzerInput = {
    requestId: "req_verify_f119",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    workspace_id: "f119_workspace_id_seed",
    unbacked_task_ids: 42,
    orphan_claims_count: true,
    remediation_plan: "verified_seed",
    metadata: { stage: "stage4-intelligence-graph", featureNumber: 119 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F119" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_workspace_id !== sampleInput.workspace_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F119_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
