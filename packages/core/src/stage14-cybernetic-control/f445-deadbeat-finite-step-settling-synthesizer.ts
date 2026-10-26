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

export const F445_FEATURE_ID = "F445" as const;
export const F445_STAGE = "stage14-cybernetic-control" as const;
export const F445_OPERATION_CODE = "F445_DEADBEAT_FINITE_STEP_SETTLING_SYNTHESIZER" as const;
export const F445_CONTRACT_VERSION = "2.0.0" as const;

export type F445DiscreteDeadbeatSettlingSynthesizerConfig = BaseFeatureConfig<
  typeof F445_FEATURE_ID,
  typeof F445_STAGE,
  typeof F445_OPERATION_CODE
>;

export interface F445DiscreteDeadbeatSettlingSynthesizerInput extends BaseFeatureInput {
  readonly plant_impulse_coeffs: string | number | boolean | readonly string[];
  readonly sample_period_ts: string | number | boolean | readonly string[];
  readonly target_settling_steps: string | number | boolean | readonly string[];
  readonly control_saturation: string | number | boolean | readonly string[];
}

export interface F445DiscreteDeadbeatSettlingSynthesizerOutput {
  readonly featureId: typeof F445_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F445_OPERATION_CODE;
  readonly resolved_plant_impulse_coeffs: unknown;
  readonly resolved_sample_period_ts: unknown;
  readonly resolved_target_settling_steps: unknown;
  readonly resolved_control_saturation: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F445_FEATURE_ID>;
}

export type F445DiscreteDeadbeatSettlingSynthesizerTelemetrySnapshot = BaseFeatureTelemetry<typeof F445_FEATURE_ID>;

export const DEFAULT_F445_CONFIG: F445DiscreteDeadbeatSettlingSynthesizerConfig = {
  featureId: F445_FEATURE_ID,
  stage: F445_STAGE,
  operationCode: F445_OPERATION_CODE,
  contractVersion: F445_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F445DiscreteDeadbeatSettlingSynthesizerValidationError extends Error {
  public readonly featureId = F445_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F445 Validation Error on '${field}']: ${message}`);
    this.name = "F445DiscreteDeadbeatSettlingSynthesizerValidationError";
    this.field = field;
  }
}

export function computeF445Digest(rawPayload: string): string {
  return `f445_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F445DiscreteDeadbeatSettlingSynthesizerService extends KosmoraFeatureAdapterBase<
  typeof F445_FEATURE_ID,
  typeof F445_STAGE,
  typeof F445_OPERATION_CODE,
  F445DiscreteDeadbeatSettlingSynthesizerConfig,
  F445DiscreteDeadbeatSettlingSynthesizerInput,
  F445DiscreteDeadbeatSettlingSynthesizerOutput
> {
  constructor(customConfig?: Partial<F445DiscreteDeadbeatSettlingSynthesizerConfig>, kernel?: Stage14CyberneticControlKernel) {
    super(
      DEFAULT_F445_CONFIG,
      customConfig,
      kernel ?? Stage14CyberneticControlKernel.getShared(),
      ["plant_impulse_coeffs", "sample_period_ts", "target_settling_steps", "control_saturation"] as const,
      F445DiscreteDeadbeatSettlingSynthesizerValidationError
    );
  }
}

export function verifyF445Module(): {
  readonly featureId: typeof F445_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F445DiscreteDeadbeatSettlingSynthesizerService();
  const sampleInput: F445DiscreteDeadbeatSettlingSynthesizerInput = {
    requestId: "req_verify_f445",
    projectId: "proj_kosmora_f445",
    workspaceId: "ws_kosmora_f445",
    tenantId: "tenant_rlm_f445",
    actorId: "actor_verifier_f445",
    autonomyLevel: "A3",
    plant_impulse_coeffs: "seed_f445_plant_impulse_coeffs",
    sample_period_ts: 42,
    target_settling_steps: true,
    control_saturation: "seed_f445_control_saturation",
    metadata: { stage: "stage14-cybernetic-control", featureId: "F445" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F445" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_plant_impulse_coeffs !== sampleInput.plant_impulse_coeffs &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F445] Verification failed`);
  }

  return {
    featureId: F445_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
