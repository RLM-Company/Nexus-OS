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

export const F430_FEATURE_ID = "F430" as const;
export const F430_STAGE = "stage14-cybernetic-control" as const;
export const F430_OPERATION_CODE = "F430_SMITH_PREDICTOR_DEAD_TIME_COMPENSATOR" as const;
export const F430_CONTRACT_VERSION = "2.0.0" as const;

export type F430SmithPredictorDeadTimeCompensatorConfig = BaseFeatureConfig<
  typeof F430_FEATURE_ID,
  typeof F430_STAGE,
  typeof F430_OPERATION_CODE
>;

export interface F430SmithPredictorDeadTimeCompensatorInput extends BaseFeatureInput {
  readonly transport_delay_steps: string | number | boolean | readonly string[];
  readonly internal_model_gain: string | number | boolean | readonly string[];
  readonly internal_model_tau: string | number | boolean | readonly string[];
  readonly loop_setpoint: string | number | boolean | readonly string[];
}

export interface F430SmithPredictorDeadTimeCompensatorOutput {
  readonly featureId: typeof F430_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F430_OPERATION_CODE;
  readonly resolved_transport_delay_steps: unknown;
  readonly resolved_internal_model_gain: unknown;
  readonly resolved_internal_model_tau: unknown;
  readonly resolved_loop_setpoint: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F430_FEATURE_ID>;
}

export type F430SmithPredictorDeadTimeCompensatorTelemetrySnapshot = BaseFeatureTelemetry<typeof F430_FEATURE_ID>;

export const DEFAULT_F430_CONFIG: F430SmithPredictorDeadTimeCompensatorConfig = {
  featureId: F430_FEATURE_ID,
  stage: F430_STAGE,
  operationCode: F430_OPERATION_CODE,
  contractVersion: F430_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F430SmithPredictorDeadTimeCompensatorValidationError extends Error {
  public readonly featureId = F430_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F430 Validation Error on '${field}']: ${message}`);
    this.name = "F430SmithPredictorDeadTimeCompensatorValidationError";
    this.field = field;
  }
}

export function computeF430Digest(rawPayload: string): string {
  return `f430_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F430SmithPredictorDeadTimeCompensatorService extends KosmoraFeatureAdapterBase<
  typeof F430_FEATURE_ID,
  typeof F430_STAGE,
  typeof F430_OPERATION_CODE,
  F430SmithPredictorDeadTimeCompensatorConfig,
  F430SmithPredictorDeadTimeCompensatorInput,
  F430SmithPredictorDeadTimeCompensatorOutput
> {
  constructor(customConfig?: Partial<F430SmithPredictorDeadTimeCompensatorConfig>, kernel?: Stage14CyberneticControlKernel) {
    super(
      DEFAULT_F430_CONFIG,
      customConfig,
      kernel ?? Stage14CyberneticControlKernel.getShared(),
      ["transport_delay_steps", "internal_model_gain", "internal_model_tau", "loop_setpoint"] as const,
      F430SmithPredictorDeadTimeCompensatorValidationError
    );
  }
}

export function verifyF430Module(): {
  readonly featureId: typeof F430_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F430SmithPredictorDeadTimeCompensatorService();
  const sampleInput: F430SmithPredictorDeadTimeCompensatorInput = {
    requestId: "req_verify_f430",
    projectId: "proj_kosmora_f430",
    workspaceId: "ws_kosmora_f430",
    tenantId: "tenant_rlm_f430",
    actorId: "actor_verifier_f430",
    autonomyLevel: "A3",
    transport_delay_steps: "seed_f430_transport_delay_steps",
    internal_model_gain: 42,
    internal_model_tau: true,
    loop_setpoint: "seed_f430_loop_setpoint",
    metadata: { stage: "stage14-cybernetic-control", featureId: "F430" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F430" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_transport_delay_steps !== sampleInput.transport_delay_steps &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F430] Verification failed`);
  }

  return {
    featureId: F430_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
