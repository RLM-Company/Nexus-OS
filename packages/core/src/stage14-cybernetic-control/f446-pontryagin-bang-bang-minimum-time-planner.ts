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

export const F446_FEATURE_ID = "F446" as const;
export const F446_STAGE = "stage14-cybernetic-control" as const;
export const F446_OPERATION_CODE = "F446_PONTRYAGIN_BANG_BANG_MINIMUM_TIME_PLANNER" as const;
export const F446_CONTRACT_VERSION = "2.0.0" as const;

export type F446PontryaginBangBangMinimumTimePlannerConfig = BaseFeatureConfig<
  typeof F446_FEATURE_ID,
  typeof F446_STAGE,
  typeof F446_OPERATION_CODE
>;

export interface F446PontryaginBangBangMinimumTimePlannerInput extends BaseFeatureInput {
  readonly initial_position: string | number | boolean | readonly string[];
  readonly initial_velocity: string | number | boolean | readonly string[];
  readonly max_acceleration_u: string | number | boolean | readonly string[];
  readonly target_origin: string | number | boolean | readonly string[];
}

export interface F446PontryaginBangBangMinimumTimePlannerOutput {
  readonly featureId: typeof F446_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F446_OPERATION_CODE;
  readonly resolved_initial_position: unknown;
  readonly resolved_initial_velocity: unknown;
  readonly resolved_max_acceleration_u: unknown;
  readonly resolved_target_origin: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F446_FEATURE_ID>;
}

export type F446PontryaginBangBangMinimumTimePlannerTelemetrySnapshot = BaseFeatureTelemetry<typeof F446_FEATURE_ID>;

export const DEFAULT_F446_CONFIG: F446PontryaginBangBangMinimumTimePlannerConfig = {
  featureId: F446_FEATURE_ID,
  stage: F446_STAGE,
  operationCode: F446_OPERATION_CODE,
  contractVersion: F446_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F446PontryaginBangBangMinimumTimePlannerValidationError extends Error {
  public readonly featureId = F446_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F446 Validation Error on '${field}']: ${message}`);
    this.name = "F446PontryaginBangBangMinimumTimePlannerValidationError";
    this.field = field;
  }
}

export function computeF446Digest(rawPayload: string): string {
  return `f446_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F446PontryaginBangBangMinimumTimePlannerService extends KosmoraFeatureAdapterBase<
  typeof F446_FEATURE_ID,
  typeof F446_STAGE,
  typeof F446_OPERATION_CODE,
  F446PontryaginBangBangMinimumTimePlannerConfig,
  F446PontryaginBangBangMinimumTimePlannerInput,
  F446PontryaginBangBangMinimumTimePlannerOutput
> {
  constructor(customConfig?: Partial<F446PontryaginBangBangMinimumTimePlannerConfig>, kernel?: Stage14CyberneticControlKernel) {
    super(
      DEFAULT_F446_CONFIG,
      customConfig,
      kernel ?? Stage14CyberneticControlKernel.getShared(),
      ["initial_position", "initial_velocity", "max_acceleration_u", "target_origin"] as const,
      F446PontryaginBangBangMinimumTimePlannerValidationError
    );
  }
}

export function verifyF446Module(): {
  readonly featureId: typeof F446_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F446PontryaginBangBangMinimumTimePlannerService();
  const sampleInput: F446PontryaginBangBangMinimumTimePlannerInput = {
    requestId: "req_verify_f446",
    projectId: "proj_kosmora_f446",
    workspaceId: "ws_kosmora_f446",
    tenantId: "tenant_rlm_f446",
    actorId: "actor_verifier_f446",
    autonomyLevel: "A3",
    initial_position: "seed_f446_initial_position",
    initial_velocity: 42,
    max_acceleration_u: true,
    target_origin: "seed_f446_target_origin",
    metadata: { stage: "stage14-cybernetic-control", featureId: "F446" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F446" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_initial_position !== sampleInput.initial_position &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F446] Verification failed`);
  }

  return {
    featureId: F446_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
