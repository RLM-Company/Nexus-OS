/**
 * F014 (stage1-autonomy): Приоритизация очереди задач
 * Динамическое перестроение весов в очереди при поступлении срочного сообщения от пользователя
 * Operation Code: priority_scheduler
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

export const F014_FEATURE_ID = "F014" as const;
export const F014_STAGE = "stage1-autonomy" as const;
export const F014_OPERATION_CODE = "priority_scheduler" as const;
export const F014_CONTRACT_VERSION = "2.0.0" as const;

export type F014DynamicTaskQueuePriorityExecutionStatus =
  "idle" | "validating" | "executing" | "completed" | "degraded" | "cancelled" | "failed";

export type F014DynamicTaskQueuePriorityConfig = BaseFeatureConfig<
  typeof F014_FEATURE_ID,
  typeof F014_STAGE,
  typeof F014_OPERATION_CODE
>;

export interface F014DynamicTaskQueuePriorityInput extends BaseFeatureInput {
  readonly queue_id: string;
  readonly urgent_task_id: string | number;
  readonly previous_weight: string | number | boolean | readonly string[];
  readonly new_priority_weight: string | number | boolean | Record<string, unknown>;
}

export type F014DynamicTaskQueuePriorityAuditEntry = BaseFeatureAuditEntry<typeof F014_FEATURE_ID>;

export interface F014DynamicTaskQueuePriorityOutput {
  readonly featureId: typeof F014_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F014DynamicTaskQueuePriorityExecutionStatus;
  readonly operationCode: typeof F014_OPERATION_CODE;
  readonly resolved_queue_id: string;
  readonly resolved_urgent_task_id: string | number;
  readonly resolved_previous_weight: string | number | boolean | readonly string[];
  readonly resolved_new_priority_weight: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F014DynamicTaskQueuePriorityAuditEntry;
}

export type F014DynamicTaskQueuePriorityTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F014_FEATURE_ID
>;

export const DEFAULT_F014_CONFIG: F014DynamicTaskQueuePriorityConfig = {
  featureId: F014_FEATURE_ID,
  stage: F014_STAGE,
  operationCode: F014_OPERATION_CODE,
  contractVersion: F014_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F014DynamicTaskQueuePriorityValidationError extends Error {
  public readonly featureId = F014_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F014 Validation Error on '${field}']: ${message}`);
    this.name = "F014DynamicTaskQueuePriorityValidationError";
    this.field = field;
  }
}

export function computeF014Digest(rawPayload: string): string {
  return `f014_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F014DynamicTaskQueuePriorityEngine extends KosmoraFeatureAdapterBase<
  typeof F014_FEATURE_ID,
  typeof F014_STAGE,
  typeof F014_OPERATION_CODE,
  F014DynamicTaskQueuePriorityConfig,
  F014DynamicTaskQueuePriorityInput,
  F014DynamicTaskQueuePriorityOutput
> {
  constructor(
    customConfig?: Partial<F014DynamicTaskQueuePriorityConfig>,
    kernel?: Stage1AutonomyKernel
  ) {
    super(
      DEFAULT_F014_CONFIG,
      customConfig,
      kernel ?? new Stage1AutonomyKernel(),
      ["queue_id", "urgent_task_id", "previous_weight", "new_priority_weight"] as const,
      F014DynamicTaskQueuePriorityValidationError
    );
  }
}

export function verifyF014Module(): {
  featureId: typeof F014_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F014DynamicTaskQueuePriorityEngine();
  const sampleInput: F014DynamicTaskQueuePriorityInput = {
    requestId: "req_verify_f014",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    queue_id: "f014_queue_id_seed",
    urgent_task_id: 42,
    previous_weight: true,
    new_priority_weight: "verified_seed",
    metadata: { stage: "stage1-autonomy", featureNumber: 14 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F014" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_queue_id !== sampleInput.queue_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F014_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
