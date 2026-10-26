/**
 * F007 (stage1-autonomy): Привязка вердиктов Критика к артефактам (Critic Verdict Binding)
 * Сохранение статуса (Approved / Needs Revision + комментарии) прямо в метаданных артефакта
 * Operation Code: verdict_binding
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

export const F007_FEATURE_ID = "F007" as const;
export const F007_STAGE = "stage1-autonomy" as const;
export const F007_OPERATION_CODE = "verdict_binding" as const;
export const F007_CONTRACT_VERSION = "2.0.0" as const;

export type F007CriticVerdictBindingExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export type F007CriticVerdictBindingConfig = BaseFeatureConfig<
  typeof F007_FEATURE_ID,
  typeof F007_STAGE,
  typeof F007_OPERATION_CODE
>;

export interface F007CriticVerdictBindingInput extends BaseFeatureInput {
  readonly verdict_id: string;
  readonly artifact_id: string | number;
  readonly verdict_status: string | number | boolean | readonly string[];
  readonly reviewer_comments: string | number | boolean | Record<string, unknown>;
}

export type F007CriticVerdictBindingAuditEntry = BaseFeatureAuditEntry<typeof F007_FEATURE_ID>;

export interface F007CriticVerdictBindingOutput {
  readonly featureId: typeof F007_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F007CriticVerdictBindingExecutionStatus;
  readonly operationCode: typeof F007_OPERATION_CODE;
  readonly resolved_verdict_id: string;
  readonly resolved_artifact_id: string | number;
  readonly resolved_verdict_status: string | number | boolean | readonly string[];
  readonly resolved_reviewer_comments: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F007CriticVerdictBindingAuditEntry;
}

export type F007CriticVerdictBindingTelemetrySnapshot = BaseFeatureTelemetry<typeof F007_FEATURE_ID>;

export const DEFAULT_F007_CONFIG: F007CriticVerdictBindingConfig = {
  featureId: F007_FEATURE_ID,
  stage: F007_STAGE,
  operationCode: F007_OPERATION_CODE,
  contractVersion: F007_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F007CriticVerdictBindingValidationError extends Error {
  public readonly featureId = F007_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F007 Validation Error on '${field}']: ${message}`);
    this.name = "F007CriticVerdictBindingValidationError";
    this.field = field;
  }
}

export function computeF007Digest(rawPayload: string): string {
  return `f007_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F007CriticVerdictBindingEngine extends KosmoraFeatureAdapterBase<
  typeof F007_FEATURE_ID,
  typeof F007_STAGE,
  typeof F007_OPERATION_CODE,
  F007CriticVerdictBindingConfig,
  F007CriticVerdictBindingInput,
  F007CriticVerdictBindingOutput
> {
  constructor(customConfig?: Partial<F007CriticVerdictBindingConfig>, kernel?: Stage1AutonomyKernel) {
    super(
      DEFAULT_F007_CONFIG,
      customConfig,
      kernel ?? new Stage1AutonomyKernel(),
      ["verdict_id", "artifact_id", "verdict_status", "reviewer_comments"] as const,
      F007CriticVerdictBindingValidationError
    );
  }
}

export function verifyF007Module(): {
  featureId: typeof F007_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F007CriticVerdictBindingEngine();
  const sampleInput: F007CriticVerdictBindingInput = {
    requestId: "req_verify_f007",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    verdict_id: "f007_verdict_id_seed",
    artifact_id: 42,
    verdict_status: true,
    reviewer_comments: "verified_seed",
    metadata: { stage: "stage1-autonomy", featureNumber: 7 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F007" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_verdict_id !== sampleInput.verdict_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F007_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
