/**
 * F013 (stage1-autonomy): Параллельное исполнение суб-агентов (Fan-out / Fan-in)
 * Одновременный запуск независимых веток графа с последующей агрегацией результатов
 * Operation Code: fanout_aggregator
 */

import { createHash } from "node:crypto";
import {
  Stage1AutonomyKernel,
  KosmoraFeatureAdapterBase,
  type BaseFeatureAuditEntry,
  type BaseFeatureConfig,
  type BaseFeatureInput,
  type BaseFeatureTelemetry,
  type StageKernelExecutionResult
} from "./stage-kernel.js";

export const F013_FEATURE_ID = "F013" as const;
export const F013_STAGE = "stage1-autonomy" as const;
export const F013_OPERATION_CODE = "fanout_aggregator" as const;
export const F013_CONTRACT_VERSION = "2.0.0" as const;

export type F013ParallelSubagentFanoutExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export type F013ParallelSubagentFanoutConfig = BaseFeatureConfig<
  typeof F013_FEATURE_ID,
  typeof F013_STAGE,
  typeof F013_OPERATION_CODE
>;

export interface F013ParallelSubagentFanoutInput extends BaseFeatureInput {
  readonly parallel_group_id: string;
  readonly worker_count: string | number;
  readonly completed_branches: string | number | boolean | readonly string[];
  readonly merged_output: string | number | boolean | Record<string, unknown>;
}

export type F013ParallelSubagentFanoutAuditEntry = BaseFeatureAuditEntry<typeof F013_FEATURE_ID>;

export interface F013ParallelSubagentFanoutOutput {
  readonly featureId: typeof F013_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F013ParallelSubagentFanoutExecutionStatus;
  readonly operationCode: typeof F013_OPERATION_CODE;
  readonly resolved_parallel_group_id: string;
  readonly resolved_worker_count: string | number;
  readonly resolved_completed_branches: string | number | boolean | readonly string[];
  readonly resolved_merged_output: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F013ParallelSubagentFanoutAuditEntry;
}

export type F013ParallelSubagentFanoutTelemetrySnapshot = BaseFeatureTelemetry<typeof F013_FEATURE_ID>;

export const DEFAULT_F013_CONFIG: F013ParallelSubagentFanoutConfig = {
  featureId: F013_FEATURE_ID,
  stage: F013_STAGE,
  operationCode: F013_OPERATION_CODE,
  contractVersion: F013_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F013ParallelSubagentFanoutValidationError extends Error {
  public readonly featureId = F013_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F013 Validation Error on '${field}']: ${message}`);
    this.name = "F013ParallelSubagentFanoutValidationError";
    this.field = field;
  }
}

export function computeF013Digest(rawPayload: string): string {
  return `f013_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F013ParallelSubagentFanoutEngine extends KosmoraFeatureAdapterBase<
  typeof F013_FEATURE_ID,
  typeof F013_STAGE,
  typeof F013_OPERATION_CODE,
  F013ParallelSubagentFanoutConfig,
  F013ParallelSubagentFanoutInput,
  F013ParallelSubagentFanoutOutput
> {
  constructor(customConfig?: Partial<F013ParallelSubagentFanoutConfig>, kernel?: Stage1AutonomyKernel) {
    super(
      DEFAULT_F013_CONFIG,
      customConfig,
      kernel ?? new Stage1AutonomyKernel(),
      ["parallel_group_id", "worker_count", "completed_branches", "merged_output"] as const,
      F013ParallelSubagentFanoutValidationError
    );
  }
}

export function verifyF013Module(): {
  featureId: typeof F013_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F013ParallelSubagentFanoutEngine();
  const sampleInput: F013ParallelSubagentFanoutInput = {
    requestId: "req_verify_f013",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    parallel_group_id: "f013_parallel_group_id_seed",
    worker_count: 42,
    completed_branches: true,
    merged_output: "verified_seed",
    metadata: { stage: "stage1-autonomy", featureNumber: 13 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F013" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_parallel_group_id !== sampleInput.parallel_group_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F013_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
