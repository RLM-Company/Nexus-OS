/**
 * F030 (stage1-autonomy): Калибровка строгости Критика
 * Настройка порога пропуска артефактов (черновик / продакшен-грейд)
 * Operation Code: strictness_calibrator
 */

import { createHash } from "node:crypto";
import {
  Stage1AutonomyKernel,
  KosmoraFeatureAdapterBase,
  type BaseFeatureAuditEntry,
  type BaseFeatureConfig,
  type BaseFeatureInput,
  type BaseFeatureTelemetry,
  type StageKernelExecutionResult
} from "./stage-kernel.js";

export const F030_FEATURE_ID = "F030" as const;
export const F030_STAGE = "stage1-autonomy" as const;
export const F030_OPERATION_CODE = "strictness_calibrator" as const;
export const F030_CONTRACT_VERSION = "2.0.0" as const;

export type F030CriticStrictnessCalibrationExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export type F030CriticStrictnessCalibrationConfig = BaseFeatureConfig<
  typeof F030_FEATURE_ID,
  typeof F030_STAGE,
  typeof F030_OPERATION_CODE
>;

export interface F030CriticStrictnessCalibrationInput extends BaseFeatureInput {
  readonly calibration_mode: string;
  readonly min_pass_score: string | number;
  readonly allow_warnings: string | number | boolean | readonly string[];
  readonly gate_decision: string | number | boolean | Record<string, unknown>;
}

export type F030CriticStrictnessCalibrationAuditEntry = BaseFeatureAuditEntry<typeof F030_FEATURE_ID>;

export interface F030CriticStrictnessCalibrationOutput {
  readonly featureId: typeof F030_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F030CriticStrictnessCalibrationExecutionStatus;
  readonly operationCode: typeof F030_OPERATION_CODE;
  readonly resolved_calibration_mode: string;
  readonly resolved_min_pass_score: string | number;
  readonly resolved_allow_warnings: string | number | boolean | readonly string[];
  readonly resolved_gate_decision: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F030CriticStrictnessCalibrationAuditEntry;
}

export type F030CriticStrictnessCalibrationTelemetrySnapshot = BaseFeatureTelemetry<typeof F030_FEATURE_ID>;

export const DEFAULT_F030_CONFIG: F030CriticStrictnessCalibrationConfig = {
  featureId: F030_FEATURE_ID,
  stage: F030_STAGE,
  operationCode: F030_OPERATION_CODE,
  contractVersion: F030_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F030CriticStrictnessCalibrationValidationError extends Error {
  public readonly featureId = F030_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F030 Validation Error on '${field}']: ${message}`);
    this.name = "F030CriticStrictnessCalibrationValidationError";
    this.field = field;
  }
}

export function computeF030Digest(rawPayload: string): string {
  return `f030_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F030CriticStrictnessCalibrationEngine extends KosmoraFeatureAdapterBase<
  typeof F030_FEATURE_ID,
  typeof F030_STAGE,
  typeof F030_OPERATION_CODE,
  F030CriticStrictnessCalibrationConfig,
  F030CriticStrictnessCalibrationInput,
  F030CriticStrictnessCalibrationOutput
> {
  constructor(customConfig?: Partial<F030CriticStrictnessCalibrationConfig>, kernel?: Stage1AutonomyKernel) {
    super(
      DEFAULT_F030_CONFIG,
      customConfig,
      kernel ?? new Stage1AutonomyKernel(),
      ["calibration_mode", "min_pass_score", "allow_warnings", "gate_decision"] as const,
      F030CriticStrictnessCalibrationValidationError
    );
  }
  protected override validateDomainInvariants(input: F030CriticStrictnessCalibrationInput): void {
    if (typeof input.min_pass_score === "number" && input.min_pass_score > 1000) {
      throw new F030CriticStrictnessCalibrationValidationError("min_pass_score", "Metric 'min_pass_score' exceeds maximum normalized ceiling (1000).");
    }
  }
}

export function verifyF030Module(): {
  featureId: typeof F030_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F030CriticStrictnessCalibrationEngine();
  const sampleInput: F030CriticStrictnessCalibrationInput = {
    requestId: "req_verify_f030",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    calibration_mode: "f030_calibration_mode_seed",
    min_pass_score: 42,
    allow_warnings: true,
    gate_decision: "verified_seed",
    metadata: { stage: "stage1-autonomy", featureNumber: 30 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F030" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_calibration_mode !== sampleInput.calibration_mode &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F030_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
