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

export const F441_FEATURE_ID = "F441" as const;
export const F441_STAGE = "stage14-cybernetic-control" as const;
export const F441_OPERATION_CODE = "F441_TOKEN_BUCKET_LEAKY_SHAPER_CALCULUS" as const;
export const F441_CONTRACT_VERSION = "2.0.0" as const;

export type F441TokenBucketLeakyShaperCalculusConfig = BaseFeatureConfig<
  typeof F441_FEATURE_ID,
  typeof F441_STAGE,
  typeof F441_OPERATION_CODE
>;

export interface F441TokenBucketLeakyShaperCalculusInput extends BaseFeatureInput {
  readonly Committed_rate_cir: string | number | boolean | readonly string[];
  readonly burst_size_cbs: string | number | boolean | readonly string[];
  readonly arrival_packet_bursts: string | number | boolean | readonly string[];
  readonly horizon_ticks: string | number | boolean | readonly string[];
}

export interface F441TokenBucketLeakyShaperCalculusOutput {
  readonly featureId: typeof F441_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F441_OPERATION_CODE;
  readonly resolved_Committed_rate_cir: unknown;
  readonly resolved_burst_size_cbs: unknown;
  readonly resolved_arrival_packet_bursts: unknown;
  readonly resolved_horizon_ticks: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F441_FEATURE_ID>;
}

export type F441TokenBucketLeakyShaperCalculusTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F441_FEATURE_ID
>;

export const DEFAULT_F441_CONFIG: F441TokenBucketLeakyShaperCalculusConfig = {
  featureId: F441_FEATURE_ID,
  stage: F441_STAGE,
  operationCode: F441_OPERATION_CODE,
  contractVersion: F441_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F441TokenBucketLeakyShaperCalculusValidationError extends Error {
  public readonly featureId = F441_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F441 Validation Error on '${field}']: ${message}`);
    this.name = "F441TokenBucketLeakyShaperCalculusValidationError";
    this.field = field;
  }
}

export function computeF441Digest(rawPayload: string): string {
  return `f441_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F441TokenBucketLeakyShaperCalculusService extends KosmoraFeatureAdapterBase<
  typeof F441_FEATURE_ID,
  typeof F441_STAGE,
  typeof F441_OPERATION_CODE,
  F441TokenBucketLeakyShaperCalculusConfig,
  F441TokenBucketLeakyShaperCalculusInput,
  F441TokenBucketLeakyShaperCalculusOutput
> {
  constructor(
    customConfig?: Partial<F441TokenBucketLeakyShaperCalculusConfig>,
    kernel?: Stage14CyberneticControlKernel
  ) {
    super(
      DEFAULT_F441_CONFIG,
      customConfig,
      kernel ?? Stage14CyberneticControlKernel.getShared(),
      ["Committed_rate_cir", "burst_size_cbs", "arrival_packet_bursts", "horizon_ticks"] as const,
      F441TokenBucketLeakyShaperCalculusValidationError
    );
  }
}

export function verifyF441Module(): {
  readonly featureId: typeof F441_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F441TokenBucketLeakyShaperCalculusService();
  const sampleInput: F441TokenBucketLeakyShaperCalculusInput = {
    requestId: "req_verify_f441",
    projectId: "proj_kosmora_f441",
    workspaceId: "ws_kosmora_f441",
    tenantId: "tenant_rlm_f441",
    actorId: "actor_verifier_f441",
    autonomyLevel: "A3",
    Committed_rate_cir: "seed_f441_Committed_rate_cir",
    burst_size_cbs: 42,
    arrival_packet_bursts: true,
    horizon_ticks: "seed_f441_horizon_ticks",
    metadata: { stage: "stage14-cybernetic-control", featureId: "F441" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F441" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_Committed_rate_cir !== sampleInput.Committed_rate_cir &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F441] Verification failed`);
  }

  return {
    featureId: F441_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
