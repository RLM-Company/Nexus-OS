/**
 * F048 (stage2-canvas): Бейдж статуса проверки на артефакте
 * Визуальный индикатор в шапке Canvas: проверено Критиком, есть замечания или редактируется вручную
 * Operation Code: verification_badge_ui
 */

import { createHash } from "node:crypto";
import {
  Stage2CanvasKernel,
  KosmoraFeatureAdapterBase,
  type BaseFeatureAuditEntry,
  type BaseFeatureConfig,
  type BaseFeatureInput,
  type BaseFeatureTelemetry,
  type StageKernelExecutionResult
} from "./stage-kernel.js";

export const F048_FEATURE_ID = "F048" as const;
export const F048_STAGE = "stage2-canvas" as const;
export const F048_OPERATION_CODE = "verification_badge_ui" as const;
export const F048_CONTRACT_VERSION = "2.0.0" as const;

export type F048ArtifactVerificationBadgeExecutionStatus =
  "idle" | "validating" | "executing" | "completed" | "degraded" | "cancelled" | "failed";

export type F048ArtifactVerificationBadgeConfig = BaseFeatureConfig<
  typeof F048_FEATURE_ID,
  typeof F048_STAGE,
  typeof F048_OPERATION_CODE
>;

export interface F048ArtifactVerificationBadgeInput extends BaseFeatureInput {
  readonly artifact_id: string;
  readonly badge_state: string | number;
  readonly critic_score: string | number | boolean | readonly string[];
  readonly badge_color_token: string | number | boolean | Record<string, unknown>;
}

export type F048ArtifactVerificationBadgeAuditEntry = BaseFeatureAuditEntry<typeof F048_FEATURE_ID>;

export interface F048ArtifactVerificationBadgeOutput {
  readonly featureId: typeof F048_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F048ArtifactVerificationBadgeExecutionStatus;
  readonly operationCode: typeof F048_OPERATION_CODE;
  readonly resolved_artifact_id: string;
  readonly resolved_badge_state: string | number;
  readonly resolved_critic_score: string | number | boolean | readonly string[];
  readonly resolved_badge_color_token: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F048ArtifactVerificationBadgeAuditEntry;
}

export type F048ArtifactVerificationBadgeTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F048_FEATURE_ID
>;

export const DEFAULT_F048_CONFIG: F048ArtifactVerificationBadgeConfig = {
  featureId: F048_FEATURE_ID,
  stage: F048_STAGE,
  operationCode: F048_OPERATION_CODE,
  contractVersion: F048_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F048ArtifactVerificationBadgeValidationError extends Error {
  public readonly featureId = F048_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F048 Validation Error on '${field}']: ${message}`);
    this.name = "F048ArtifactVerificationBadgeValidationError";
    this.field = field;
  }
}

export function computeF048Digest(rawPayload: string): string {
  return `f048_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F048ArtifactVerificationBadgeEngine extends KosmoraFeatureAdapterBase<
  typeof F048_FEATURE_ID,
  typeof F048_STAGE,
  typeof F048_OPERATION_CODE,
  F048ArtifactVerificationBadgeConfig,
  F048ArtifactVerificationBadgeInput,
  F048ArtifactVerificationBadgeOutput
> {
  constructor(
    customConfig?: Partial<F048ArtifactVerificationBadgeConfig>,
    kernel?: Stage2CanvasKernel
  ) {
    super(
      DEFAULT_F048_CONFIG,
      customConfig,
      kernel ?? new Stage2CanvasKernel(),
      ["artifact_id", "badge_state", "critic_score", "badge_color_token"] as const,
      F048ArtifactVerificationBadgeValidationError
    );
  }
}

export function verifyF048Module(): {
  featureId: typeof F048_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F048ArtifactVerificationBadgeEngine();
  const sampleInput: F048ArtifactVerificationBadgeInput = {
    requestId: "req_verify_f048",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    artifact_id: "f048_artifact_id_seed",
    badge_state: 42,
    critic_score: true,
    badge_color_token: "verified_seed",
    metadata: { stage: "stage2-canvas", featureNumber: 48 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F048" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_artifact_id !== sampleInput.artifact_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F048_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
