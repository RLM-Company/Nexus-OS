/**
 * F011 (stage1-autonomy): Снимки состояния выполнения (Checkpointing)
 * Сохранение стейта графа на каждом узле для возобновления с места сбоя
 * Operation Code: state_checkpoint
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

export const F011_FEATURE_ID = "F011" as const;
export const F011_STAGE = "stage1-autonomy" as const;
export const F011_OPERATION_CODE = "state_checkpoint" as const;
export const F011_CONTRACT_VERSION = "2.0.0" as const;

export type F011ExecutionCheckpointingExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export type F011ExecutionCheckpointingConfig = BaseFeatureConfig<
  typeof F011_FEATURE_ID,
  typeof F011_STAGE,
  typeof F011_OPERATION_CODE
>;

export interface F011ExecutionCheckpointingInput extends BaseFeatureInput {
  readonly checkpoint_id: string;
  readonly graph_id: string | number;
  readonly step_index: string | number | boolean | readonly string[];
  readonly serialized_state_hash: string | number | boolean | Record<string, unknown>;
}

export type F011ExecutionCheckpointingAuditEntry = BaseFeatureAuditEntry<typeof F011_FEATURE_ID>;

export interface F011ExecutionCheckpointingOutput {
  readonly featureId: typeof F011_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F011ExecutionCheckpointingExecutionStatus;
  readonly operationCode: typeof F011_OPERATION_CODE;
  readonly resolved_checkpoint_id: string;
  readonly resolved_graph_id: string | number;
  readonly resolved_step_index: string | number | boolean | readonly string[];
  readonly resolved_serialized_state_hash: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F011ExecutionCheckpointingAuditEntry;
}

export type F011ExecutionCheckpointingTelemetrySnapshot = BaseFeatureTelemetry<typeof F011_FEATURE_ID>;

export const DEFAULT_F011_CONFIG: F011ExecutionCheckpointingConfig = {
  featureId: F011_FEATURE_ID,
  stage: F011_STAGE,
  operationCode: F011_OPERATION_CODE,
  contractVersion: F011_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F011ExecutionCheckpointingValidationError extends Error {
  public readonly featureId = F011_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F011 Validation Error on '${field}']: ${message}`);
    this.name = "F011ExecutionCheckpointingValidationError";
    this.field = field;
  }
}

export function computeF011Digest(rawPayload: string): string {
  return `f011_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F011ExecutionCheckpointingEngine extends KosmoraFeatureAdapterBase<
  typeof F011_FEATURE_ID,
  typeof F011_STAGE,
  typeof F011_OPERATION_CODE,
  F011ExecutionCheckpointingConfig,
  F011ExecutionCheckpointingInput,
  F011ExecutionCheckpointingOutput
> {
  constructor(customConfig?: Partial<F011ExecutionCheckpointingConfig>, kernel?: Stage1AutonomyKernel) {
    super(
      DEFAULT_F011_CONFIG,
      customConfig,
      kernel ?? new Stage1AutonomyKernel(),
      ["checkpoint_id", "graph_id", "step_index", "serialized_state_hash"] as const,
      F011ExecutionCheckpointingValidationError
    );
  }
}

export function verifyF011Module(): {
  featureId: typeof F011_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F011ExecutionCheckpointingEngine();
  const sampleInput: F011ExecutionCheckpointingInput = {
    requestId: "req_verify_f011",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    checkpoint_id: "f011_checkpoint_id_seed",
    graph_id: 42,
    step_index: true,
    serialized_state_hash: "verified_seed",
    metadata: { stage: "stage1-autonomy", featureNumber: 11 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F011" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_checkpoint_id !== sampleInput.checkpoint_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F011_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
