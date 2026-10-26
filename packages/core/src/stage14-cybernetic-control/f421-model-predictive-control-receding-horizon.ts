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

export const F421_FEATURE_ID = "F421" as const;
export const F421_STAGE = "stage14-cybernetic-control" as const;
export const F421_OPERATION_CODE = "F421_MODEL_PREDICTIVE_CONTROL_RECEDING_HORIZON" as const;
export const F421_CONTRACT_VERSION = "2.0.0" as const;

export type F421ModelPredictiveControlRecedingHorizonConfig = BaseFeatureConfig<
  typeof F421_FEATURE_ID,
  typeof F421_STAGE,
  typeof F421_OPERATION_CODE
>;

export interface F421ModelPredictiveControlRecedingHorizonInput extends BaseFeatureInput {
  readonly prediction_horizon_n: string | number | boolean | readonly string[];
  readonly state_reference_trajectory: string | number | boolean | readonly string[];
  readonly control_effort_weight_r: string | number | boolean | readonly string[];
  readonly actuator_limits: string | number | boolean | readonly string[];
}

export interface F421ModelPredictiveControlRecedingHorizonOutput {
  readonly featureId: typeof F421_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F421_OPERATION_CODE;
  readonly resolved_prediction_horizon_n: unknown;
  readonly resolved_state_reference_trajectory: unknown;
  readonly resolved_control_effort_weight_r: unknown;
  readonly resolved_actuator_limits: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F421_FEATURE_ID>;
}

export type F421ModelPredictiveControlRecedingHorizonTelemetrySnapshot = BaseFeatureTelemetry<typeof F421_FEATURE_ID>;

export const DEFAULT_F421_CONFIG: F421ModelPredictiveControlRecedingHorizonConfig = {
  featureId: F421_FEATURE_ID,
  stage: F421_STAGE,
  operationCode: F421_OPERATION_CODE,
  contractVersion: F421_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F421ModelPredictiveControlRecedingHorizonValidationError extends Error {
  public readonly featureId = F421_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F421 Validation Error on '${field}']: ${message}`);
    this.name = "F421ModelPredictiveControlRecedingHorizonValidationError";
    this.field = field;
  }
}

export function computeF421Digest(rawPayload: string): string {
  return `f421_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F421ModelPredictiveControlRecedingHorizonService extends KosmoraFeatureAdapterBase<
  typeof F421_FEATURE_ID,
  typeof F421_STAGE,
  typeof F421_OPERATION_CODE,
  F421ModelPredictiveControlRecedingHorizonConfig,
  F421ModelPredictiveControlRecedingHorizonInput,
  F421ModelPredictiveControlRecedingHorizonOutput
> {
  constructor(customConfig?: Partial<F421ModelPredictiveControlRecedingHorizonConfig>, kernel?: Stage14CyberneticControlKernel) {
    super(
      DEFAULT_F421_CONFIG,
      customConfig,
      kernel ?? Stage14CyberneticControlKernel.getShared(),
      ["prediction_horizon_n", "state_reference_trajectory", "control_effort_weight_r", "actuator_limits"] as const,
      F421ModelPredictiveControlRecedingHorizonValidationError
    );
  }
}

export function verifyF421Module(): {
  readonly featureId: typeof F421_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F421ModelPredictiveControlRecedingHorizonService();
  const sampleInput: F421ModelPredictiveControlRecedingHorizonInput = {
    requestId: "req_verify_f421",
    projectId: "proj_kosmora_f421",
    workspaceId: "ws_kosmora_f421",
    tenantId: "tenant_rlm_f421",
    actorId: "actor_verifier_f421",
    autonomyLevel: "A3",
    prediction_horizon_n: "seed_f421_prediction_horizon_n",
    state_reference_trajectory: 42,
    control_effort_weight_r: true,
    actuator_limits: "seed_f421_actuator_limits",
    metadata: { stage: "stage14-cybernetic-control", featureId: "F421" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F421" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_prediction_horizon_n !== sampleInput.prediction_horizon_n &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F421] Verification failed`);
  }

  return {
    featureId: F421_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
