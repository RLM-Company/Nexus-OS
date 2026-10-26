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

export const F444_FEATURE_ID = "F444" as const;
export const F444_STAGE = "stage14-cybernetic-control" as const;
export const F444_OPERATION_CODE = "F444_NYQUIST_GAIN_PHASE_MARGIN_ANALYZER" as const;
export const F444_CONTRACT_VERSION = "2.0.0" as const;

export type F444NyquistGainPhaseMarginAnalyzerConfig = BaseFeatureConfig<
  typeof F444_FEATURE_ID,
  typeof F444_STAGE,
  typeof F444_OPERATION_CODE
>;

export interface F444NyquistGainPhaseMarginAnalyzerInput extends BaseFeatureInput {
  readonly open_loop_gain: string | number | boolean | readonly string[];
  readonly dominant_time_constant: string | number | boolean | readonly string[];
  readonly loop_delay_tau: string | number | boolean | readonly string[];
  readonly frequency_grid_points: string | number | boolean | readonly string[];
}

export interface F444NyquistGainPhaseMarginAnalyzerOutput {
  readonly featureId: typeof F444_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F444_OPERATION_CODE;
  readonly resolved_open_loop_gain: unknown;
  readonly resolved_dominant_time_constant: unknown;
  readonly resolved_loop_delay_tau: unknown;
  readonly resolved_frequency_grid_points: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F444_FEATURE_ID>;
}

export type F444NyquistGainPhaseMarginAnalyzerTelemetrySnapshot = BaseFeatureTelemetry<typeof F444_FEATURE_ID>;

export const DEFAULT_F444_CONFIG: F444NyquistGainPhaseMarginAnalyzerConfig = {
  featureId: F444_FEATURE_ID,
  stage: F444_STAGE,
  operationCode: F444_OPERATION_CODE,
  contractVersion: F444_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F444NyquistGainPhaseMarginAnalyzerValidationError extends Error {
  public readonly featureId = F444_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F444 Validation Error on '${field}']: ${message}`);
    this.name = "F444NyquistGainPhaseMarginAnalyzerValidationError";
    this.field = field;
  }
}

export function computeF444Digest(rawPayload: string): string {
  return `f444_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F444NyquistGainPhaseMarginAnalyzerService extends KosmoraFeatureAdapterBase<
  typeof F444_FEATURE_ID,
  typeof F444_STAGE,
  typeof F444_OPERATION_CODE,
  F444NyquistGainPhaseMarginAnalyzerConfig,
  F444NyquistGainPhaseMarginAnalyzerInput,
  F444NyquistGainPhaseMarginAnalyzerOutput
> {
  constructor(customConfig?: Partial<F444NyquistGainPhaseMarginAnalyzerConfig>, kernel?: Stage14CyberneticControlKernel) {
    super(
      DEFAULT_F444_CONFIG,
      customConfig,
      kernel ?? Stage14CyberneticControlKernel.getShared(),
      ["open_loop_gain", "dominant_time_constant", "loop_delay_tau", "frequency_grid_points"] as const,
      F444NyquistGainPhaseMarginAnalyzerValidationError
    );
  }
}

export function verifyF444Module(): {
  readonly featureId: typeof F444_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F444NyquistGainPhaseMarginAnalyzerService();
  const sampleInput: F444NyquistGainPhaseMarginAnalyzerInput = {
    requestId: "req_verify_f444",
    projectId: "proj_kosmora_f444",
    workspaceId: "ws_kosmora_f444",
    tenantId: "tenant_rlm_f444",
    actorId: "actor_verifier_f444",
    autonomyLevel: "A3",
    open_loop_gain: "seed_f444_open_loop_gain",
    dominant_time_constant: 42,
    loop_delay_tau: true,
    frequency_grid_points: "seed_f444_frequency_grid_points",
    metadata: { stage: "stage14-cybernetic-control", featureId: "F444" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F444" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_open_loop_gain !== sampleInput.open_loop_gain &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F444] Verification failed`);
  }

  return {
    featureId: F444_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
