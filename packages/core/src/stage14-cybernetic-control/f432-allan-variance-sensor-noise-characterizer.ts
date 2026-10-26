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

export const F432_FEATURE_ID = "F432" as const;
export const F432_STAGE = "stage14-cybernetic-control" as const;
export const F432_OPERATION_CODE = "F432_ALLAN_VARIANCE_SENSOR_NOISE_CHARACTERIZER" as const;
export const F432_CONTRACT_VERSION = "2.0.0" as const;

export type F432AllanVarianceSensorNoiseCharacterizerConfig = BaseFeatureConfig<
  typeof F432_FEATURE_ID,
  typeof F432_STAGE,
  typeof F432_OPERATION_CODE
>;

export interface F432AllanVarianceSensorNoiseCharacterizerInput extends BaseFeatureInput {
  readonly timeseries_samples: string | number | boolean | readonly string[];
  readonly cluster_tau_lengths: string | number | boolean | readonly string[];
  readonly sampling_period_dt: string | number | boolean | readonly string[];
  readonly drift_fit_mode: string | number | boolean | readonly string[];
}

export interface F432AllanVarianceSensorNoiseCharacterizerOutput {
  readonly featureId: typeof F432_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F432_OPERATION_CODE;
  readonly resolved_timeseries_samples: unknown;
  readonly resolved_cluster_tau_lengths: unknown;
  readonly resolved_sampling_period_dt: unknown;
  readonly resolved_drift_fit_mode: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F432_FEATURE_ID>;
}

export type F432AllanVarianceSensorNoiseCharacterizerTelemetrySnapshot = BaseFeatureTelemetry<typeof F432_FEATURE_ID>;

export const DEFAULT_F432_CONFIG: F432AllanVarianceSensorNoiseCharacterizerConfig = {
  featureId: F432_FEATURE_ID,
  stage: F432_STAGE,
  operationCode: F432_OPERATION_CODE,
  contractVersion: F432_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F432AllanVarianceSensorNoiseCharacterizerValidationError extends Error {
  public readonly featureId = F432_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F432 Validation Error on '${field}']: ${message}`);
    this.name = "F432AllanVarianceSensorNoiseCharacterizerValidationError";
    this.field = field;
  }
}

export function computeF432Digest(rawPayload: string): string {
  return `f432_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F432AllanVarianceSensorNoiseCharacterizerService extends KosmoraFeatureAdapterBase<
  typeof F432_FEATURE_ID,
  typeof F432_STAGE,
  typeof F432_OPERATION_CODE,
  F432AllanVarianceSensorNoiseCharacterizerConfig,
  F432AllanVarianceSensorNoiseCharacterizerInput,
  F432AllanVarianceSensorNoiseCharacterizerOutput
> {
  constructor(customConfig?: Partial<F432AllanVarianceSensorNoiseCharacterizerConfig>, kernel?: Stage14CyberneticControlKernel) {
    super(
      DEFAULT_F432_CONFIG,
      customConfig,
      kernel ?? Stage14CyberneticControlKernel.getShared(),
      ["timeseries_samples", "cluster_tau_lengths", "sampling_period_dt", "drift_fit_mode"] as const,
      F432AllanVarianceSensorNoiseCharacterizerValidationError
    );
  }
}

export function verifyF432Module(): {
  readonly featureId: typeof F432_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F432AllanVarianceSensorNoiseCharacterizerService();
  const sampleInput: F432AllanVarianceSensorNoiseCharacterizerInput = {
    requestId: "req_verify_f432",
    projectId: "proj_kosmora_f432",
    workspaceId: "ws_kosmora_f432",
    tenantId: "tenant_rlm_f432",
    actorId: "actor_verifier_f432",
    autonomyLevel: "A3",
    timeseries_samples: "seed_f432_timeseries_samples",
    cluster_tau_lengths: 42,
    sampling_period_dt: true,
    drift_fit_mode: "seed_f432_drift_fit_mode",
    metadata: { stage: "stage14-cybernetic-control", featureId: "F432" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F432" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_timeseries_samples !== sampleInput.timeseries_samples &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F432] Verification failed`);
  }

  return {
    featureId: F432_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
