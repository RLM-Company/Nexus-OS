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

export const F433_FEATURE_ID = "F433" as const;
export const F433_STAGE = "stage14-cybernetic-control" as const;
export const F433_OPERATION_CODE = "F433_ALPHA_BETA_GAMMA_KINEMATIC_TRACKER" as const;
export const F433_CONTRACT_VERSION = "2.0.0" as const;

export type F433AlphaBetaGammaKinematicTrackerConfig = BaseFeatureConfig<
  typeof F433_FEATURE_ID,
  typeof F433_STAGE,
  typeof F433_OPERATION_CODE
>;

export interface F433AlphaBetaGammaKinematicTrackerInput extends BaseFeatureInput {
  readonly position_observations: string | number | boolean | readonly string[];
  readonly alpha_gain: string | number | boolean | readonly string[];
  readonly beta_gain: string | number | boolean | readonly string[];
  readonly gamma_gain: string | number | boolean | readonly string[];
}

export interface F433AlphaBetaGammaKinematicTrackerOutput {
  readonly featureId: typeof F433_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F433_OPERATION_CODE;
  readonly resolved_position_observations: unknown;
  readonly resolved_alpha_gain: unknown;
  readonly resolved_beta_gain: unknown;
  readonly resolved_gamma_gain: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F433_FEATURE_ID>;
}

export type F433AlphaBetaGammaKinematicTrackerTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F433_FEATURE_ID
>;

export const DEFAULT_F433_CONFIG: F433AlphaBetaGammaKinematicTrackerConfig = {
  featureId: F433_FEATURE_ID,
  stage: F433_STAGE,
  operationCode: F433_OPERATION_CODE,
  contractVersion: F433_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F433AlphaBetaGammaKinematicTrackerValidationError extends Error {
  public readonly featureId = F433_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F433 Validation Error on '${field}']: ${message}`);
    this.name = "F433AlphaBetaGammaKinematicTrackerValidationError";
    this.field = field;
  }
}

export function computeF433Digest(rawPayload: string): string {
  return `f433_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F433AlphaBetaGammaKinematicTrackerService extends KosmoraFeatureAdapterBase<
  typeof F433_FEATURE_ID,
  typeof F433_STAGE,
  typeof F433_OPERATION_CODE,
  F433AlphaBetaGammaKinematicTrackerConfig,
  F433AlphaBetaGammaKinematicTrackerInput,
  F433AlphaBetaGammaKinematicTrackerOutput
> {
  constructor(
    customConfig?: Partial<F433AlphaBetaGammaKinematicTrackerConfig>,
    kernel?: Stage14CyberneticControlKernel
  ) {
    super(
      DEFAULT_F433_CONFIG,
      customConfig,
      kernel ?? Stage14CyberneticControlKernel.getShared(),
      ["position_observations", "alpha_gain", "beta_gain", "gamma_gain"] as const,
      F433AlphaBetaGammaKinematicTrackerValidationError
    );
  }
}

export function verifyF433Module(): {
  readonly featureId: typeof F433_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F433AlphaBetaGammaKinematicTrackerService();
  const sampleInput: F433AlphaBetaGammaKinematicTrackerInput = {
    requestId: "req_verify_f433",
    projectId: "proj_kosmora_f433",
    workspaceId: "ws_kosmora_f433",
    tenantId: "tenant_rlm_f433",
    actorId: "actor_verifier_f433",
    autonomyLevel: "A3",
    position_observations: "seed_f433_position_observations",
    alpha_gain: 42,
    beta_gain: true,
    gamma_gain: "seed_f433_gamma_gain",
    metadata: { stage: "stage14-cybernetic-control", featureId: "F433" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F433" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_position_observations !== sampleInput.position_observations &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F433] Verification failed`);
  }

  return {
    featureId: F433_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
