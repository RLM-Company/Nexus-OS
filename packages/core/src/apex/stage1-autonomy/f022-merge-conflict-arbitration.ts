/**
 * F022 (stage1-autonomy): Разрешение конфликтов слияния результатов
 * Арбитраж Менеджером противоречивых выводов от двух параллельных исследовательских агентов
 * Operation Code: conflict_arbiter
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

export const F022_FEATURE_ID = "F022" as const;
export const F022_STAGE = "stage1-autonomy" as const;
export const F022_OPERATION_CODE = "conflict_arbiter" as const;
export const F022_CONTRACT_VERSION = "2.0.0" as const;

export type F022MergeConflictArbitrationExecutionStatus =
  "idle" | "validating" | "executing" | "completed" | "degraded" | "cancelled" | "failed";

export type F022MergeConflictArbitrationConfig = BaseFeatureConfig<
  typeof F022_FEATURE_ID,
  typeof F022_STAGE,
  typeof F022_OPERATION_CODE
>;

export interface F022MergeConflictArbitrationInput extends BaseFeatureInput {
  readonly conflict_id: string;
  readonly winning_agent_id: string | number;
  readonly arbitration_score: string | number | boolean | readonly string[];
  readonly resolution_rationale: string | number | boolean | Record<string, unknown>;
}

export type F022MergeConflictArbitrationAuditEntry = BaseFeatureAuditEntry<typeof F022_FEATURE_ID>;

export interface F022MergeConflictArbitrationOutput {
  readonly featureId: typeof F022_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F022MergeConflictArbitrationExecutionStatus;
  readonly operationCode: typeof F022_OPERATION_CODE;
  readonly resolved_conflict_id: string;
  readonly resolved_winning_agent_id: string | number;
  readonly resolved_arbitration_score: string | number | boolean | readonly string[];
  readonly resolved_resolution_rationale: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F022MergeConflictArbitrationAuditEntry;
}

export type F022MergeConflictArbitrationTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F022_FEATURE_ID
>;

export const DEFAULT_F022_CONFIG: F022MergeConflictArbitrationConfig = {
  featureId: F022_FEATURE_ID,
  stage: F022_STAGE,
  operationCode: F022_OPERATION_CODE,
  contractVersion: F022_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F022MergeConflictArbitrationValidationError extends Error {
  public readonly featureId = F022_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F022 Validation Error on '${field}']: ${message}`);
    this.name = "F022MergeConflictArbitrationValidationError";
    this.field = field;
  }
}

export function computeF022Digest(rawPayload: string): string {
  return `f022_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F022MergeConflictArbitrationEngine extends KosmoraFeatureAdapterBase<
  typeof F022_FEATURE_ID,
  typeof F022_STAGE,
  typeof F022_OPERATION_CODE,
  F022MergeConflictArbitrationConfig,
  F022MergeConflictArbitrationInput,
  F022MergeConflictArbitrationOutput
> {
  constructor(
    customConfig?: Partial<F022MergeConflictArbitrationConfig>,
    kernel?: Stage1AutonomyKernel
  ) {
    super(
      DEFAULT_F022_CONFIG,
      customConfig,
      kernel ?? new Stage1AutonomyKernel(),
      ["conflict_id", "winning_agent_id", "arbitration_score", "resolution_rationale"] as const,
      F022MergeConflictArbitrationValidationError
    );
  }
}

export function verifyF022Module(): {
  featureId: typeof F022_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F022MergeConflictArbitrationEngine();
  const sampleInput: F022MergeConflictArbitrationInput = {
    requestId: "req_verify_f022",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    conflict_id: "f022_conflict_id_seed",
    winning_agent_id: 42,
    arbitration_score: true,
    resolution_rationale: "verified_seed",
    metadata: { stage: "stage1-autonomy", featureNumber: 22 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F022" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_conflict_id !== sampleInput.conflict_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F022_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
