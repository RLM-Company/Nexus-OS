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

export const F417_FEATURE_ID = "F417" as const;
export const F417_STAGE = "stage14-cybernetic-control" as const;
export const F417_OPERATION_CODE = "F417_DISCRETE_PID_ANTI_WINDUP_CONTROLLER" as const;
export const F417_CONTRACT_VERSION = "2.0.0" as const;

export type F417DiscretePidAntiWindupControllerConfig = BaseFeatureConfig<
  typeof F417_FEATURE_ID,
  typeof F417_STAGE,
  typeof F417_OPERATION_CODE
>;

export interface F417DiscretePidAntiWindupControllerInput extends BaseFeatureInput {
  readonly setpoint: string | number | boolean | readonly string[];
  readonly kp_gain: string | number | boolean | readonly string[];
  readonly ki_gain: string | number | boolean | readonly string[];
  readonly kd_gain: string | number | boolean | readonly string[];
}

export interface F417DiscretePidAntiWindupControllerOutput {
  readonly featureId: typeof F417_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F417_OPERATION_CODE;
  readonly resolved_setpoint: unknown;
  readonly resolved_kp_gain: unknown;
  readonly resolved_ki_gain: unknown;
  readonly resolved_kd_gain: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F417_FEATURE_ID>;
}

export type F417DiscretePidAntiWindupControllerTelemetrySnapshot = BaseFeatureTelemetry<typeof F417_FEATURE_ID>;

export const DEFAULT_F417_CONFIG: F417DiscretePidAntiWindupControllerConfig = {
  featureId: F417_FEATURE_ID,
  stage: F417_STAGE,
  operationCode: F417_OPERATION_CODE,
  contractVersion: F417_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F417DiscretePidAntiWindupControllerValidationError extends Error {
  public readonly featureId = F417_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F417 Validation Error on '${field}']: ${message}`);
    this.name = "F417DiscretePidAntiWindupControllerValidationError";
    this.field = field;
  }
}

export function computeF417Digest(rawPayload: string): string {
  return `f417_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F417DiscretePidAntiWindupControllerService extends KosmoraFeatureAdapterBase<
  typeof F417_FEATURE_ID,
  typeof F417_STAGE,
  typeof F417_OPERATION_CODE,
  F417DiscretePidAntiWindupControllerConfig,
  F417DiscretePidAntiWindupControllerInput,
  F417DiscretePidAntiWindupControllerOutput
> {
  constructor(customConfig?: Partial<F417DiscretePidAntiWindupControllerConfig>, kernel?: Stage14CyberneticControlKernel) {
    super(
      DEFAULT_F417_CONFIG,
      customConfig,
      kernel ?? Stage14CyberneticControlKernel.getShared(),
      ["setpoint", "kp_gain", "ki_gain", "kd_gain"] as const,
      F417DiscretePidAntiWindupControllerValidationError
    );
  }
}

export function verifyF417Module(): {
  readonly featureId: typeof F417_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F417DiscretePidAntiWindupControllerService();
  const sampleInput: F417DiscretePidAntiWindupControllerInput = {
    requestId: "req_verify_f417",
    projectId: "proj_kosmora_f417",
    workspaceId: "ws_kosmora_f417",
    tenantId: "tenant_rlm_f417",
    actorId: "actor_verifier_f417",
    autonomyLevel: "A3",
    setpoint: "seed_f417_setpoint",
    kp_gain: 42,
    ki_gain: true,
    kd_gain: "seed_f417_kd_gain",
    metadata: { stage: "stage14-cybernetic-control", featureId: "F417" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F417" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_setpoint !== sampleInput.setpoint &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F417] Verification failed`);
  }

  return {
    featureId: F417_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
