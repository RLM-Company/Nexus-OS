/**
 * F008 (stage1-autonomy): Настраиваемые уровни автономии (L1–L5)
 * Ползунок контроля от «спрашивать каждый шаг» до «полный автопилот с отчётом по итогу»
 * Operation Code: autonomy_slider
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

export const F008_FEATURE_ID = "F008" as const;
export const F008_STAGE = "stage1-autonomy" as const;
export const F008_OPERATION_CODE = "autonomy_slider" as const;
export const F008_CONTRACT_VERSION = "2.0.0" as const;

export type F008AutonomyLevelsL1L5ExecutionStatus =
  "idle" | "validating" | "executing" | "completed" | "degraded" | "cancelled" | "failed";

export type F008AutonomyLevelsL1L5Config = BaseFeatureConfig<
  typeof F008_FEATURE_ID,
  typeof F008_STAGE,
  typeof F008_OPERATION_CODE
>;

export interface F008AutonomyLevelsL1L5Input extends BaseFeatureInput {
  readonly tier_level: string;
  readonly cosmora_policy_code: string | number;
  readonly require_step_confirmation: string | number | boolean | readonly string[];
  readonly allow_fanout: string | number | boolean | Record<string, unknown>;
}

export type F008AutonomyLevelsL1L5AuditEntry = BaseFeatureAuditEntry<typeof F008_FEATURE_ID>;

export interface F008AutonomyLevelsL1L5Output {
  readonly featureId: typeof F008_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F008AutonomyLevelsL1L5ExecutionStatus;
  readonly operationCode: typeof F008_OPERATION_CODE;
  readonly resolved_tier_level: string;
  readonly resolved_cosmora_policy_code: string | number;
  readonly resolved_require_step_confirmation: string | number | boolean | readonly string[];
  readonly resolved_allow_fanout: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F008AutonomyLevelsL1L5AuditEntry;
}

export type F008AutonomyLevelsL1L5TelemetrySnapshot = BaseFeatureTelemetry<typeof F008_FEATURE_ID>;

export const DEFAULT_F008_CONFIG: F008AutonomyLevelsL1L5Config = {
  featureId: F008_FEATURE_ID,
  stage: F008_STAGE,
  operationCode: F008_OPERATION_CODE,
  contractVersion: F008_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F008AutonomyLevelsL1L5ValidationError extends Error {
  public readonly featureId = F008_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F008 Validation Error on '${field}']: ${message}`);
    this.name = "F008AutonomyLevelsL1L5ValidationError";
    this.field = field;
  }
}

export function computeF008Digest(rawPayload: string): string {
  return `f008_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F008AutonomyLevelsL1L5Engine extends KosmoraFeatureAdapterBase<
  typeof F008_FEATURE_ID,
  typeof F008_STAGE,
  typeof F008_OPERATION_CODE,
  F008AutonomyLevelsL1L5Config,
  F008AutonomyLevelsL1L5Input,
  F008AutonomyLevelsL1L5Output
> {
  constructor(customConfig?: Partial<F008AutonomyLevelsL1L5Config>, kernel?: Stage1AutonomyKernel) {
    super(
      DEFAULT_F008_CONFIG,
      customConfig,
      kernel ?? new Stage1AutonomyKernel(),
      ["tier_level", "cosmora_policy_code", "require_step_confirmation", "allow_fanout"] as const,
      F008AutonomyLevelsL1L5ValidationError
    );
  }
}

export function verifyF008Module(): {
  featureId: typeof F008_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F008AutonomyLevelsL1L5Engine();
  const sampleInput: F008AutonomyLevelsL1L5Input = {
    requestId: "req_verify_f008",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    tier_level: "f008_tier_level_seed",
    cosmora_policy_code: 42,
    require_step_confirmation: true,
    allow_fanout: "verified_seed",
    metadata: { stage: "stage1-autonomy", featureNumber: 8 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F008" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_tier_level !== sampleInput.tier_level &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F008_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
