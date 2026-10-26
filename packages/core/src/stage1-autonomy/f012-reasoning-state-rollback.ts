/**
 * F012 (stage1-autonomy): Откат ветки рассуждений (State Rollback)
 * Возможность вернуться на 2–3 шага назад в графе задач и пойти по альтернативной ветке
 * Operation Code: branch_rollback
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

export const F012_FEATURE_ID = "F012" as const;
export const F012_STAGE = "stage1-autonomy" as const;
export const F012_OPERATION_CODE = "branch_rollback" as const;
export const F012_CONTRACT_VERSION = "2.0.0" as const;

export type F012ReasoningStateRollbackExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export type F012ReasoningStateRollbackConfig = BaseFeatureConfig<
  typeof F012_FEATURE_ID,
  typeof F012_STAGE,
  typeof F012_OPERATION_CODE
>;

export interface F012ReasoningStateRollbackInput extends BaseFeatureInput {
  readonly graph_id: string;
  readonly target_checkpoint_id: string | number;
  readonly steps_reverted: string | number | boolean | readonly string[];
  readonly alternate_branch_id: string | number | boolean | Record<string, unknown>;
}

export type F012ReasoningStateRollbackAuditEntry = BaseFeatureAuditEntry<typeof F012_FEATURE_ID>;

export interface F012ReasoningStateRollbackOutput {
  readonly featureId: typeof F012_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F012ReasoningStateRollbackExecutionStatus;
  readonly operationCode: typeof F012_OPERATION_CODE;
  readonly resolved_graph_id: string;
  readonly resolved_target_checkpoint_id: string | number;
  readonly resolved_steps_reverted: string | number | boolean | readonly string[];
  readonly resolved_alternate_branch_id: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F012ReasoningStateRollbackAuditEntry;
}

export type F012ReasoningStateRollbackTelemetrySnapshot = BaseFeatureTelemetry<typeof F012_FEATURE_ID>;

export const DEFAULT_F012_CONFIG: F012ReasoningStateRollbackConfig = {
  featureId: F012_FEATURE_ID,
  stage: F012_STAGE,
  operationCode: F012_OPERATION_CODE,
  contractVersion: F012_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F012ReasoningStateRollbackValidationError extends Error {
  public readonly featureId = F012_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F012 Validation Error on '${field}']: ${message}`);
    this.name = "F012ReasoningStateRollbackValidationError";
    this.field = field;
  }
}

export function computeF012Digest(rawPayload: string): string {
  return `f012_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F012ReasoningStateRollbackEngine extends KosmoraFeatureAdapterBase<
  typeof F012_FEATURE_ID,
  typeof F012_STAGE,
  typeof F012_OPERATION_CODE,
  F012ReasoningStateRollbackConfig,
  F012ReasoningStateRollbackInput,
  F012ReasoningStateRollbackOutput
> {
  constructor(customConfig?: Partial<F012ReasoningStateRollbackConfig>, kernel?: Stage1AutonomyKernel) {
    super(
      DEFAULT_F012_CONFIG,
      customConfig,
      kernel ?? new Stage1AutonomyKernel(),
      ["graph_id", "target_checkpoint_id", "steps_reverted", "alternate_branch_id"] as const,
      F012ReasoningStateRollbackValidationError
    );
  }
}

export function verifyF012Module(): {
  featureId: typeof F012_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F012ReasoningStateRollbackEngine();
  const sampleInput: F012ReasoningStateRollbackInput = {
    requestId: "req_verify_f012",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    graph_id: "f012_graph_id_seed",
    target_checkpoint_id: 42,
    steps_reverted: true,
    alternate_branch_id: "verified_seed",
    metadata: { stage: "stage1-autonomy", featureNumber: 12 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F012" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_graph_id !== sampleInput.graph_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F012_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
