/**
 * F125 (stage4-intelligence-graph): Слияние выводов из параллельных веток чата
 * Перенос финального артефакта из экспериментальной ветки обратно в основную
 * Operation Code: chat_branch_merger
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

export const F125_FEATURE_ID = "F125" as const;
export const F125_STAGE = "stage4-intelligence-graph" as const;
export const F125_OPERATION_CODE = "chat_branch_merger" as const;
export const F125_CONTRACT_VERSION = "2.0.0" as const;

export type F125ParallelChatBranchMergerExecutionStatus =
  "idle" | "validating" | "executing" | "completed" | "degraded" | "cancelled" | "failed";

export type F125ParallelChatBranchMergerConfig = BaseFeatureConfig<
  typeof F125_FEATURE_ID,
  typeof F125_STAGE,
  typeof F125_OPERATION_CODE
>;

export interface F125ParallelChatBranchMergerInput extends BaseFeatureInput {
  readonly source_branch_id: string;
  readonly target_branch_id: string | number;
  readonly promoted_artifact_id: string | number | boolean | readonly string[];
  readonly merge_commit_id: string | number | boolean | Record<string, unknown>;
}

export type F125ParallelChatBranchMergerAuditEntry = BaseFeatureAuditEntry<typeof F125_FEATURE_ID>;

export interface F125ParallelChatBranchMergerOutput {
  readonly featureId: typeof F125_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F125ParallelChatBranchMergerExecutionStatus;
  readonly operationCode: typeof F125_OPERATION_CODE;
  readonly resolved_source_branch_id: string;
  readonly resolved_target_branch_id: string | number;
  readonly resolved_promoted_artifact_id: string | number | boolean | readonly string[];
  readonly resolved_merge_commit_id: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F125ParallelChatBranchMergerAuditEntry;
}

export type F125ParallelChatBranchMergerTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F125_FEATURE_ID
>;

export const DEFAULT_F125_CONFIG: F125ParallelChatBranchMergerConfig = {
  featureId: F125_FEATURE_ID,
  stage: F125_STAGE,
  operationCode: F125_OPERATION_CODE,
  contractVersion: F125_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F125ParallelChatBranchMergerValidationError extends Error {
  public readonly featureId = F125_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F125 Validation Error on '${field}']: ${message}`);
    this.name = "F125ParallelChatBranchMergerValidationError";
    this.field = field;
  }
}

export function computeF125Digest(rawPayload: string): string {
  return `f125_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F125ParallelChatBranchMergerEngine extends KosmoraFeatureAdapterBase<
  typeof F125_FEATURE_ID,
  typeof F125_STAGE,
  typeof F125_OPERATION_CODE,
  F125ParallelChatBranchMergerConfig,
  F125ParallelChatBranchMergerInput,
  F125ParallelChatBranchMergerOutput
> {
  constructor(
    customConfig?: Partial<F125ParallelChatBranchMergerConfig>,
    kernel?: Stage4GraphKernel
  ) {
    super(
      DEFAULT_F125_CONFIG,
      customConfig,
      kernel ?? new Stage4GraphKernel(),
      ["source_branch_id", "target_branch_id", "promoted_artifact_id", "merge_commit_id"] as const,
      F125ParallelChatBranchMergerValidationError
    );
  }
}

export function verifyF125Module(): {
  featureId: typeof F125_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F125ParallelChatBranchMergerEngine();
  const sampleInput: F125ParallelChatBranchMergerInput = {
    requestId: "req_verify_f125",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    source_branch_id: "f125_source_branch_id_seed",
    target_branch_id: 42,
    promoted_artifact_id: true,
    merge_commit_id: "verified_seed",
    metadata: { stage: "stage4-intelligence-graph", featureNumber: 125 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F125" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_source_branch_id !== sampleInput.source_branch_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F125_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
