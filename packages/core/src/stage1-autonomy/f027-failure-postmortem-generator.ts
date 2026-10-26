/**
 * F027 (stage1-autonomy): Генерация пост-мортем отчётов при сбое
 * Автоматический разбор причины падения цепочки задач
 * Operation Code: postmortem_analyzer
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

export const F027_FEATURE_ID = "F027" as const;
export const F027_STAGE = "stage1-autonomy" as const;
export const F027_OPERATION_CODE = "postmortem_analyzer" as const;
export const F027_CONTRACT_VERSION = "2.0.0" as const;

export type F027FailurePostmortemGeneratorExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export type F027FailurePostmortemGeneratorConfig = BaseFeatureConfig<
  typeof F027_FEATURE_ID,
  typeof F027_STAGE,
  typeof F027_OPERATION_CODE
>;

export interface F027FailurePostmortemGeneratorInput extends BaseFeatureInput {
  readonly report_id: string;
  readonly failed_node_id: string | number;
  readonly root_cause: string | number | boolean | readonly string[];
  readonly recovery_recommendation: string | number | boolean | Record<string, unknown>;
}

export type F027FailurePostmortemGeneratorAuditEntry = BaseFeatureAuditEntry<typeof F027_FEATURE_ID>;

export interface F027FailurePostmortemGeneratorOutput {
  readonly featureId: typeof F027_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F027FailurePostmortemGeneratorExecutionStatus;
  readonly operationCode: typeof F027_OPERATION_CODE;
  readonly resolved_report_id: string;
  readonly resolved_failed_node_id: string | number;
  readonly resolved_root_cause: string | number | boolean | readonly string[];
  readonly resolved_recovery_recommendation: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F027FailurePostmortemGeneratorAuditEntry;
}

export type F027FailurePostmortemGeneratorTelemetrySnapshot = BaseFeatureTelemetry<typeof F027_FEATURE_ID>;

export const DEFAULT_F027_CONFIG: F027FailurePostmortemGeneratorConfig = {
  featureId: F027_FEATURE_ID,
  stage: F027_STAGE,
  operationCode: F027_OPERATION_CODE,
  contractVersion: F027_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F027FailurePostmortemGeneratorValidationError extends Error {
  public readonly featureId = F027_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F027 Validation Error on '${field}']: ${message}`);
    this.name = "F027FailurePostmortemGeneratorValidationError";
    this.field = field;
  }
}

export function computeF027Digest(rawPayload: string): string {
  return `f027_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F027FailurePostmortemGeneratorEngine extends KosmoraFeatureAdapterBase<
  typeof F027_FEATURE_ID,
  typeof F027_STAGE,
  typeof F027_OPERATION_CODE,
  F027FailurePostmortemGeneratorConfig,
  F027FailurePostmortemGeneratorInput,
  F027FailurePostmortemGeneratorOutput
> {
  constructor(customConfig?: Partial<F027FailurePostmortemGeneratorConfig>, kernel?: Stage1AutonomyKernel) {
    super(
      DEFAULT_F027_CONFIG,
      customConfig,
      kernel ?? new Stage1AutonomyKernel(),
      ["report_id", "failed_node_id", "root_cause", "recovery_recommendation"] as const,
      F027FailurePostmortemGeneratorValidationError
    );
  }
}

export function verifyF027Module(): {
  featureId: typeof F027_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F027FailurePostmortemGeneratorEngine();
  const sampleInput: F027FailurePostmortemGeneratorInput = {
    requestId: "req_verify_f027",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    report_id: "f027_report_id_seed",
    failed_node_id: 42,
    root_cause: true,
    recovery_recommendation: "verified_seed",
    metadata: { stage: "stage1-autonomy", featureNumber: 27 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F027" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_report_id !== sampleInput.report_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F027_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
