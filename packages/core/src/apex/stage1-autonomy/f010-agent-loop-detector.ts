/**
 * F010 (stage1-autonomy): Детектор зацикливания агентов
 * Принудительное прерывание бесконечных споров между Исполнителем и Критиком после N итераций
 * Operation Code: loop_breaker
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

export const F010_FEATURE_ID = "F010" as const;
export const F010_STAGE = "stage1-autonomy" as const;
export const F010_OPERATION_CODE = "loop_breaker" as const;
export const F010_CONTRACT_VERSION = "2.0.0" as const;

export type F010AgentLoopDetectorExecutionStatus =
  "idle" | "validating" | "executing" | "completed" | "degraded" | "cancelled" | "failed";

export type F010AgentLoopDetectorConfig = BaseFeatureConfig<
  typeof F010_FEATURE_ID,
  typeof F010_STAGE,
  typeof F010_OPERATION_CODE
>;

export interface F010AgentLoopDetectorInput extends BaseFeatureInput {
  readonly task_id: string;
  readonly iteration_count: string | number;
  readonly max_iterations: string | number | boolean | readonly string[];
  readonly loop_terminated: string | number | boolean | Record<string, unknown>;
}

export type F010AgentLoopDetectorAuditEntry = BaseFeatureAuditEntry<typeof F010_FEATURE_ID>;

export interface F010AgentLoopDetectorOutput {
  readonly featureId: typeof F010_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F010AgentLoopDetectorExecutionStatus;
  readonly operationCode: typeof F010_OPERATION_CODE;
  readonly resolved_task_id: string;
  readonly resolved_iteration_count: string | number;
  readonly resolved_max_iterations: string | number | boolean | readonly string[];
  readonly resolved_loop_terminated: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F010AgentLoopDetectorAuditEntry;
}

export type F010AgentLoopDetectorTelemetrySnapshot = BaseFeatureTelemetry<typeof F010_FEATURE_ID>;

export const DEFAULT_F010_CONFIG: F010AgentLoopDetectorConfig = {
  featureId: F010_FEATURE_ID,
  stage: F010_STAGE,
  operationCode: F010_OPERATION_CODE,
  contractVersion: F010_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F010AgentLoopDetectorValidationError extends Error {
  public readonly featureId = F010_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F010 Validation Error on '${field}']: ${message}`);
    this.name = "F010AgentLoopDetectorValidationError";
    this.field = field;
  }
}

export function computeF010Digest(rawPayload: string): string {
  return `f010_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F010AgentLoopDetectorEngine extends KosmoraFeatureAdapterBase<
  typeof F010_FEATURE_ID,
  typeof F010_STAGE,
  typeof F010_OPERATION_CODE,
  F010AgentLoopDetectorConfig,
  F010AgentLoopDetectorInput,
  F010AgentLoopDetectorOutput
> {
  constructor(customConfig?: Partial<F010AgentLoopDetectorConfig>, kernel?: Stage1AutonomyKernel) {
    super(
      DEFAULT_F010_CONFIG,
      customConfig,
      kernel ?? new Stage1AutonomyKernel(),
      ["task_id", "iteration_count", "max_iterations", "loop_terminated"] as const,
      F010AgentLoopDetectorValidationError
    );
  }
  protected override validateDomainInvariants(input: F010AgentLoopDetectorInput): void {
    if (
      typeof input.iteration_count === "number" &&
      typeof input.max_iterations === "number" &&
      input.max_iterations === 0
    ) {
      throw new F010AgentLoopDetectorValidationError(
        "max_iterations",
        "Upper bound 'max_iterations' must be greater than zero."
      );
    }
  }
}

export function verifyF010Module(): {
  featureId: typeof F010_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F010AgentLoopDetectorEngine();
  const sampleInput: F010AgentLoopDetectorInput = {
    requestId: "req_verify_f010",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    task_id: "f010_task_id_seed",
    iteration_count: 42,
    max_iterations: true,
    loop_terminated: "verified_seed",
    metadata: { stage: "stage1-autonomy", featureNumber: 10 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F010" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_task_id !== sampleInput.task_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F010_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
