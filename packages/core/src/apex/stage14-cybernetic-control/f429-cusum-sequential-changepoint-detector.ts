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

export const F429_FEATURE_ID = "F429" as const;
export const F429_STAGE = "stage14-cybernetic-control" as const;
export const F429_OPERATION_CODE = "F429_CUSUM_SEQUENTIAL_CHANGEPOINT_DETECTOR" as const;
export const F429_CONTRACT_VERSION = "2.0.0" as const;

export type F429CusumSequentialChangepointDetectorConfig = BaseFeatureConfig<
  typeof F429_FEATURE_ID,
  typeof F429_STAGE,
  typeof F429_OPERATION_CODE
>;

export interface F429CusumSequentialChangepointDetectorInput extends BaseFeatureInput {
  readonly observation_stream: string | number | boolean | readonly string[];
  readonly target_mean_mu0: string | number | boolean | readonly string[];
  readonly allowance_slack_k: string | number | boolean | readonly string[];
  readonly alarm_threshold_h: string | number | boolean | readonly string[];
}

export interface F429CusumSequentialChangepointDetectorOutput {
  readonly featureId: typeof F429_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F429_OPERATION_CODE;
  readonly resolved_observation_stream: unknown;
  readonly resolved_target_mean_mu0: unknown;
  readonly resolved_allowance_slack_k: unknown;
  readonly resolved_alarm_threshold_h: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F429_FEATURE_ID>;
}

export type F429CusumSequentialChangepointDetectorTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F429_FEATURE_ID
>;

export const DEFAULT_F429_CONFIG: F429CusumSequentialChangepointDetectorConfig = {
  featureId: F429_FEATURE_ID,
  stage: F429_STAGE,
  operationCode: F429_OPERATION_CODE,
  contractVersion: F429_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F429CusumSequentialChangepointDetectorValidationError extends Error {
  public readonly featureId = F429_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F429 Validation Error on '${field}']: ${message}`);
    this.name = "F429CusumSequentialChangepointDetectorValidationError";
    this.field = field;
  }
}

export function computeF429Digest(rawPayload: string): string {
  return `f429_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F429CusumSequentialChangepointDetectorService extends KosmoraFeatureAdapterBase<
  typeof F429_FEATURE_ID,
  typeof F429_STAGE,
  typeof F429_OPERATION_CODE,
  F429CusumSequentialChangepointDetectorConfig,
  F429CusumSequentialChangepointDetectorInput,
  F429CusumSequentialChangepointDetectorOutput
> {
  constructor(
    customConfig?: Partial<F429CusumSequentialChangepointDetectorConfig>,
    kernel?: Stage14CyberneticControlKernel
  ) {
    super(
      DEFAULT_F429_CONFIG,
      customConfig,
      kernel ?? Stage14CyberneticControlKernel.getShared(),
      ["observation_stream", "target_mean_mu0", "allowance_slack_k", "alarm_threshold_h"] as const,
      F429CusumSequentialChangepointDetectorValidationError
    );
  }
}

export function verifyF429Module(): {
  readonly featureId: typeof F429_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F429CusumSequentialChangepointDetectorService();
  const sampleInput: F429CusumSequentialChangepointDetectorInput = {
    requestId: "req_verify_f429",
    projectId: "proj_kosmora_f429",
    workspaceId: "ws_kosmora_f429",
    tenantId: "tenant_rlm_f429",
    actorId: "actor_verifier_f429",
    autonomyLevel: "A3",
    observation_stream: "seed_f429_observation_stream",
    target_mean_mu0: 42,
    allowance_slack_k: true,
    alarm_threshold_h: "seed_f429_alarm_threshold_h",
    metadata: { stage: "stage14-cybernetic-control", featureId: "F429" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F429" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_observation_stream !== sampleInput.observation_stream &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F429] Verification failed`);
  }

  return {
    featureId: F429_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
