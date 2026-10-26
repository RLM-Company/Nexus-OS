/**
 * F147 (stage5-enterprise): Очередь недоставленных задач (Dead-Letter Queue)
 * Сохранение упавших фоновых джобов для повторного запуска после устранения сбоя
 * Operation Code: dlq_replay_manager
 */

import { createHash } from "node:crypto";
import {
  Stage5EnterpriseKernel,
  KosmoraFeatureAdapterBase,
  type BaseFeatureAuditEntry,
  type BaseFeatureConfig,
  type BaseFeatureInput,
  type BaseFeatureTelemetry,
  type StageKernelExecutionResult
} from "./stage-kernel.js";

export const F147_FEATURE_ID = "F147" as const;
export const F147_STAGE = "stage5-enterprise" as const;
export const F147_OPERATION_CODE = "dlq_replay_manager" as const;
export const F147_CONTRACT_VERSION = "2.0.0" as const;

export type F147DeadLetterQueueRecoveryExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export type F147DeadLetterQueueRecoveryConfig = BaseFeatureConfig<
  typeof F147_FEATURE_ID,
  typeof F147_STAGE,
  typeof F147_OPERATION_CODE
>;

export interface F147DeadLetterQueueRecoveryInput extends BaseFeatureInput {
  readonly dlq_job_id: string;
  readonly failure_reason: string | number;
  readonly retry_count: string | number | boolean | readonly string[];
  readonly requeued_successfully: string | number | boolean | Record<string, unknown>;
}

export type F147DeadLetterQueueRecoveryAuditEntry = BaseFeatureAuditEntry<typeof F147_FEATURE_ID>;

export interface F147DeadLetterQueueRecoveryOutput {
  readonly featureId: typeof F147_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F147DeadLetterQueueRecoveryExecutionStatus;
  readonly operationCode: typeof F147_OPERATION_CODE;
  readonly resolved_dlq_job_id: string;
  readonly resolved_failure_reason: string | number;
  readonly resolved_retry_count: string | number | boolean | readonly string[];
  readonly resolved_requeued_successfully: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F147DeadLetterQueueRecoveryAuditEntry;
}

export type F147DeadLetterQueueRecoveryTelemetrySnapshot = BaseFeatureTelemetry<typeof F147_FEATURE_ID>;

export const DEFAULT_F147_CONFIG: F147DeadLetterQueueRecoveryConfig = {
  featureId: F147_FEATURE_ID,
  stage: F147_STAGE,
  operationCode: F147_OPERATION_CODE,
  contractVersion: F147_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F147DeadLetterQueueRecoveryValidationError extends Error {
  public readonly featureId = F147_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F147 Validation Error on '${field}']: ${message}`);
    this.name = "F147DeadLetterQueueRecoveryValidationError";
    this.field = field;
  }
}

export function computeF147Digest(rawPayload: string): string {
  return `f147_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F147DeadLetterQueueRecoveryEngine extends KosmoraFeatureAdapterBase<
  typeof F147_FEATURE_ID,
  typeof F147_STAGE,
  typeof F147_OPERATION_CODE,
  F147DeadLetterQueueRecoveryConfig,
  F147DeadLetterQueueRecoveryInput,
  F147DeadLetterQueueRecoveryOutput
> {
  constructor(customConfig?: Partial<F147DeadLetterQueueRecoveryConfig>, kernel?: Stage5EnterpriseKernel) {
    super(
      DEFAULT_F147_CONFIG,
      customConfig,
      kernel ?? new Stage5EnterpriseKernel(),
      ["dlq_job_id", "failure_reason", "retry_count", "requeued_successfully"] as const,
      F147DeadLetterQueueRecoveryValidationError
    );
  }
}

export function verifyF147Module(): {
  featureId: typeof F147_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F147DeadLetterQueueRecoveryEngine();
  const sampleInput: F147DeadLetterQueueRecoveryInput = {
    requestId: "req_verify_f147",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    dlq_job_id: "f147_dlq_job_id_seed",
    failure_reason: 42,
    retry_count: true,
    requeued_successfully: "verified_seed",
    metadata: { stage: "stage5-enterprise", featureNumber: 147 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F147" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_dlq_job_id !== sampleInput.dlq_job_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F147_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
