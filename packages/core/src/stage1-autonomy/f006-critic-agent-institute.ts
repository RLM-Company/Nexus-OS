/**
 * F006 (stage1-autonomy): Институт Агента-Критика (Critic Agent)
 * Выделенный проверяющий контур для ревью кода, текста и таблиц до показа пользователю
 * Operation Code: critic_review
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

export const F006_FEATURE_ID = "F006" as const;
export const F006_STAGE = "stage1-autonomy" as const;
export const F006_OPERATION_CODE = "critic_review" as const;
export const F006_CONTRACT_VERSION = "2.0.0" as const;

export type F006CriticAgentInstituteExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export type F006CriticAgentInstituteConfig = BaseFeatureConfig<
  typeof F006_FEATURE_ID,
  typeof F006_STAGE,
  typeof F006_OPERATION_CODE
>;

export interface F006CriticAgentInstituteInput extends BaseFeatureInput {
  readonly review_id: string;
  readonly target_artifact_id: string | number;
  readonly rubric_scores: string | number | boolean | readonly string[];
  readonly blocking_issues: string | number | boolean | Record<string, unknown>;
}

export type F006CriticAgentInstituteAuditEntry = BaseFeatureAuditEntry<typeof F006_FEATURE_ID>;

export interface F006CriticAgentInstituteOutput {
  readonly featureId: typeof F006_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F006CriticAgentInstituteExecutionStatus;
  readonly operationCode: typeof F006_OPERATION_CODE;
  readonly resolved_review_id: string;
  readonly resolved_target_artifact_id: string | number;
  readonly resolved_rubric_scores: string | number | boolean | readonly string[];
  readonly resolved_blocking_issues: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F006CriticAgentInstituteAuditEntry;
}

export type F006CriticAgentInstituteTelemetrySnapshot = BaseFeatureTelemetry<typeof F006_FEATURE_ID>;

export const DEFAULT_F006_CONFIG: F006CriticAgentInstituteConfig = {
  featureId: F006_FEATURE_ID,
  stage: F006_STAGE,
  operationCode: F006_OPERATION_CODE,
  contractVersion: F006_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F006CriticAgentInstituteValidationError extends Error {
  public readonly featureId = F006_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F006 Validation Error on '${field}']: ${message}`);
    this.name = "F006CriticAgentInstituteValidationError";
    this.field = field;
  }
}

export function computeF006Digest(rawPayload: string): string {
  return `f006_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F006CriticAgentInstituteEngine extends KosmoraFeatureAdapterBase<
  typeof F006_FEATURE_ID,
  typeof F006_STAGE,
  typeof F006_OPERATION_CODE,
  F006CriticAgentInstituteConfig,
  F006CriticAgentInstituteInput,
  F006CriticAgentInstituteOutput
> {
  constructor(customConfig?: Partial<F006CriticAgentInstituteConfig>, kernel?: Stage1AutonomyKernel) {
    super(
      DEFAULT_F006_CONFIG,
      customConfig,
      kernel ?? new Stage1AutonomyKernel(),
      ["review_id", "target_artifact_id", "rubric_scores", "blocking_issues"] as const,
      F006CriticAgentInstituteValidationError
    );
  }
}

export function verifyF006Module(): {
  featureId: typeof F006_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F006CriticAgentInstituteEngine();
  const sampleInput: F006CriticAgentInstituteInput = {
    requestId: "req_verify_f006",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    review_id: "f006_review_id_seed",
    target_artifact_id: 42,
    rubric_scores: true,
    blocking_issues: "verified_seed",
    metadata: { stage: "stage1-autonomy", featureNumber: 6 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F006" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_review_id !== sampleInput.review_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F006_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
