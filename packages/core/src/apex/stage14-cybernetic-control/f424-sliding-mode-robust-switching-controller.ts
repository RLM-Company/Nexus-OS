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

export const F424_FEATURE_ID = "F424" as const;
export const F424_STAGE = "stage14-cybernetic-control" as const;
export const F424_OPERATION_CODE = "F424_SLIDING_MODE_ROBUST_SWITCHING_CONTROLLER" as const;
export const F424_CONTRACT_VERSION = "2.0.0" as const;

export type F424SlidingModeRobustSwitchingControllerConfig = BaseFeatureConfig<
  typeof F424_FEATURE_ID,
  typeof F424_STAGE,
  typeof F424_OPERATION_CODE
>;

export interface F424SlidingModeRobustSwitchingControllerInput extends BaseFeatureInput {
  readonly sliding_surface_slope: string | number | boolean | readonly string[];
  readonly boundary_layer_phi: string | number | boolean | readonly string[];
  readonly switching_gain_eta: string | number | boolean | readonly string[];
  readonly tracking_error_vector: string | number | boolean | readonly string[];
}

export interface F424SlidingModeRobustSwitchingControllerOutput {
  readonly featureId: typeof F424_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F424_OPERATION_CODE;
  readonly resolved_sliding_surface_slope: unknown;
  readonly resolved_boundary_layer_phi: unknown;
  readonly resolved_switching_gain_eta: unknown;
  readonly resolved_tracking_error_vector: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F424_FEATURE_ID>;
}

export type F424SlidingModeRobustSwitchingControllerTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F424_FEATURE_ID
>;

export const DEFAULT_F424_CONFIG: F424SlidingModeRobustSwitchingControllerConfig = {
  featureId: F424_FEATURE_ID,
  stage: F424_STAGE,
  operationCode: F424_OPERATION_CODE,
  contractVersion: F424_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F424SlidingModeRobustSwitchingControllerValidationError extends Error {
  public readonly featureId = F424_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F424 Validation Error on '${field}']: ${message}`);
    this.name = "F424SlidingModeRobustSwitchingControllerValidationError";
    this.field = field;
  }
}

export function computeF424Digest(rawPayload: string): string {
  return `f424_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F424SlidingModeRobustSwitchingControllerService extends KosmoraFeatureAdapterBase<
  typeof F424_FEATURE_ID,
  typeof F424_STAGE,
  typeof F424_OPERATION_CODE,
  F424SlidingModeRobustSwitchingControllerConfig,
  F424SlidingModeRobustSwitchingControllerInput,
  F424SlidingModeRobustSwitchingControllerOutput
> {
  constructor(
    customConfig?: Partial<F424SlidingModeRobustSwitchingControllerConfig>,
    kernel?: Stage14CyberneticControlKernel
  ) {
    super(
      DEFAULT_F424_CONFIG,
      customConfig,
      kernel ?? Stage14CyberneticControlKernel.getShared(),
      [
        "sliding_surface_slope",
        "boundary_layer_phi",
        "switching_gain_eta",
        "tracking_error_vector"
      ] as const,
      F424SlidingModeRobustSwitchingControllerValidationError
    );
  }
}

export function verifyF424Module(): {
  readonly featureId: typeof F424_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F424SlidingModeRobustSwitchingControllerService();
  const sampleInput: F424SlidingModeRobustSwitchingControllerInput = {
    requestId: "req_verify_f424",
    projectId: "proj_kosmora_f424",
    workspaceId: "ws_kosmora_f424",
    tenantId: "tenant_rlm_f424",
    actorId: "actor_verifier_f424",
    autonomyLevel: "A3",
    sliding_surface_slope: "seed_f424_sliding_surface_slope",
    boundary_layer_phi: 42,
    switching_gain_eta: true,
    tracking_error_vector: "seed_f424_tracking_error_vector",
    metadata: { stage: "stage14-cybernetic-control", featureId: "F424" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F424" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_sliding_surface_slope !== sampleInput.sliding_surface_slope &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F424] Verification failed`);
  }

  return {
    featureId: F424_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
