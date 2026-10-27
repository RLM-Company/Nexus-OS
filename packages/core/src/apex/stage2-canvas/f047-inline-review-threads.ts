/**
 * F047 (stage2-canvas): Инлайн-комментарии и ревью-треды
 * Закрепление замечаний пользователя или Агента-Критика за конкретной строкой артефакта
 * Operation Code: inline_comment_thread
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

export const F047_FEATURE_ID = "F047" as const;
export const F047_STAGE = "stage2-canvas" as const;
export const F047_OPERATION_CODE = "inline_comment_thread" as const;
export const F047_CONTRACT_VERSION = "2.0.0" as const;

export type F047InlineReviewThreadsExecutionStatus =
  "idle" | "validating" | "executing" | "completed" | "degraded" | "cancelled" | "failed";

export type F047InlineReviewThreadsConfig = BaseFeatureConfig<
  typeof F047_FEATURE_ID,
  typeof F047_STAGE,
  typeof F047_OPERATION_CODE
>;

export interface F047InlineReviewThreadsInput extends BaseFeatureInput {
  readonly thread_id: string;
  readonly line_number: string | number;
  readonly author_role: string | number | boolean | readonly string[];
  readonly resolved_state: string | number | boolean | Record<string, unknown>;
}

export type F047InlineReviewThreadsAuditEntry = BaseFeatureAuditEntry<typeof F047_FEATURE_ID>;

export interface F047InlineReviewThreadsOutput {
  readonly featureId: typeof F047_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F047InlineReviewThreadsExecutionStatus;
  readonly operationCode: typeof F047_OPERATION_CODE;
  readonly resolved_thread_id: string;
  readonly resolved_line_number: string | number;
  readonly resolved_author_role: string | number | boolean | readonly string[];
  readonly resolved_resolved_state: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F047InlineReviewThreadsAuditEntry;
}

export type F047InlineReviewThreadsTelemetrySnapshot = BaseFeatureTelemetry<typeof F047_FEATURE_ID>;

export const DEFAULT_F047_CONFIG: F047InlineReviewThreadsConfig = {
  featureId: F047_FEATURE_ID,
  stage: F047_STAGE,
  operationCode: F047_OPERATION_CODE,
  contractVersion: F047_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F047InlineReviewThreadsValidationError extends Error {
  public readonly featureId = F047_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F047 Validation Error on '${field}']: ${message}`);
    this.name = "F047InlineReviewThreadsValidationError";
    this.field = field;
  }
}

export function computeF047Digest(rawPayload: string): string {
  return `f047_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F047InlineReviewThreadsEngine extends KosmoraFeatureAdapterBase<
  typeof F047_FEATURE_ID,
  typeof F047_STAGE,
  typeof F047_OPERATION_CODE,
  F047InlineReviewThreadsConfig,
  F047InlineReviewThreadsInput,
  F047InlineReviewThreadsOutput
> {
  constructor(customConfig?: Partial<F047InlineReviewThreadsConfig>, kernel?: Stage2CanvasKernel) {
    super(
      DEFAULT_F047_CONFIG,
      customConfig,
      kernel ?? new Stage2CanvasKernel(),
      ["thread_id", "line_number", "author_role", "resolved_state"] as const,
      F047InlineReviewThreadsValidationError
    );
  }
}

export function verifyF047Module(): {
  featureId: typeof F047_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F047InlineReviewThreadsEngine();
  const sampleInput: F047InlineReviewThreadsInput = {
    requestId: "req_verify_f047",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    thread_id: "f047_thread_id_seed",
    line_number: 42,
    author_role: true,
    resolved_state: "verified_seed",
    metadata: { stage: "stage2-canvas", featureNumber: 47 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F047" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_thread_id !== sampleInput.thread_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F047_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
