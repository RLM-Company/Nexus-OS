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

export const F428_FEATURE_ID = "F428" as const;
export const F428_STAGE = "stage14-cybernetic-control" as const;
export const F428_OPERATION_CODE = "F428_ADAPTIVE_MIT_RULE_GAIN_SCHEDULER" as const;
export const F428_CONTRACT_VERSION = "2.0.0" as const;

export type F428AdaptiveMitRuleGainSchedulerConfig = BaseFeatureConfig<
  typeof F428_FEATURE_ID,
  typeof F428_STAGE,
  typeof F428_OPERATION_CODE
>;

export interface F428AdaptiveMitRuleGainSchedulerInput extends BaseFeatureInput {
  readonly reference_model_output: string | number | boolean | readonly string[];
  readonly plant_actual_output: string | number | boolean | readonly string[];
  readonly adaptation_rate_gamma: string | number | boolean | readonly string[];
  readonly gain_bounds: string | number | boolean | readonly string[];
}

export interface F428AdaptiveMitRuleGainSchedulerOutput {
  readonly featureId: typeof F428_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F428_OPERATION_CODE;
  readonly resolved_reference_model_output: unknown;
  readonly resolved_plant_actual_output: unknown;
  readonly resolved_adaptation_rate_gamma: unknown;
  readonly resolved_gain_bounds: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F428_FEATURE_ID>;
}

export type F428AdaptiveMitRuleGainSchedulerTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F428_FEATURE_ID
>;

export const DEFAULT_F428_CONFIG: F428AdaptiveMitRuleGainSchedulerConfig = {
  featureId: F428_FEATURE_ID,
  stage: F428_STAGE,
  operationCode: F428_OPERATION_CODE,
  contractVersion: F428_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F428AdaptiveMitRuleGainSchedulerValidationError extends Error {
  public readonly featureId = F428_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F428 Validation Error on '${field}']: ${message}`);
    this.name = "F428AdaptiveMitRuleGainSchedulerValidationError";
    this.field = field;
  }
}

export function computeF428Digest(rawPayload: string): string {
  return `f428_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F428AdaptiveMitRuleGainSchedulerService extends KosmoraFeatureAdapterBase<
  typeof F428_FEATURE_ID,
  typeof F428_STAGE,
  typeof F428_OPERATION_CODE,
  F428AdaptiveMitRuleGainSchedulerConfig,
  F428AdaptiveMitRuleGainSchedulerInput,
  F428AdaptiveMitRuleGainSchedulerOutput
> {
  constructor(
    customConfig?: Partial<F428AdaptiveMitRuleGainSchedulerConfig>,
    kernel?: Stage14CyberneticControlKernel
  ) {
    super(
      DEFAULT_F428_CONFIG,
      customConfig,
      kernel ?? Stage14CyberneticControlKernel.getShared(),
      [
        "reference_model_output",
        "plant_actual_output",
        "adaptation_rate_gamma",
        "gain_bounds"
      ] as const,
      F428AdaptiveMitRuleGainSchedulerValidationError
    );
  }
}

export function verifyF428Module(): {
  readonly featureId: typeof F428_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F428AdaptiveMitRuleGainSchedulerService();
  const sampleInput: F428AdaptiveMitRuleGainSchedulerInput = {
    requestId: "req_verify_f428",
    projectId: "proj_kosmora_f428",
    workspaceId: "ws_kosmora_f428",
    tenantId: "tenant_rlm_f428",
    actorId: "actor_verifier_f428",
    autonomyLevel: "A3",
    reference_model_output: "seed_f428_reference_model_output",
    plant_actual_output: 42,
    adaptation_rate_gamma: true,
    gain_bounds: "seed_f428_gain_bounds",
    metadata: { stage: "stage14-cybernetic-control", featureId: "F428" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F428" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_reference_model_output !== sampleInput.reference_model_output &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F428] Verification failed`);
  }

  return {
    featureId: F428_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
