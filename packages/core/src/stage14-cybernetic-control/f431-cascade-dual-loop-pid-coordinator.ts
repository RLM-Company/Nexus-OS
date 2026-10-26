import { createHash } from "node:crypto";
import {
  KosmoraFeatureAdapterBase,
  type BaseFeatureAuditEntry,
  type BaseFeatureConfig,
  type BaseFeatureInput,
  type BaseFeatureTelemetry,
  type StageKernelExecutionResult
} from "../stage1-autonomy/stage-kernel.js";
import { Stage14CyberneticControlKernel } from "./stage-kernel.js";

export const F431_FEATURE_ID = "F431" as const;
export const F431_STAGE = "stage14-cybernetic-control" as const;
export const F431_OPERATION_CODE = "F431_CASCADE_DUAL_LOOP_PID_COORDINATOR" as const;
export const F431_CONTRACT_VERSION = "2.0.0" as const;

export type F431CascadeDualLoopPidCoordinatorConfig = BaseFeatureConfig<
  typeof F431_FEATURE_ID,
  typeof F431_STAGE,
  typeof F431_OPERATION_CODE
>;

export interface F431CascadeDualLoopPidCoordinatorInput extends BaseFeatureInput {
  readonly outer_master_setpoint: string | number | boolean | readonly string[];
  readonly inner_slave_feedback: string | number | boolean | readonly string[];
  readonly outer_kp_ki: string | number | boolean | readonly string[];
  readonly inner_kp_ki: string | number | boolean | readonly string[];
}

export interface F431CascadeDualLoopPidCoordinatorOutput {
  readonly featureId: typeof F431_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F431_OPERATION_CODE;
  readonly resolved_outer_master_setpoint: unknown;
  readonly resolved_inner_slave_feedback: unknown;
  readonly resolved_outer_kp_ki: unknown;
  readonly resolved_inner_kp_ki: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F431_FEATURE_ID>;
}

export type F431CascadeDualLoopPidCoordinatorTelemetrySnapshot = BaseFeatureTelemetry<typeof F431_FEATURE_ID>;

export const DEFAULT_F431_CONFIG: F431CascadeDualLoopPidCoordinatorConfig = {
  featureId: F431_FEATURE_ID,
  stage: F431_STAGE,
  operationCode: F431_OPERATION_CODE,
  contractVersion: F431_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F431CascadeDualLoopPidCoordinatorValidationError extends Error {
  public readonly featureId = F431_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F431 Validation Error on '${field}']: ${message}`);
    this.name = "F431CascadeDualLoopPidCoordinatorValidationError";
    this.field = field;
  }
}

export function computeF431Digest(rawPayload: string): string {
  return `f431_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F431CascadeDualLoopPidCoordinatorService extends KosmoraFeatureAdapterBase<
  typeof F431_FEATURE_ID,
  typeof F431_STAGE,
  typeof F431_OPERATION_CODE,
  F431CascadeDualLoopPidCoordinatorConfig,
  F431CascadeDualLoopPidCoordinatorInput,
  F431CascadeDualLoopPidCoordinatorOutput
> {
  constructor(customConfig?: Partial<F431CascadeDualLoopPidCoordinatorConfig>, kernel?: Stage14CyberneticControlKernel) {
    super(
      DEFAULT_F431_CONFIG,
      customConfig,
      kernel ?? Stage14CyberneticControlKernel.getShared(),
      ["outer_master_setpoint", "inner_slave_feedback", "outer_kp_ki", "inner_kp_ki"] as const,
      F431CascadeDualLoopPidCoordinatorValidationError
    );
  }
}

export function verifyF431Module(): {
  readonly featureId: typeof F431_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F431CascadeDualLoopPidCoordinatorService();
  const sampleInput: F431CascadeDualLoopPidCoordinatorInput = {
    requestId: "req_verify_f431",
    projectId: "proj_kosmora_f431",
    workspaceId: "ws_kosmora_f431",
    tenantId: "tenant_rlm_f431",
    actorId: "actor_verifier_f431",
    autonomyLevel: "A3",
    outer_master_setpoint: "seed_f431_outer_master_setpoint",
    inner_slave_feedback: 42,
    outer_kp_ki: true,
    inner_kp_ki: "seed_f431_inner_kp_ki",
    metadata: { stage: "stage14-cybernetic-control", featureId: "F431" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F431" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_outer_master_setpoint !== sampleInput.outer_master_setpoint &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F431] Verification failed`);
  }

  return {
    featureId: F431_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
